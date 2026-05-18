import { Hono } from "hono";
import { eq, desc, or, ilike, and, inArray, sql } from "drizzle-orm";
import { createDb, type Env } from "../db/client";
import { prospects, importHistory, emails } from "../db/schema";
import type { InferSelectModel } from "drizzle-orm";

import { audit } from "../lib/audit";
import { fireWebhooks } from "../lib/webhooks";
import { invalidateCache } from "../lib/cache";
import type { GenerateJob } from "../lib/jobs";

type ProspectStatus = InferSelectModel<typeof prospects>["status"];

const app = new Hono<{ Bindings: Env }>();

// ─── List ─────────────────────────────────────────────────────────────────────

app.get("/", async (c) => {
  const db = createDb(c.env);
  const { search, status, campaignId, page = "1", limit = "50", sort = "createdAt" } = c.req.query();

  const conditions = [];
  if (status) conditions.push(eq(prospects.status, status as ProspectStatus));
  if (campaignId) conditions.push(eq(prospects.campaignId, campaignId));
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        ilike(prospects.name, pattern),
        ilike(prospects.email, pattern),
        ilike(prospects.company, pattern),
      )!,
    );
  }

  const rows = await db
    .select()
    .from(prospects)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(prospects.createdAt))
    .limit(Math.min(Number(limit), 500))
    .offset((Number(page) - 1) * Number(limit));

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(prospects)
    .where(conditions.length ? and(...conditions) : undefined);

  return c.json({ data: rows, total, page: Number(page), limit: Number(limit) });
});

// ─── Create (single) ──────────────────────────────────────────────────────────

app.post("/", async (c) => {
  const db = createDb(c.env);
  const body = await c.req.json<typeof prospects.$inferInsert>();
  const id = crypto.randomUUID();
  const unsubscribeToken = crypto.randomUUID();
  const [row] = await db
    .insert(prospects)
    .values({ ...body, id, unsubscribeToken })
    .returning();
  await audit(db, "prospect", id, "created");
  await invalidateCache(c.env, "analytics:");
  return c.json(row, 201);
});

// ─── Bulk import ──────────────────────────────────────────────────────────────
// Accepts array, deduplicates by email, returns inserted + duplicate counts.

app.post("/import", async (c) => {
  const db = createDb(c.env);
  const { rows, filename = "import.csv", campaignId } = await c.req.json<{
    rows: Array<typeof prospects.$inferInsert>;
    filename?: string;
    campaignId?: string;
  }>();

  if (!Array.isArray(rows) || rows.length === 0) {
    return c.json({ error: "rows array required" }, 400);
  }

  // Detect duplicates against existing DB records
  const emails_in = rows.map((r) => r.email).filter(Boolean);
  const existing = await db
    .select({ email: prospects.email })
    .from(prospects)
    .where(inArray(prospects.email, emails_in));
  const existingSet = new Set(existing.map((e) => e.email));

  const toInsert = rows
    .filter((r) => r.email && !existingSet.has(r.email))
    .map((r) => ({
      ...r,
      id: crypto.randomUUID(),
      unsubscribeToken: crypto.randomUUID(),
      campaignId: campaignId ?? r.campaignId,
    }));

  const duplicateCount = rows.length - toInsert.length;

  let inserted: typeof prospects.$inferSelect[] = [];
  if (toInsert.length > 0) {
    inserted = await db.insert(prospects).values(toInsert).returning();
  }

  // Record import history
  await db.insert(importHistory).values({
    id: crypto.randomUUID(),
    filename,
    rowCount: rows.length,
    successCount: inserted.length,
    duplicateCount,
    skippedCount: 0,
    campaignId,
  });

  await audit(db, "import", filename, "csv_imported", {
    rowCount: rows.length,
    successCount: inserted.length,
    duplicateCount,
  });

  await invalidateCache(c.env, "analytics:");

  return c.json({
    inserted: inserted.length,
    duplicates: duplicateCount,
    duplicateEmails: [...existingSet].filter((e) => emails_in.includes(e)),
  }, 201);
});

// ─── CSV export ───────────────────────────────────────────────────────────────

