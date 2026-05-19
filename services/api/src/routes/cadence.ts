import { Hono } from "hono";
import { eq, sql, desc } from "drizzle-orm";
import { createDb, type Env } from "../db/client";
import { campaigns, emails, sequences, sequenceSteps } from "../db/schema";
import { getCached, setCache } from "../lib/cache";

const app = new Hono<{ Bindings: Env }>();

app.post("/optimize", async (c) => {
  const { campaignId } = c.req.query();
  if (!campaignId) return c.json({ error: "campaignId required" }, 400);

  const db = createDb(c.env);

  const completedCampaigns = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.status, "completed"));

  const campaignHistory = [];
  for (const camp of completedCampaigns) {
    const [stats] = await db
      .select({
        sent: sql<number>`count(*) filter (where sent_at is not null)::int`,
        opened: sql<number>`count(*) filter (where opened_at is not null)::int`,
        replied: sql<number>`count(*) filter (where replied_at is not null)::int`,
      })
      .from(emails)
      .where(eq(emails.campaignId, camp.id));

    const steps = await db
      .select()
      .from(sequenceSteps)
      .innerJoin(sequences, eq(sequenceSteps.sequenceId, sequences.id))
      .where(eq(sequences.campaignId, camp.id));

    campaignHistory.push({
      prospectCount: 0,
      touchCount: steps.length || 1,
      avgDelayDays: steps.length > 0 ? steps.reduce((s, st) => s + st.sequence_steps.delayDays, 0) / steps.length : 0,
      openRate: stats.sent > 0 ? stats.opened / stats.sent : 0,
      replyRate: stats.sent > 0 ? stats.replied / stats.sent : 0,
    });
  }

  const res = await c.env.AI_SERVICE.fetch("http://ai/optimize-cadence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ campaignHistory, targetMetric: "reply_rate" }),
  });

  const result = await res.json<{
    recommendedTouches: number;
    recommendedDelays: number[];
    recommendedSendDays: string[];
    recommendedSendWindow: { start: string; end: string };
    confidence: number;
    reasoning: string;
    topInsights: string[];
  }>();

  await db
    .update(campaigns)
    .set({
      optimalTouchCount: result.recommendedTouches,
      optimalDelayDays: result.recommendedDelays?.[0] ?? null,
    })
    .where(eq(campaigns.id, campaignId));

  return c.json(result);
});

app.get("/benchmarks", async (c) => {
  const cacheKey = "cadence:benchmarks";
  const cached = await getCached<Record<string, unknown>>(c.env, cacheKey);
  if (cached) return c.json(cached);

  const db = createDb(c.env);

  const byTouchCount = await db
    .select({
      touches: sql<number>`1`, // placeholder — real data needs join
      avgOpenRate: sql<number>`coalesce(avg(case when sent_at is not null then 1 else 0 end) * 100, 0)`,
    })
    .from(emails)
    .limit(1);

  const benchmarks = {
    campaigns: byTouchCount,
    generatedAt: new Date().toISOString(),
  };

  await setCache(c.env, cacheKey, benchmarks, 300);
  return c.json(benchmarks);
});

export default app;
