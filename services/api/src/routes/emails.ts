import { Hono } from "hono";
import { eq, desc, and } from "drizzle-orm";
import { createDb, type Env } from "../db/client";
import { emails, prospects, prospectActivities } from "../db/schema";

import { audit } from "../lib/audit";
import { fireWebhooks } from "../lib/webhooks";
import { spamCheck } from "../lib/spam";
import { invalidateCache } from "../lib/cache";
import { wrapForClient, toHtml } from "../lib/email-preview";
import { dispatchEmail } from "../lib/email-dispatch";
import type { SendJob } from "../lib/jobs";

const app = new Hono<{ Bindings: Env }>();

// ─── List ─────────────────────────────────────────────────────────────────────

app.get("/", async (c) => {
  const db = createDb(c.env);
  const { prospectId, campaignId } = c.req.query();
  const conditions = [];
  if (prospectId) conditions.push(eq(emails.prospectId, prospectId));
  if (campaignId) conditions.push(eq(emails.campaignId, campaignId));

  const rows = await db
    .select()
    .from(emails)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(emails.createdAt));

  return c.json(rows);
});

// ─── Create draft ─────────────────────────────────────────────────────────────

app.post("/", async (c) => {
  const db = createDb(c.env);
  const body = await c.req.json<typeof emails.$inferInsert>();

  // Run spam check inline before storing
  const spam = spamCheck(body.subject, body.body);

  const [row] = await db
    .insert(emails)
    .values({
      ...body,
      id: crypto.randomUUID(),
      trackingId: crypto.randomUUID(),
      spamScore: spam.score,
    })
    .returning();

  return c.json({ ...row, spamFlags: spam.flags }, 201);
});

// ─── Get single ───────────────────────────────────────────────────────────────

app.get("/:id", async (c) => {
  const db = createDb(c.env);
  const [row] = await db
    .select()
    .from(emails)
    .where(eq(emails.id, c.req.param("id")));
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

// ─── Update draft (inline editor) ────────────────────────────────────────────

app.patch("/:id", async (c) => {
  const db = createDb(c.env);
  const data = await c.req.json<Partial<typeof emails.$inferInsert>>();

  // Re-run spam check if body/subject changed
  let spamUpdate: { spamScore?: number } = {};
  if (data.subject || data.body) {
    const [existing] = await db.select().from(emails).where(eq(emails.id, c.req.param("id")));
    if (existing) {
      const spam = spamCheck(data.subject ?? existing.subject, data.body ?? existing.body);
      spamUpdate = { spamScore: spam.score };
    }
  }

  const [updated] = await db
    .update(emails)
    .set({ ...data, ...spamUpdate })
    .where(eq(emails.id, c.req.param("id")))
    .returning();

  if (!updated) return c.json({ error: "Not found" }, 404);
  return c.json(updated);
});

// ─── Score email quality ──────────────────────────────────────────────────────

app.post("/:id/score", async (c) => {
  const db = createDb(c.env);
  const emailId = c.req.param("id");
  const [row] = await db
    .select({ email: emails, prospect: prospects })
    .from(emails)
    .innerJoin(prospects, eq(emails.prospectId, prospects.id))
    .where(eq(emails.id, emailId));

  if (!row) return c.json({ error: "Not found" }, 404);

  const res = await c.env.AI_SERVICE.fetch("http://ai/score", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: row.email.subject,
      body: row.email.body,
      prospect: row.prospect,
    }),
  });

  const { score, feedback } = await res.json<{ score: number; feedback: string }>();

  const [updated] = await db
    .update(emails)
    .set({ qualityScore: score })
    .where(eq(emails.id, emailId))
    .returning();

  return c.json({ score, feedback, email: updated });
});

// ─── Spam check ───────────────────────────────────────────────────────────────

app.post("/:id/spam-check", async (c) => {
  const db = createDb(c.env);
  const [row] = await db.select().from(emails).where(eq(emails.id, c.req.param("id")));
  if (!row) return c.json({ error: "Not found" }, 404);

  const result = spamCheck(row.subject, row.body);
  await db.update(emails).set({ spamScore: result.score }).where(eq(emails.id, row.id));

  return c.json(result);
});

