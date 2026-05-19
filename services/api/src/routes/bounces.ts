import { Hono } from "hono";
import { eq, desc, sql } from "drizzle-orm";
import { createDb, type Env } from "../db/client";
import { bounceEvents, emails, prospects, prospectActivities } from "../db/schema";
import { classifyBounce } from "../lib/bounce";
import type { SendJob } from "../lib/jobs";

const app = new Hono<{ Bindings: Env }>();

app.post("/inbound", async (c) => {
  const db = createDb(c.env);
  const { emailId, smtpCode, diagnosticCode, senderDomain } = await c.req.json<{
    emailId: string;
    smtpCode: string;
    diagnosticCode?: string;
    senderDomain?: string;
  }>();

  const [email] = await db.select().from(emails).where(eq(emails.id, emailId));
  if (!email) return c.json({ error: "Email not found" }, 404);

  const classification = classifyBounce(smtpCode, diagnosticCode ?? "");

  const [event] = await db
    .insert(bounceEvents)
    .values({
      id: crypto.randomUUID(),
      emailId,
      prospectId: email.prospectId,
      bounceClass: classification.bounceClass,
      smtpCode,
      diagnosticCode,
      senderDomain,
      nextRetryAt: classification.shouldRetry
        ? new Date(Date.now() + classification.retryDelayMs)
        : null,
    })
    .returning();

  await db
    .update(emails)
    .set({ bounceStatus: classification.bounceClass, bouncedAt: new Date() })
    .where(eq(emails.id, emailId));

  await db.insert(prospectActivities).values({
    id: crypto.randomUUID(),
    prospectId: email.prospectId,
    emailId,
    type: "bounced",
    meta: { bounceClass: classification.bounceClass, smtpCode },
  });

  if (classification.bounceClass === "hard") {
    await db
      .update(prospects)
      .set({ status: "rejected", updatedAt: new Date() })
      .where(eq(prospects.id, email.prospectId));
  }

  if (classification.shouldRetry) {
    const job: SendJob = { emailId };
    await c.env.SEND_QUEUE.send(job, { delaySeconds: classification.retryDelayMs / 1000 });
  }

  return c.json({ event, classification });
});

app.get("/", async (c) => {
  const db = createDb(c.env);
  const { class: bounceClass, prospectId, emailId } = c.req.query();

  const conditions = [];
  if (bounceClass) conditions.push(eq(bounceEvents.bounceClass, bounceClass as "hard" | "soft" | "transient"));
  if (prospectId) conditions.push(eq(bounceEvents.prospectId, prospectId));
  if (emailId) conditions.push(eq(bounceEvents.emailId, emailId));

  const rows = await db
    .select()
    .from(bounceEvents)
    .where(conditions.length ? eq(bounceEvents.id, bounceEvents.id) : undefined)
    .orderBy(desc(bounceEvents.createdAt))
    .limit(100);

  return c.json(rows);
});

app.get("/stats", async (c) => {
  const db = createDb(c.env);
  const [stats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      hard: sql<number>`count(*) filter (where bounce_class = 'hard')::int`,
      soft: sql<number>`count(*) filter (where bounce_class = 'soft')::int`,
      transient: sql<number>`count(*) filter (where bounce_class = 'transient')::int`,
    })
    .from(bounceEvents);

  const [sentCount] = await db
    .select({ total: sql<number>`count(*) filter (where sent_at is not null)::int` })
    .from(emails);

  const bounceRate = sentCount.total > 0 ? stats.total / sentCount.total : 0;

  return c.json({ ...stats, bounceRate: Math.round(bounceRate * 1000) / 10 });
});

app.post("/:id/retry", async (c) => {
  const db = createDb(c.env);
  const [event] = await db
    .select()
    .from(bounceEvents)
    .where(eq(bounceEvents.id, c.req.param("id")));
  if (!event) return c.json({ error: "Not found" }, 404);

  const job: SendJob = { emailId: event.emailId };
  await c.env.SEND_QUEUE.send(job);

  await db
    .update(bounceEvents)
    .set({ retryCount: event.retryCount + 1 })
    .where(eq(bounceEvents.id, event.id));

  return c.json({ retrying: event.emailId });
});

export default app;
