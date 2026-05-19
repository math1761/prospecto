import { eq, and, desc } from "drizzle-orm";
import { emails, prospects, prospectActivities } from "../db/schema";
import type { DB } from "../db/client";
import type { Env } from "../db/client";
import { audit } from "./audit";
import { fireWebhooks } from "./webhooks";
import { invalidateCache } from "./cache";

export async function dispatchEmail(db: DB, env: Env, emailId: string): Promise<Response> {
  const [row] = await db
    .select({ email: emails, prospect: prospects })
    .from(emails)
    .innerJoin(prospects, eq(emails.prospectId, prospects.id))
    .where(eq(emails.id, emailId));

  if (!row) return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { "Content-Type": "application/json" } });

  if (row.prospect.status === "unsubscribed") {
    return new Response(JSON.stringify({ error: "Prospect is unsubscribed" }), { status: 422, headers: { "Content-Type": "application/json" } });
  }

  if (row.email.qualityScore !== null && row.email.qualityScore < 30) {
    return new Response(JSON.stringify({ error: "Email quality score too low to send", qualityScore: row.email.qualityScore }), { status: 422, headers: { "Content-Type": "application/json" } });
  }

  const unsubscribeUrl = `${env.API_BASE_URL}/prospects/unsubscribe/${row.prospect.unsubscribeToken}`;

  const [prevEmail] = row.email.sequenceStepId
    ? await db
        .select()
        .from(emails)
        .where(and(
          eq(emails.prospectId, row.email.prospectId),
          eq(emails.sentAt, null as any),
        ))
        .orderBy(desc(emails.createdAt))
        .limit(1)
    : [null];

  const threadingHeaders: Record<string, string> = {};
  if (row.email.inReplyTo) threadingHeaders.inReplyTo = row.email.inReplyTo;
  if (row.email.references) threadingHeaders.references = row.email.references;
  if (!row.email.messageId && prevEmail?.messageId) {
    threadingHeaders.inReplyTo = prevEmail.messageId;
    threadingHeaders.references = [prevEmail.references, prevEmail.messageId].filter(Boolean).join(" ");
  }

  const res = await env.MAILER_SERVICE.fetch("http://mailer/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: row.prospect.email,
      name: row.prospect.name,
      subject: row.email.subject,
      body: row.email.body,
      trackingId: row.email.trackingId,
      unsubscribeUrl,
      apiBaseUrl: env.API_BASE_URL,
      ...threadingHeaders,
    }),
  });

  if (!res.ok) {
    const err = await res.json();
    return new Response(JSON.stringify({ error: "Mailer failed", detail: err }), { status: 502, headers: { "Content-Type": "application/json" } });
  }

  const [updated] = await db
    .update(emails)
    .set({ sentAt: new Date() })
    .where(eq(emails.id, emailId))
    .returning();

  await db
    .update(prospects)
    .set({ status: "contacted", updatedAt: new Date(), lastActivityAt: new Date() })
    .where(eq(prospects.id, row.email.prospectId));

  await db.insert(prospectActivities).values({
    id: crypto.randomUUID(),
    prospectId: row.email.prospectId,
    emailId,
    type: "email_sent",
    meta: { subject: row.email.subject },
  });

  await audit(db, "email", emailId, "sent", { to: row.prospect.email });
  await fireWebhooks(db, "email.sent", { email: updated, prospect: row.prospect });
  await invalidateCache(env, "analytics:");

  return new Response(JSON.stringify(updated), { status: 200, headers: { "Content-Type": "application/json" } });
}