// ─── Multi-channel variants ───────────────────────────────────────────────────

app.post("/:id/variants", async (c) => {
  const db = createDb(c.env);
  const [row] = await db
    .select({ email: emails, prospect: prospects })
    .from(emails)
    .innerJoin(prospects, eq(emails.prospectId, prospects.id))
    .where(eq(emails.id, c.req.param("id")));
  if (!row) return c.json({ error: "Not found" }, 404);

  const res = await c.env.AI_SERVICE.fetch("http://ai/variants", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: row.email.subject,
      body: row.email.body,
      prospect: row.prospect,
    }),
  });

  return new Response(res.body, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
});

// ─── Generate objection response ──────────────────────────────────────────────

app.post("/:id/respond-objection", async (c) => {
  const db = createDb(c.env);
  const { replyBody } = await c.req.json<{ replyBody: string }>();
  const [row] = await db
    .select({ email: emails, prospect: prospects })
    .from(emails)
    .innerJoin(prospects, eq(emails.prospectId, prospects.id))
    .where(eq(emails.id, c.req.param("id")));
  if (!row) return c.json({ error: "Not found" }, 404);

  const res = await c.env.AI_SERVICE.fetch("http://ai/objection", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      originalEmail: { subject: row.email.subject, body: row.email.body },
      replyBody,
      prospect: row.prospect,
    }),
  });

  return new Response(res.body, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
});

// ─── Smart send-time prediction ───────────────────────────────────────────────

app.post("/:id/predict-send-time", async (c) => {
  const db = createDb(c.env);
  const [row] = await db
    .select({ email: emails, prospect: prospects })
    .from(emails)
    .innerJoin(prospects, eq(emails.prospectId, prospects.id))
    .where(eq(emails.id, c.req.param("id")));
  if (!row) return c.json({ error: "Not found" }, 404);

  const res = await c.env.AI_SERVICE.fetch("http://ai/send-time", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      timezone: row.prospect.timezone,
      industry: row.prospect.industry,
      location: row.prospect.location,
    }),
  });

  const result = await res.json<{ recommendedTime: string; reasoning: string }>();

  if (result.recommendedTime) {
    await db
      .update(emails)
      .set({ scheduledAt: new Date(result.recommendedTime) })
      .where(eq(emails.id, row.email.id));
  }

  return c.json(result);
});

// ─── Send ─────────────────────────────────────────────────────────────────────

app.post("/:id/send", async (c) => {
  const db = createDb(c.env);
  const res = await dispatchEmail(db, c.env, c.req.param("id"));
  const data = await res.json();
  return new Response(JSON.stringify(data), { status: res.status, headers: { "Content-Type": "application/json" } });
});

// ─── Bulk send ────────────────────────────────────────────────────────────────

app.post("/bulk-send", async (c) => {
  const { ids } = await c.req.json<{ ids: string[] }>();
  if (!Array.isArray(ids) || ids.length === 0) {
    return c.json({ error: "ids array required" }, 400);
  }

  await c.env.SEND_QUEUE.sendBatch(
    ids.map((emailId) => ({
      body: { emailId } satisfies SendJob,
    })),
  );

  return c.json({ queued: ids.length });
});

// ─── Open tracking pixel ──────────────────────────────────────────────────────

app.get("/track/:trackingId/open", async (c) => {
  const db = createDb(c.env);
  const [updated] = await db
    .update(emails)
    .set({ openedAt: new Date() })
    .where(and(
      eq(emails.trackingId, c.req.param("trackingId")),
      // Only record first open
      eq(emails.openedAt, null as any),
    ))
    .returning();

  if (updated) {
    await fireWebhooks(db, "email.opened", { emailId: updated.id, prospectId: updated.prospectId });
    await db.insert(prospectActivities).values({
      id: crypto.randomUUID(),
      prospectId: updated.prospectId,
      emailId: updated.id,
      type: "email_opened",
    });
    await db.update(prospects).set({ lastActivityAt: new Date() }).where(eq(prospects.id, updated.prospectId));
  }

  // Return 1x1 transparent GIF
  const gif = new Uint8Array([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00,
    0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00,
    0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
    0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
  ]);
  return new Response(gif, {
    headers: { "Content-Type": "image/gif", "Cache-Control": "no-store" },
  });
});

