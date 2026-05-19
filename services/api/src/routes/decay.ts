import { Hono } from "hono";
import { eq, lte, and, sql, inArray, desc } from "drizzle-orm";
import { createDb, type Env } from "../db/client";
import { prospects, prospectActivities, emails } from "../db/schema";
import { computeDecayScores } from "../lib/decay";

const app = new Hono<{ Bindings: Env }>();

app.post("/scan", async (c) => {
  const db = createDb(c.env);
  const results = await computeDecayScores(db);
  return c.json(results);
});

app.get("/prospects", async (c) => {
  const db = createDb(c.env);
  const { status, page = "1", limit = "50" } = c.req.query();
  if (!status) return c.json({ error: "status required (stale|cold|archived)" }, 400);

  const rows = await db
    .select()
    .from(prospects)
    .where(eq(prospects.decayStatus, status))
    .orderBy(desc(prospects.decayScore))
    .limit(Math.min(Number(limit), 200))
    .offset((Number(page) - 1) * Number(limit));

  return c.json(rows);
});

app.post("/:prospectId/reengage", async (c) => {
  const db = createDb(c.env);
  const pid = c.req.param("prospectId");
  const [prospect] = await db.select().from(prospects).where(eq(prospects.id, pid));
  if (!prospect) return c.json({ error: "Not found" }, 404);

  const prevEmails = await db
    .select()
    .from(emails)
    .where(eq(emails.prospectId, pid))
    .orderBy(desc(emails.createdAt))
    .limit(3);

  const daysSinceActivity = prospect.lastActivityAt
    ? Math.floor((Date.now() - prospect.lastActivityAt.getTime()) / 86400000)
    : null;

  const res = await c.env.AI_SERVICE.fetch("http://ai/reengage-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prospect,
      lastActivityDays: daysSinceActivity,
      previousEmails: prevEmails.map((e) => ({ subject: e.subject, sentAt: e.sentAt })),
    }),
  });

  const { subject, body } = await res.json<{ subject: string; body: string }>();

  const [email] = await db
    .insert(emails)
    .values({
      id: crypto.randomUUID(),
      prospectId: pid,
      campaignId: prospect.campaignId,
      subject,
      body,
      trackingId: crypto.randomUUID(),
    })
    .returning();

  await db.insert(prospectActivities).values({
    id: crypto.randomUUID(),
    prospectId: pid,
    emailId: email.id,
    type: "decay_reengaged",
  });

  return c.json({ email, subject, body });
});

app.post("/:prospectId/archive", async (c) => {
  const db = createDb(c.env);
  const pid = c.req.param("prospectId");

  await db
    .update(prospects)
    .set({ status: "rejected", decayStatus: "archived", updatedAt: new Date() })
    .where(eq(prospects.id, pid));

  await db.insert(prospectActivities).values({
    id: crypto.randomUUID(),
    prospectId: pid,
    type: "decay_archived",
    meta: { reason: "decay_archived" },
  });

  return c.json({ archived: pid });
});

app.post("/bulk-action", async (c) => {
  const { prospectIds, action } = await c.req.json<{
    prospectIds: string[];
    action: "archive" | "reengage";
  }>();

  if (!prospectIds?.length) return c.json({ error: "prospectIds required" }, 400);

  if (action === "archive") {
    const db = createDb(c.env);
    await db
      .update(prospects)
      .set({ status: "rejected", decayStatus: "archived", updatedAt: new Date() })
      .where(inArray(prospects.id, prospectIds));

    for (const pid of prospectIds) {
      await db.insert(prospectActivities).values({
        id: crypto.randomUUID(),
        prospectId: pid,
        type: "decay_archived",
        meta: { reason: "bulk_decay_archived" },
      });
    }
    return c.json({ archived: prospectIds.length });
  }

  return c.json({ message: "Use /:prospectId/reengage for individual re-engagement" });
});

export default app;