app.get("/export", async (c) => {
  const db = createDb(c.env);
  const { status, campaignId, ids } = c.req.query();

  const conditions = [];
  if (status) conditions.push(eq(prospects.status, status as ProspectStatus));
  if (campaignId) conditions.push(eq(prospects.campaignId, campaignId));
  if (ids) conditions.push(inArray(prospects.id, ids.split(",")));

  const rows = await db
    .select()
    .from(prospects)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(prospects.createdAt));

  const headers = ["id", "name", "email", "company", "title", "phone", "location", "status", "score", "dealValue", "createdAt"];
  const csv = [
    headers.join(","),
    ...rows.map((r) =>
      headers.map((h) => {
        const val = (r as any)[h] ?? "";
        return typeof val === "string" && val.includes(",") ? `"${val}"` : val;
      }).join(","),
    ),
  ].join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="prospects-${Date.now()}.csv"`,
    },
  });
});

// ─── Get single ───────────────────────────────────────────────────────────────

app.get("/:id", async (c) => {
  const db = createDb(c.env);
  const [row] = await db
    .select()
    .from(prospects)
    .where(eq(prospects.id, c.req.param("id")));
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

// ─── Update ───────────────────────────────────────────────────────────────────

app.patch("/:id", async (c) => {
  const db = createDb(c.env);
  const data = await c.req.json<Partial<typeof prospects.$inferInsert>>();
  const prev = await db.select().from(prospects).where(eq(prospects.id, c.req.param("id")));
  if (!prev[0]) return c.json({ error: "Not found" }, 404);

  const [updated] = await db
    .update(prospects)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(prospects.id, c.req.param("id")))
    .returning();

  // Fire webhook if status changed
  if (data.status && data.status !== prev[0].status) {
    await audit(db, "prospect", updated.id, "status_changed", {
      from: prev[0].status,
      to: data.status,
    });
    await fireWebhooks(db, "prospect.status_changed", {
      prospect: updated,
      previousStatus: prev[0].status,
    });
  }

  await invalidateCache(c.env, "analytics:");
  return c.json(updated);
});

// ─── Delete ───────────────────────────────────────────────────────────────────

app.delete("/:id", async (c) => {
  const db = createDb(c.env);
  await db.delete(prospects).where(eq(prospects.id, c.req.param("id")));
  return c.body(null, 204);
});

// ─── Enrich via AI service ────────────────────────────────────────────────────

app.post("/:id/enrich", async (c) => {
  const db = createDb(c.env);
  const [prospect] = await db
    .select()
    .from(prospects)
    .where(eq(prospects.id, c.req.param("id")));
  if (!prospect) return c.json({ error: "Not found" }, 404);
  if (!prospect.website && !prospect.company) {
    return c.json({ error: "Prospect needs website or company to enrich" }, 400);
  }

  const res = await c.env.AI_SERVICE.fetch("http://ai/enrich-website", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: prospect.website, company: prospect.company }),
  });

  if (!res.ok) return c.json({ error: "Enrichment failed" }, 502);

  const enriched = await res.json<Partial<typeof prospects.$inferInsert>>();
  const [updated] = await db
    .update(prospects)
    .set({ ...enriched, enrichedAt: new Date(), updatedAt: new Date() })
    .where(eq(prospects.id, c.req.param("id")))
    .returning();

  await audit(db, "prospect", updated.id, "enriched");
  return c.json(updated);
});

// ─── Lead score ───────────────────────────────────────────────────────────────

app.post("/:id/score", async (c) => {
  const db = createDb(c.env);
  const [prospect] = await db
    .select()
    .from(prospects)
    .where(eq(prospects.id, c.req.param("id")));
  if (!prospect) return c.json({ error: "Not found" }, 404);

  const res = await c.env.AI_SERVICE.fetch("http://ai/score-prospect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prospect }),
  });

  const { score, reasoning } = await res.json<{ score: number; reasoning: string }>();

  const [updated] = await db
    .update(prospects)
    .set({ score, updatedAt: new Date() })
    .where(eq(prospects.id, c.req.param("id")))
    .returning();

  return c.json({ score, reasoning, prospect: updated });
});

// ─── Unsubscribe (token-based, no auth required) ──────────────────────────────

app.get("/unsubscribe/:token", async (c) => {
  const db = createDb(c.env);
  const [prospect] = await db
    .select()
    .from(prospects)
    .where(eq(prospects.unsubscribeToken, c.req.param("token")));

  if (!prospect) return c.json({ error: "Invalid token" }, 404);

  await db
    .update(prospects)
    .set({ status: "unsubscribed", updatedAt: new Date() })
    .where(eq(prospects.id, prospect.id));

  await audit(db, "prospect", prospect.id, "unsubscribed");
  await fireWebhooks(db, "prospect.status_changed", {
    prospect: { ...prospect, status: "unsubscribed" },
    previousStatus: prospect.status,
  });

  return c.html(`
    <!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:60px">
    <h2>You've been unsubscribed</h2>
    <p>You won't receive further emails from this sender.</p>
    </body></html>
  `);
});

// ─── Generate email ───────────────────────────────────────────────────────────

app.post("/:id/generate-email", async (c) => {
  const db = createDb(c.env);
  const [prospect] = await db
    .select()
    .from(prospects)
    .where(eq(prospects.id, c.req.param("id")));
  if (!prospect) return c.json({ error: "Not found" }, 404);

  const { templateId, threadContext, personaId } = await c.req.json<{
    templateId?: string;
    threadContext?: string;
    personaId?: string;
  }>();

  const endpoint = threadContext ? "http://ai/follow-up" : "http://ai/generate";
  const res = await c.env.AI_SERVICE.fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prospect, templateId, threadContext, personaId }),
  });

  return new Response(res.body, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
});

// ─── Bulk generate ────────────────────────────────────────────────────────────

app.post("/bulk-generate", async (c) => {
  const { ids, templateId, personaId, campaignId } = await c.req.json<{
    ids: string[];
    templateId?: string;
    personaId?: string;
    campaignId?: string;
  }>();

  if (!Array.isArray(ids) || ids.length === 0) {
    return c.json({ error: "ids array required" }, 400);
  }

  await c.env.GENERATE_QUEUE.sendBatch(
    ids.map((prospectId) => ({
      body: { prospectId, templateId, personaId, campaignId } satisfies GenerateJob,
    })),
  );

  return c.json({ queued: ids.length });
});

export default app;
