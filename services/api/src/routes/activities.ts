import { Hono } from "hono";
import { eq, desc, and, sql, gte, lte } from "drizzle-orm";
import { createDb, type Env } from "../db/client";
import { prospectActivities, prospects } from "../db/schema";

const app = new Hono<{ Bindings: Env }>();

app.get("/", async (c) => {
  const db = createDb(c.env);
  const { prospectId, type, from, to, page = "1", limit = "50" } = c.req.query();

  const conditions = [];
  if (prospectId) conditions.push(eq(prospectActivities.prospectId, prospectId));
  if (type) conditions.push(eq(prospectActivities.type, type));
  if (from) conditions.push(gte(prospectActivities.createdAt, new Date(from)));
  if (to) conditions.push(lte(prospectActivities.createdAt, new Date(to)));

  const rows = await db
    .select()
    .from(prospectActivities)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(prospectActivities.createdAt))
    .limit(Math.min(Number(limit), 200))
    .offset((Number(page) - 1) * Number(limit));

  return c.json(rows);
});

app.post("/", async (c) => {
  const db = createDb(c.env);
  const { prospectId, type, meta, emailId } = await c.req.json<{
    prospectId: string;
    type: string;
    meta?: Record<string, unknown>;
    emailId?: string;
  }>();

  const [row] = await db
    .insert(prospectActivities)
    .values({ id: crypto.randomUUID(), prospectId, type, meta, emailId })
    .returning();

  await db
    .update(prospects)
    .set({ lastActivityAt: new Date() })
    .where(eq(prospects.id, prospectId));

  return c.json(row, 201);
});

app.get("/prospect/:prospectId/summary", async (c) => {
  const db = createDb(c.env);
  const pid = c.req.param("prospectId");

  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      email_sent: sql<number>`count(*) filter (where type = 'email_sent')::int`,
      email_opened: sql<number>`count(*) filter (where type = 'email_opened')::int`,
      email_clicked: sql<number>`count(*) filter (where type = 'email_clicked')::int`,
      reply_received: sql<number>`count(*) filter (where type = 'reply_received')::int`,
      status_changed: sql<number>`count(*) filter (where type = 'status_changed')::int`,
    })
    .from(prospectActivities)
    .where(eq(prospectActivities.prospectId, pid));

  const [last] = await db
    .select({ at: prospectActivities.createdAt })
    .from(prospectActivities)
    .where(eq(prospectActivities.prospectId, pid))
    .orderBy(desc(prospectActivities.createdAt))
    .limit(1);

  return c.json({
    counts,
    lastActivityAt: last?.at ?? null,
    daysSinceLastActivity: last?.at
      ? Math.floor((Date.now() - last.at.getTime()) / 86400000)
      : null,
  });
});

app.post("/backfill", async (c) => {
  const db = createDb(c.env);
  const { emails: emailRows } = await import("../db/schema");
  const allEmails = await db
    .select()
    .from(emailRows)
    .orderBy(emailRows.createdAt);

  let backfilled = 0;
  for (const e of allEmails) {
    const entries: Array<{ type: string; meta?: Record<string, unknown> }> = [];
    if (e.sentAt) entries.push({ type: "email_sent", meta: { subject: e.subject } });
    if (e.openedAt) entries.push({ type: "email_opened" });
    if (e.clickedAt) entries.push({ type: "email_clicked" });
    if (e.repliedAt) entries.push({ type: "reply_received", meta: { replyBody: e.replyBody } });

    for (const entry of entries) {
      await db.insert(prospectActivities).values({
        id: crypto.randomUUID(),
        prospectId: e.prospectId,
        emailId: e.id,
        type: entry.type,
        meta: entry.meta,
      });
      backfilled++;
    }
  }

  return c.json({ backfilled });
});

export default app;
