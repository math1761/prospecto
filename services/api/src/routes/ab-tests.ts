import { Hono } from "hono";
import { eq, desc, sql, and } from "drizzle-orm";
import { createDb, type Env } from "../db/client";
import { abTests, emails, prospects } from "../db/schema";


const app = new Hono<{ Bindings: Env }>();

// ─── CRUD ─────────────────────────────────────────────────────────────────────

app.get("/", async (c) => {
  const db = createDb(c.env);
  const rows = await db.select().from(abTests).orderBy(desc(abTests.createdAt));
  return c.json(rows);
});

app.post("/", async (c) => {
  const db = createDb(c.env);
  const body = await c.req.json<typeof abTests.$inferInsert>();
  const [row] = await db
    .insert(abTests)
    .values({ ...body, id: crypto.randomUUID(), status: "running" })
    .returning();
  return c.json(row, 201);
});

app.get("/:id", async (c) => {
  const db = createDb(c.env);
  const [row] = await db.select().from(abTests).where(eq(abTests.id, c.req.param("id")));
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

app.delete("/:id", async (c) => {
  const db = createDb(c.env);
  await db.delete(abTests).where(eq(abTests.id, c.req.param("id")));
  return c.body(null, 204);
});

// ─── Stats ────────────────────────────────────────────────────────────────────

app.get("/:id/stats", async (c) => {
  const db = createDb(c.env);
  const [test] = await db.select().from(abTests).where(eq(abTests.id, c.req.param("id")));
  if (!test) return c.json({ error: "Not found" }, 404);

  const [statsA] = await db
    .select({
      sent: sql<number>`count(*) filter (where sent_at is not null)::int`,
      opened: sql<number>`count(*) filter (where opened_at is not null)::int`,
      replied: sql<number>`count(*) filter (where replied_at is not null)::int`,
    })
    .from(emails)
    .where(and(eq(emails.abTestId, test.id), eq(emails.abVariant, "a")));

  const [statsB] = await db
    .select({
      sent: sql<number>`count(*) filter (where sent_at is not null)::int`,
      opened: sql<number>`count(*) filter (where opened_at is not null)::int`,
      replied: sql<number>`count(*) filter (where replied_at is not null)::int`,
    })
    .from(emails)
    .where(and(eq(emails.abTestId, test.id), eq(emails.abVariant, "b")));

  const openRateA = statsA.sent > 0 ? Math.round((statsA.opened / statsA.sent) * 100) : 0;
  const openRateB = statsB.sent > 0 ? Math.round((statsB.opened / statsB.sent) * 100) : 0;
  const replyRateA = statsA.sent > 0 ? Math.round((statsA.replied / statsA.sent) * 100) : 0;
  const replyRateB = statsB.sent > 0 ? Math.round((statsB.replied / statsB.sent) * 100) : 0;

  return c.json({
    test,
    variants: {
      a: { ...statsA, openRate: openRateA, replyRate: replyRateA },
      b: { ...statsB, openRate: openRateB, replyRate: replyRateB },
    },
  });
});

// ─── Pick winner & close test ─────────────────────────────────────────────────

app.post("/:id/pick-winner", async (c) => {
  const db = createDb(c.env);
  const { winner } = await c.req.json<{ winner: "a" | "b" | "auto" }>();
  const [test] = await db.select().from(abTests).where(eq(abTests.id, c.req.param("id")));
  if (!test) return c.json({ error: "Not found" }, 404);

  let resolvedWinner: "a" | "b" = winner === "auto" ? "a" : winner;

  if (winner === "auto") {
    // Pick by open rate
    const [statsA] = await db
      .select({ opened: sql<number>`count(*) filter (where opened_at is not null)::int`, sent: sql<number>`count(*) filter (where sent_at is not null)::int` })
      .from(emails).where(and(eq(emails.abTestId, test.id), eq(emails.abVariant, "a")));
    const [statsB] = await db
      .select({ opened: sql<number>`count(*) filter (where opened_at is not null)::int`, sent: sql<number>`count(*) filter (where sent_at is not null)::int` })
      .from(emails).where(and(eq(emails.abTestId, test.id), eq(emails.abVariant, "b")));

    const rateA = statsA.sent > 0 ? statsA.opened / statsA.sent : 0;
    const rateB = statsB.sent > 0 ? statsB.opened / statsB.sent : 0;
    resolvedWinner = rateA >= rateB ? "a" : "b";
  }

  const [updated] = await db
    .update(abTests)
    .set({ winnerVariant: resolvedWinner, status: "completed", completedAt: new Date() })
    .where(eq(abTests.id, test.id))
    .returning();

  return c.json({ winner: resolvedWinner, test: updated });
});

export default app;