// ─── Click tracking redirect ──────────────────────────────────────────────────

app.get("/track/:trackingId/click", async (c) => {
  const db = createDb(c.env);
  const url = c.req.query("url");
  if (!url) return c.redirect("/");

  await db
    .update(emails)
    .set({ clickedAt: new Date() })
    .where(and(
      eq(emails.trackingId, c.req.param("trackingId")),
      eq(emails.clickedAt, null as any),
    ));

  // Record click activity
  const [clickedEmail] = await db
    .select()
    .from(emails)
    .where(eq(emails.trackingId, c.req.param("trackingId")));
  if (clickedEmail) {
    await db.insert(prospectActivities).values({
      id: crypto.randomUUID(),
      prospectId: clickedEmail.prospectId,
      emailId: clickedEmail.id,
      type: "email_clicked",
      meta: { url },
    });
    await db.update(prospects).set({ lastActivityAt: new Date() }).where(eq(prospects.id, clickedEmail.prospectId));
  }

  return c.redirect(decodeURIComponent(url));
});

// ─── Inbound reply webhook (from Resend / email provider) ─────────────────────

app.post("/inbound-reply", async (c) => {
  const db = createDb(c.env);
  const body = await c.req.json<{
    from: string;
    subject: string;
    text: string;
    inReplyTo?: string;
  }>();

  // Match by from email
  const [prospect] = await db
    .select()
    .from(prospects)
    .where(eq(prospects.email, body.from));

  if (!prospect) return c.json({ ok: true }); // Unknown sender, ignore

  // Classify reply sentiment via AI
  const sentimentRes = await c.env.AI_SERVICE.fetch("http://ai/sentiment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: body.text }),
  });

  const { sentiment } = await sentimentRes.json<{
    sentiment: "positive" | "neutral" | "negative" | "out_of_office";
  }>();

  // Update prospect status to replied + record sentiment
  await db
    .update(prospects)
    .set({ status: "replied", sentiment, updatedAt: new Date(), lastActivityAt: new Date() })
    .where(eq(prospects.id, prospect.id));

  // Mark matching email as replied
  if (body.inReplyTo) {
    await db
      .update(emails)
      .set({ repliedAt: new Date(), replyBody: body.text })
      .where(eq(emails.trackingId, body.inReplyTo));
  }

  await audit(db, "prospect", prospect.id, "replied", { sentiment });
  await fireWebhooks(db, "prospect.replied", { prospect, sentiment, replyBody: body.text });

  await db.insert(prospectActivities).values({
    id: crypto.randomUUID(),
    prospectId: prospect.id,
    type: "reply_received",
    meta: { sentiment, replyBody: body.text },
  });
  await invalidateCache(c.env, "analytics:");

  return c.json({ ok: true, sentiment });
});

// ─── Multi-client email preview (F28) ──────────────────────────────────────────

app.post("/:id/preview", async (c) => {
  const db = createDb(c.env);
  const [row] = await db.select().from(emails).where(eq(emails.id, c.req.param("id")));
  if (!row) return c.json({ error: "Not found" }, 404);

  const { clients } = await c.req.json<{ clients: string[] }>();
  const html = toHtml(row.body);
  const previews: Record<string, string> = {};
  for (const client of (clients ?? ["gmail", "outlook", "apple_mail"])) {
    previews[client] = wrapForClient(html, client);
  }
  return c.json({ previews });
});

app.post("/preview-raw", async (c) => {
  const { subject, body, clients } = await c.req.json<{
    subject: string;
    body: string;
    clients?: string[];
  }>();

  const html = toHtml(body);
  const previews: Record<string, string> = {};
  for (const client of (clients ?? ["gmail", "outlook", "apple_mail"])) {
    previews[client] = wrapForClient(html, client);
  }
  return c.json({ previews });
});

export default app;
