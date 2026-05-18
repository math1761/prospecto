import { Hono } from "hono";
import { eq, and, lte, desc } from "drizzle-orm";
import { createDb, type Env } from "../db/client";
import {
  sequences,
  sequenceSteps,
  sequenceEnrollments,
  prospects,
  emails,
} from "../db/schema";


const app = new Hono<{ Bindings: Env }>();

// ─── Sequences CRUD ───────────────────────────────────────────────────────────

app.get("/", async (c) => {
  const db = createDb(c.env);
  const rows = await db.select().from(sequences).orderBy(desc(sequences.createdAt));
  return c.json(rows);
});

app.post("/", async (c) => {
  const db = createDb(c.env);
  const body = await c.req.json<typeof sequences.$inferInsert>();
  const [row] = await db
    .insert(sequences)
    .values({ ...body, id: crypto.randomUUID() })
    .returning();
  return c.json(row, 201);
});

app.get("/:id", async (c) => {
  const db = createDb(c.env);
  const [seq] = await db.select().from(sequences).where(eq(sequences.id, c.req.param("id")));
  if (!seq) return c.json({ error: "Not found" }, 404);
  const steps = await db
    .select()
    .from(sequenceSteps)
    .where(eq(sequenceSteps.sequenceId, seq.id))
    .orderBy(sequenceSteps.stepNumber);
  return c.json({ ...seq, steps });
});

app.patch("/:id", async (c) => {
  const db = createDb(c.env);
  const data = await c.req.json<Partial<typeof sequences.$inferInsert>>();
  const [updated] = await db
    .update(sequences)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(sequences.id, c.req.param("id")))
    .returning();
  if (!updated) return c.json({ error: "Not found" }, 404);
  return c.json(updated);
});

app.delete("/:id", async (c) => {
  const db = createDb(c.env);
  await db.delete(sequences).where(eq(sequences.id, c.req.param("id")));
  return c.body(null, 204);
});

// ─── Steps CRUD ───────────────────────────────────────────────────────────────

app.get("/:id/steps", async (c) => {
  const db = createDb(c.env);
  const steps = await db
    .select()
    .from(sequenceSteps)
    .where(eq(sequenceSteps.sequenceId, c.req.param("id")))
    .orderBy(sequenceSteps.stepNumber);
  return c.json(steps);
});

app.post("/:id/steps", async (c) => {
  const db = createDb(c.env);
  const body = await c.req.json<typeof sequenceSteps.$inferInsert>();
  const [row] = await db
    .insert(sequenceSteps)
    .values({ ...body, id: crypto.randomUUID(), sequenceId: c.req.param("id") })
    .returning();
  return c.json(row, 201);
});

app.patch("/:id/steps/:stepId", async (c) => {
  const db = createDb(c.env);
  const data = await c.req.json<Partial<typeof sequenceSteps.$inferInsert>>();
  const [updated] = await db
    .update(sequenceSteps)
    .set(data)
    .where(eq(sequenceSteps.id, c.req.param("stepId")))
    .returning();
  if (!updated) return c.json({ error: "Not found" }, 404);
  return c.json(updated);
});

app.delete("/:id/steps/:stepId", async (c) => {
  const db = createDb(c.env);
  await db.delete(sequenceSteps).where(eq(sequenceSteps.id, c.req.param("stepId")));
  return c.body(null, 204);
});

// ─── Enroll prospects ─────────────────────────────────────────────────────────

app.post("/:id/enroll", async (c) => {
  const db = createDb(c.env);
  const { prospectIds } = await c.req.json<{ prospectIds: string[] }>();
  if (!prospectIds?.length) return c.json({ error: "prospectIds required" }, 400);

  const seq = await db.select().from(sequences).where(eq(sequences.id, c.req.param("id")));
  if (!seq[0]) return c.json({ error: "Sequence not found" }, 404);

  const [firstStep] = await db
    .select()
    .from(sequenceSteps)
    .where(eq(sequenceSteps.sequenceId, seq[0].id))
    .orderBy(sequenceSteps.stepNumber)
    .limit(1);

  const nextStepAt = firstStep
    ? new Date(Date.now() + firstStep.delayDays * 86400000)
    : new Date();

  const enrolled = await db
    .insert(sequenceEnrollments)
    .values(
      prospectIds.map((pid) => ({
        id: crypto.randomUUID(),
        sequenceId: seq[0].id,
        prospectId: pid,
        nextStepAt,
      })),
    )
    .onConflictDoNothing()
    .returning();

  return c.json({ enrolled: enrolled.length });
});

// ─── Process due enrollments (called by cron / n8n) ──────────────────────────

app.post("/process-due", async (c) => {
  const db = createDb(c.env);
  const now = new Date();

  const dueEnrollments = await db
    .select({ enrollment: sequenceEnrollments, prospect: prospects })
    .from(sequenceEnrollments)
    .innerJoin(prospects, eq(sequenceEnrollments.prospectId, prospects.id))
    .where(
      and(
        eq(sequenceEnrollments.status, "active"),
        lte(sequenceEnrollments.nextStepAt, now),
      ),
    )
    .limit(100);

  const processed: string[] = [];

  for (const { enrollment, prospect } of dueEnrollments) {
    // Get current step
    const [step] = await db
      .select()
      .from(sequenceSteps)
      .where(
        and(
          eq(sequenceSteps.sequenceId, enrollment.sequenceId),
          eq(sequenceSteps.stepNumber, enrollment.currentStep),
        ),
      );

    if (!step) {
      // No more steps — complete enrollment
      await db
        .update(sequenceEnrollments)
        .set({ status: "completed", completedAt: now })
        .where(eq(sequenceEnrollments.id, enrollment.id));
      continue;
    }

    // Generate email via AI
    const genRes = await c.env.AI_SERVICE.fetch("http://ai/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prospect,
        templateId: step.templateId,
        subjectOverride: step.subjectOverride,
        bodyOverride: step.bodyOverride,
      }),
    });

    if (genRes.ok) {
      const { subject, body } = await genRes.json<{ subject: string; body: string }>();

      // Create email draft
      await db.insert(emails).values({
        id: crypto.randomUUID(),
        prospectId: prospect.id,
        sequenceStepId: step.id,
        subject,
        body,
        trackingId: crypto.randomUUID(),
        scheduledAt: now,
      });
    }

    // Advance to next step
    const [nextStep] = await db
      .select()
      .from(sequenceSteps)
      .where(
        and(
          eq(sequenceSteps.sequenceId, enrollment.sequenceId),
          eq(sequenceSteps.stepNumber, enrollment.currentStep + 1),
        ),
      );

    if (nextStep) {
      await db
        .update(sequenceEnrollments)
        .set({
          currentStep: enrollment.currentStep + 1,
          nextStepAt: new Date(now.getTime() + nextStep.delayDays * 86400000),
        })
        .where(eq(sequenceEnrollments.id, enrollment.id));
    } else {
      await db
        .update(sequenceEnrollments)
        .set({ status: "completed", completedAt: now })
        .where(eq(sequenceEnrollments.id, enrollment.id));
    }

    processed.push(enrollment.id);
  }

  return c.json({ processed: processed.length, ids: processed });
});

export default app;
