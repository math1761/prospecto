import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import { createDb, type Env } from "../db/client";
import { deliverabilityScores, emails, prospects } from "../db/schema";
import { checkSpf, checkDkim, checkDmarc, computeDeliverabilityScore } from "../lib/deliverability";
import { sql } from "drizzle-orm";

const app = new Hono<{ Bindings: Env }>();

async function runChecks(domain: string, db: ReturnType<typeof createDb>) {
  const [spf, dkim, dmarc] = await Promise.all([
    checkSpf(domain),
    checkDkim(domain),
    checkDmarc(domain),
  ]);

  const [sentRow] = await db
    .select({ total: sql<number>`count(*) filter (where sent_at is not null)::int` })
    .from(emails);
  const [bounceRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(prospects)
    .where(eq(prospects.status, "rejected"));

  const [unsubRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(prospects)
    .where(eq(prospects.status, "unsubscribed"));

  const bounceRate = sentRow.total > 0 ? bounceRow.total / sentRow.total : 0;
  const complaintRate = sentRow.total > 0 ? unsubRow.total / sentRow.total : 0;

  const { score, breakdown } = computeDeliverabilityScore(spf, dkim, dmarc, bounceRate, complaintRate);

  const recommendations: string[] = [];
  if (!spf.ok) recommendations.push("Add SPF record: v=spf1 include:yourmailprovider.com ~all");
  if (!dkim.ok) recommendations.push("Add DKIM record for your sending domain");
  if (!dmarc.ok) recommendations.push("Add DMARC record: _dmarc TXT v=DMARC1; p=none");
  if (bounceRate > 0.05) recommendations.push("Bounce rate above 5% — clean your list");
  if (complaintRate > 0.01) recommendations.push("Complaint rate above 1% — review content");

  return {
    score,
    breakdown,
    spfStatus: spf.ok ? "pass" : spf.record ? "fail" : "missing",
    dkimStatus: dkim.ok ? "pass" : dkim.record ? "fail" : "missing",
    dmarcStatus: dmarc.ok ? "pass" : dmarc.record ? "fail" : "missing",
    bounceRate,
    complaintRate,
    recommendations,
  };
}

app.get("/score", async (c) => {
  const { domain } = c.req.query();
  if (!domain) return c.json({ error: "domain query param required" }, 400);

  const db = createDb(c.env);

  const [existing] = await db
    .select()
    .from(deliverabilityScores)
    .where(eq(deliverabilityScores.domain, domain))
    .limit(1);

  if (existing && Date.now() - existing.checkedAt.getTime() < 3600000) {
    return c.json(existing);
  }

  const result = await runChecks(domain, db);

  const [row] = await db
    .insert(deliverabilityScores)
    .values({
      id: crypto.randomUUID(),
      domain,
      overallScore: result.score,
      spfStatus: result.spfStatus,
      dkimStatus: result.dkimStatus,
      dmarcStatus: result.dmarcStatus,
      bounceRate: result.bounceRate,
      complaintRate: result.complaintRate,
      recommendations: result.recommendations,
    })
    .returning();

  return c.json(row);
});

app.get("/history", async (c) => {
  const { domain } = c.req.query();
  if (!domain) return c.json({ error: "domain query param required" }, 400);

  const db = createDb(c.env);
  const rows = await db
    .select()
    .from(deliverabilityScores)
    .where(eq(deliverabilityScores.domain, domain))
    .orderBy(desc(deliverabilityScores.checkedAt))
    .limit(30);

  return c.json(rows);
});

app.post("/check", async (c) => {
  const { domain } = await c.req.json<{ domain: string }>();
  if (!domain) return c.json({ error: "domain required" }, 400);

  const db = createDb(c.env);
  const result = await runChecks(domain, db);

  const [row] = await db
    .insert(deliverabilityScores)
    .values({
      id: crypto.randomUUID(),
      domain,
      overallScore: result.score,
      spfStatus: result.spfStatus,
      dkimStatus: result.dkimStatus,
      dmarcStatus: result.dmarcStatus,
      bounceRate: result.bounceRate,
      complaintRate: result.complaintRate,
      recommendations: result.recommendations,
    })
    .returning();

  return c.json(row);
});

export default app;
