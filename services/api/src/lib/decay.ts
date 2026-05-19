import { eq, sql } from "drizzle-orm";
import { prospects, prospectActivities, emails } from "../db/schema";
import type { DB } from "../db/client";

export type DecayScanResult = {
  scanned: number;
  active: number;
  stale: number;
  cold: number;
  archived: number;
};

export async function computeDecayScores(db: DB): Promise<DecayScanResult> {
  const allProspects = await db.select().from(prospects);
  const results: DecayScanResult = { scanned: 0, active: 0, stale: 0, cold: 0, archived: 0 };

  for (const p of allProspects) {
    results.scanned++;
    const daysInactive = p.lastActivityAt
      ? Math.floor((Date.now() - p.lastActivityAt.getTime()) / 86400000)
      : 999;

    const [emailStats] = await db
      .select({
        sent: sql<number>`count(*)::int`,
        replied: sql<number>`count(*) filter (where replied_at is not null)::int`,
      })
      .from(emails)
      .where(eq(emails.prospectId, p.id));

    const emailsNoReply = emailStats.sent - emailStats.replied;
    const decayScore = Math.min(100, daysInactive * 2 + emailsNoReply * 5 - Math.floor((p.score ?? 0) / 2));

    let decayStatus: string;
    if (decayScore < 30) decayStatus = "active";
    else if (decayScore < 60) decayStatus = "stale";
    else if (decayScore < 80) decayStatus = "cold";
    else decayStatus = "archived";

    await db
      .update(prospects)
      .set({ decayScore, decayStatus })
      .where(eq(prospects.id, p.id));

    if (decayStatus !== (p.decayStatus ?? "active") && (decayStatus === "stale" || decayStatus === "cold")) {
      await db.insert(prospectActivities).values({
        id: crypto.randomUUID(),
        prospectId: p.id,
        type: "flagged_decay",
        meta: { decayScore, decayStatus, daysInactive },
      });
    }

    (results as any)[decayStatus]++;
  }

  return results;
}
