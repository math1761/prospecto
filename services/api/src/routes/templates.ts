import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import { createDb, type Env } from "../db/client";
import { templates, emails, prospects } from "../db/schema";
import { getCached, setCache, invalidateCache, TTL_TEMPLATES } from "../lib/cache";

const CACHE_KEY = "templates:list";

const app = new Hono<{ Bindings: Env }>();

app.get("/", async (c) => {
  const cached = await getCached<any>(c.env, CACHE_KEY);
  if (cached) return c.json(cached);

  const db = createDb(c.env);
  const rows = await db.select().from(templates).orderBy(desc(templates.createdAt));

  await setCache(c.env, CACHE_KEY, rows, TTL_TEMPLATES);
  return c.json(rows);
});

app.post("/", async (c) => {
  const db = createDb(c.env);
  const body = await c.req.json<typeof templates.$inferInsert>();
  const [row] = await db
    .insert(templates)
    .values({ ...body, id: crypto.randomUUID() })
    .returning();
  await invalidateCache(c.env, "templates:");
  return c.json(row, 201);
});

app.get("/:id", async (c) => {
  const db = createDb(c.env);
  const [row] = await db.select().from(templates).where(eq(templates.id, c.req.param("id")));
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

app.patch("/:id", async (c) => {
  const db = createDb(c.env);
  const data = await c.req.json<Partial<typeof templates.$inferInsert>>();
  const [updated] = await db
    .update(templates)
    .set(data)
    .where(eq(templates.id, c.req.param("id")))
    .returning();
  if (!updated) return c.json({ error: "Not found" }, 404);
  await invalidateCache(c.env, "templates:");
  return c.json(updated);
});

app.delete("/:id", async (c) => {
  const db = createDb(c.env);
  await db.delete(templates).where(eq(templates.id, c.req.param("id")));
  await invalidateCache(c.env, "templates:");
  return c.body(null, 204);
});

// ─── Version a template (prompt version control) ──────────────────────────────

app.post("/:id/version", async (c) => {
  const db = createDb(c.env);
  const { subjectPrompt, bodyPrompt, version } = await c.req.json<{
    subjectPrompt: string;
    bodyPrompt: string;
    version: string;
  }>();

  const [parent] = await db.select().from(templates).where(eq(templates.id, c.req.param("id")));
  if (!parent) return c.json({ error: "Not found" }, 404);

  const [newVersion] = await db
    .insert(templates)
    .values({
      id: crypto.randomUUID(),
      name: parent.name,
      subjectPrompt,
      bodyPrompt,
      version,
      parentId: parent.id,
      isDefault: false,
    })
    .returning();

  await invalidateCache(c.env, "templates:");
  return c.json(newVersion, 201);
});

// ─── Version history ──────────────────────────────────────────────────────────

app.get("/:id/versions", async (c) => {
  const db = createDb(c.env);
  const [root] = await db.select().from(templates).where(eq(templates.id, c.req.param("id")));
  if (!root) return c.json({ error: "Not found" }, 404);

  const all = await db.select().from(templates).where(eq(templates.parentId, root.id));

  return c.json([root, ...all].sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1)));
});

// ─── Per-template stats (open/reply rate across sent emails) ──────────────────

app.get("/:id/stats", async (c) => {
  const db = createDb(c.env);
  const [tmpl] = await db.select().from(templates).where(eq(templates.id, c.req.param("id")));
  if (!tmpl) return c.json({ error: "Not found" }, 404);

  const rows = await db.select().from(emails).where(eq(emails.templateId, tmpl.id));
  const sent = rows.filter((e) => e.sentAt).length;
  const opened = rows.filter((e) => e.openedAt).length;
  const replied = rows.filter((e) => e.repliedAt).length;

  const openRate = sent > 0 ? Math.round((opened / sent) * 100) : null;
  const replyRate = sent > 0 ? Math.round((replied / sent) * 100) : null;

  if (openRate !== null) {
    await db
      .update(templates)
      .set({ openRate, replyRate: replyRate ?? 0 })
      .where(eq(templates.id, tmpl.id));
  }

  return c.json({ sent, opened, replied, openRate, replyRate });
});

// ─── AI Prompt Coach (F21) ────────────────────────────────────────────────────

app.post("/:id/coach", async (c) => {
  const db = createDb(c.env);
  const [tmpl] = await db.select().from(templates).where(eq(templates.id, c.req.param("id")));
  if (!tmpl) return c.json({ error: "Not found" }, 404);

  const res = await c.env.AI_SERVICE.fetch("http://ai/prompt-coach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: tmpl.subjectPrompt,
      body: tmpl.bodyPrompt,
      prospect: { name: "Sample", email: "sample@example.com", company: "Acme Corp" },
    }),
  });

  const result = await res.json<{
    score: number;
    breakdown: Record<string, number>;
    suggestions: string[];
    quickFixes: Array<{ field: string; range: number[]; replacement: string }>;
  }>();

  await db
    .update(templates)
    .set({ coachScore: result.score, avgQualityScore: result.score })
    .where(eq(templates.id, tmpl.id));

  return c.json(result);
});

app.post("/coach-live", async (c) => {
  const { subject, body, prospectId } = await c.req.json<{
    subject: string;
    body: string;
    prospectId?: string;
  }>();

  let prospect = { name: "Sample", email: "sample@example.com" };
  if (prospectId) {
    const db = createDb(c.env);
    const [row] = await db.select().from(prospects).where(eq(prospects.id, prospectId));
    if (row) prospect = row;
  }

  const res = await c.env.AI_SERVICE.fetch("http://ai/prompt-coach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject, body, prospect }),
  });

  return new Response(res.body, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
});

export default app;
