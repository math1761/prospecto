import { Hono } from "hono";
import { eq, sql, count, and } from "drizzle-orm";
import { createDb, type Env } from "../db/client";
import { prospects, emails, campaigns, importHistory } from "../db/schema";
import { getCached, setCache, TTL_ANALYTICS, TTL_DOMAIN_HEALTH } from "../lib/cache";
import { checkSpf, checkDmarc, checkMx } from "../lib/deliverability";

const app = new Hono<{ Bindings: Env }>();

// ─── Overview funnel (cached 60s) ───────────────────────────────────────────

app.get("/overview", async (c) => {
  const cacheKey = "analytics:overview";
  const cached = await getCached<any>(c.env, cacheKey);
  if (cached) return c.json(cached);

  const db = createDb(c.env);

  const [funnel] = await db
    .select({
      total: count(),
      new: sql<number>`count(*) filter (where status = 'new')::int`,
      contacted: sql<number>`count(*) filter (where status = 'contacted')::int`,
      replied: sql<number>`count(*) filter (where status = 'replied')::int`,
      converted: sql<number>`count(*) filter (where status = 'converted')::int`,
      rejected: sql<number>`count(*) filter (where status = 'rejected')::int`,
      unsubscribed: sql<number>`count(*) filter (where status = 'unsubscribed')::int`,
    })
    .from(prospects);

  const [emailStats] = await db
    .select({
      totalSent: sql<number>`count(*) filter (where sent_at is not null)::int`,
      totalOpened: sql<number>`count(*) filter (where opened_at is not null)::int`,
      totalClicked: sql<number>`count(*) filter (where clicked_at is not null)::int`,
      totalReplied: sql<number>`count(*) filter (where replied_at is not null)::int`,
    })
    .from(emails);

  const openRate = emailStats.totalSent > 0
    ? Math.round((emailStats.totalOpened / emailStats.totalSent) * 100)
    : 0;
  const clickRate = emailStats.totalSent > 0
    ? Math.round((emailStats.totalClicked / emailStats.totalSent) * 100)
    : 0;
  const replyRate = emailStats.totalSent > 0
    ? Math.round((emailStats.totalReplied / emailStats.totalSent) * 100)
    : 0;
  const conversionRate = funnel.total > 0
    ? Math.round((funnel.converted / funnel.total) * 100)
    : 0;

  const [sentimentBreakdown] = await db
    .select({
      positive: sql<number>`count(*) filter (where sentiment = 'positive')::int`,
      neutral: sql<number>`count(*) filter (where sentiment = 'neutral')::int`,
      negative: sql<number>`count(*) filter (where sentiment = 'negative')::int`,
      outOfOffice: sql<number>`count(*) filter (where sentiment = 'out_of_office')::int`,
    })
    .from(prospects);

  const body = {
    funnel,
    email: { ...emailStats, openRate, clickRate, replyRate },
    conversion: { rate: conversionRate },
    sentiment: sentimentBreakdown,
  };

  await setCache(c.env, cacheKey, body, TTL_ANALYTICS);
  return c.json(body);
});

// ─── Per-campaign stats (cached 60s) ────────────────────────────────────────

app.get("/campaign/:id", async (c) => {
  const campaignId = c.req.param("id");
  const cacheKey = `analytics:campaign:${campaignId}`;
  const cached = await getCached<any>(c.env, cacheKey);
  if (cached) return c.json(cached);

  const db = createDb(c.env);
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId));
  if (!campaign) return c.json({ error: "Not found" }, 404);

  const [funnel] = await db
    .select({
      total: count(),
      contacted: sql<number>`count(*) filter (where status = 'contacted')::int`,
      replied: sql<number>`count(*) filter (where status = 'replied')::int`,
      converted: sql<number>`count(*) filter (where status = 'converted')::int`,
    })
    .from(prospects)
    .where(eq(prospects.campaignId, campaignId));

  const [emailStats] = await db
    .select({
      totalSent: sql<number>`count(*) filter (where sent_at is not null)::int`,
      totalOpened: sql<number>`count(*) filter (where opened_at is not null)::int`,
      totalClicked: sql<number>`count(*) filter (where clicked_at is not null)::int`,
      totalReplied: sql<number>`count(*) filter (where replied_at is not null)::int`,
    })
    .from(emails)
    .where(eq(emails.campaignId, campaignId));

  const [sentiment] = await db
    .select({
      positive: sql<number>`count(*) filter (where sentiment = 'positive')::int`,
      neutral: sql<number>`count(*) filter (where sentiment = 'neutral')::int`,
      negative: sql<number>`count(*) filter (where sentiment = 'negative')::int`,
    })
    .from(prospects)
    .where(and(eq(prospects.campaignId, campaignId), sql`sentiment is not null`));

  const body = {
    campaign,
    funnel,
    email: {
      ...emailStats,
      openRate: emailStats.totalSent > 0 ? Math.round((emailStats.totalOpened / emailStats.totalSent) * 100) : 0,
      replyRate: emailStats.totalSent > 0 ? Math.round((emailStats.totalReplied / emailStats.totalSent) * 100) : 0,
    },
    sentiment,
  };

  await setCache(c.env, cacheKey, body, TTL_ANALYTICS);
  return c.json(body);
});

// ─── Import history ─────────────────────────────────────────────────────────

app.get("/imports", async (c) => {
  const db = createDb(c.env);
  const rows = await db
    .select()
    .from(importHistory)
    .orderBy(sql`created_at desc`)
    .limit(50);
  return c.json(rows);
});

// ─── Sending domain health (cached 1h) ──────────────────────────────────────

app.get("/domain-health", async (c) => {
  const { domain } = c.req.query();
  if (!domain) return c.json({ error: "domain query param required" }, 400);

  const cacheKey = `domain-health:${domain}`;
  const cached = await getCached<{ domain: string; healthy: boolean; checks: unknown; recommendations: string[] }>(c.env, cacheKey);
  if (cached) return c.json(cached);

  const checks = await Promise.allSettled([
    checkSpf(domain),
    checkDmarc(domain),
    checkMx(domain),
  ]);

  const [spf, dmarc, mx] = checks.map((r) =>
    r.status === "fulfilled" ? r.value : { ok: false, error: String((r as PromiseRejectedResult).reason) },
  );

  const allGood = [spf, dmarc, mx].every((c) => (c as any).ok);

  const recommendations: string[] = [];
  if (!spf.ok) recommendations.push("Add an SPF record to your DNS: v=spf1 include:yourmailprovider.com ~all");
  if (!dmarc.ok) recommendations.push("Add a DMARC record: _dmarc TXT v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com");
  if (!mx.ok) recommendations.push("No MX records found. Replies to your emails cannot be received.");

  const body = {
    domain,
    healthy: allGood,
    checks: { spf, dmarc, mx },
    recommendations,
  };

  await setCache(c.env, cacheKey, body, TTL_DOMAIN_HEALTH);
  return c.json(body);
});

export default app;
