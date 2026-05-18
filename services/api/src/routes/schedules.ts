import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createDb, type Env } from "../db/client";
import { sendSchedules, warmupConfigs } from "../db/schema";


const app = new Hono<{ Bindings: Env }>();

// ─── Send Schedules ───────────────────────────────────────────────────────────

app.get("/", async (c) => {
  const db = createDb(c.env);
  return c.json(await db.select().from(sendSchedules));
});

app.post("/", async (c) => {
  const db = createDb(c.env);
  const body = await c.req.json<typeof sendSchedules.$inferInsert>();
  const [row] = await db
    .insert(sendSchedules)
    .values({ ...body, id: crypto.randomUUID() })
    .returning();
  return c.json(row, 201);
});

app.patch("/:id", async (c) => {
  const db = createDb(c.env);
  const data = await c.req.json<Partial<typeof sendSchedules.$inferInsert>>();
  const [updated] = await db
    .update(sendSchedules)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(sendSchedules.id, c.req.param("id")))
    .returning();
  if (!updated) return c.json({ error: "Not found" }, 404);
  return c.json(updated);
});

app.delete("/:id", async (c) => {
  const db = createDb(c.env);
  await db.delete(sendSchedules).where(eq(sendSchedules.id, c.req.param("id")));
  return c.body(null, 204);
});

// ─── Warmup configs ───────────────────────────────────────────────────────────

app.get("/warmup", async (c) => {
  const db = createDb(c.env);
  return c.json(await db.select().from(warmupConfigs));
});

app.post("/warmup", async (c) => {
  const db = createDb(c.env);
  const body = await c.req.json<typeof warmupConfigs.$inferInsert>();
  const [row] = await db
    .insert(warmupConfigs)
    .values({ ...body, id: crypto.randomUUID() })
    .onConflictDoUpdate({
      target: warmupConfigs.domain,
      set: { targetDailyLimit: body.targetDailyLimit, isActive: true },
    })
    .returning();
  return c.json(row, 201);
});

// Increment warmup (call daily via cron / n8n)
app.post("/warmup/:id/increment", async (c) => {
  const db = createDb(c.env);
  const [cfg] = await db.select().from(warmupConfigs).where(eq(warmupConfigs.id, c.req.param("id")));
  if (!cfg) return c.json({ error: "Not found" }, 404);

  if (!cfg.isActive) return c.json({ message: "Warmup not active" });

  const newLimit = Math.min(cfg.currentDailyLimit + cfg.incrementPerDay, cfg.targetDailyLimit);
  const reached = newLimit >= cfg.targetDailyLimit;

  const [updated] = await db
    .update(warmupConfigs)
    .set({
      currentDailyLimit: newLimit,
      lastIncrementAt: new Date(),
      isActive: !reached, // deactivate when target reached
    })
    .where(eq(warmupConfigs.id, cfg.id))
    .returning();

  return c.json({ ...updated, targetReached: reached });
});

export default app;
