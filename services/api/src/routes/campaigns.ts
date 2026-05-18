import { Hono } from "hono";
import { eq, desc, sql } from "drizzle-orm";
import { createDb, type Env } from "../db/client";
import { campaigns, prospects, emails } from "../db/schema";

import { audit } from "../lib/audit";

const app = new Hono<{ Bindings: Env }>();

// ─── CRUD ─────────────────────────────────────────────────────────────────────

app.get("/", async (c) => {
  const db = createDb(c.env);
  const rows = await db.select().from(campaigns).orderBy(desc(campaigns.createdAt));
  return c.json(rows);
});

app.post("/", async (c) => {
  const db = createDb(c.env);
  const body = await c.req.json<typeof campaigns.$inferInsert>();
  const [row] = await db
    .insert(campaigns)
    .values({ ...body, id: crypto.randomUUID() })
    .returning();
  await audit(db, "campaign", row.id, "created");
  return c.json(row, 201);
});

app.get("/:id", async (c) => {
  const db = createDb(c.env);
  const [row] = await db.select().from(campaigns).where(eq(campaigns.id, c.req.param("id")));
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

app.patch("/:id", async (c) => {
  const db = createDb(c.env);
  const data = await c.req.json<Partial<typeof campaigns.$inferInsert>>();
  const [updated] = await db
    .update(campaigns)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(campaigns.id, c.req.param("id")))
    .returning();
  if (!updated) return c.json({ error: "Not found" }, 404);
  return c.json(updated);
});

app.delete("/:id", async (c) => {
  const db = createDb(c.env);
  await db.delete(campaigns).where(eq(campaigns.id, c.req.param("id")));
  return c.body(null, 204);
});

// ─── Campaign stats ───────────────────────────────────────────────────────────

app.get("/:id/stats", async (c) => {
  const db = createDb(c.env);
  const campaignId = c.req.param("id");

  const [prospectStats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      new: sql<number>`count(*) filter (where status = 'new')::int`,
      contacted: sql<number>`count(*) filter (where status = 'contacted')::int`,
      replied: sql<number>`count(*) filter (where status = 'replied')::int`,
      converted: sql<number>`count(*) filter (where status = 'converted')::int`,
    })
    .from(prospects)
    .where(eq(prospects.campaignId, campaignId));

  const [emailStats] = await db
    .select({
      sent: sql<number>`count(*) filter (where sent_at is not null)::int`,
      opened: sql<number>`count(*) filter (where opened_at is not null)::int`,
      replied: sql<number>`count(*) filter (where replied_at is not null)::int`,
    })
    .from(emails)
    .where(eq(emails.campaignId, campaignId));

  return c.json({
    prospects: prospectStats,
    emails: {
      ...emailStats,
      openRate: emailStats.sent > 0 ? Math.round((emailStats.opened / emailStats.sent) * 100) : 0,
      replyRate: emailStats.sent > 0 ? Math.round((emailStats.replied / emailStats.sent) * 100) : 0,
    },
  });
});

// ─── n8n workflow export ──────────────────────────────────────────────────────
// Generates a ready-to-import n8n workflow JSON for this campaign

app.get("/:id/n8n-export", async (c) => {
  const db = createDb(c.env);
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, c.req.param("id")));
  if (!campaign) return c.json({ error: "Not found" }, 404);

  const apiBase = c.env.API_BASE_URL;

  // Minimal n8n workflow: Webhook trigger → Generate email → Send email → Update CRM
  const workflow = {
    name: `Prospecto — ${campaign.name}`,
    nodes: [
      {
        id: "1",
        name: "Webhook Trigger",
        type: "n8n-nodes-base.webhook",
        typeVersion: 1,
        position: [250, 300],
        parameters: {
          httpMethod: "POST",
          path: `prospecto-${campaign.id}`,
          responseMode: "onReceived",
        },
      },
      {
        id: "2",
        name: "Generate Email",
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 3,
        position: [500, 300],
        parameters: {
          method: "POST",
          url: `${apiBase}/prospects/{{$json.prospectId}}/generate-email`,
          sendHeaders: true,
          headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
          sendBody: true,
          body: '{"templateId":"{{$json.templateId}}"}',
        },
      },
      {
        id: "3",
        name: "Save Email Draft",
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 3,
        position: [750, 300],
        parameters: {
          method: "POST",
          url: `${apiBase}/emails`,
          sendHeaders: true,
          headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
          sendBody: true,
          body: `{"prospectId":"{{$json.prospectId}}","campaignId":"${campaign.id}","subject":"{{$node[\\"Generate Email\\"].json.subject}}","body":"{{$node[\\"Generate Email\\"].json.body}}"}`,
        },
      },
      {
        id: "4",
        name: "Send Email",
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 3,
        position: [1000, 300],
        parameters: {
          method: "POST",
          url: `${apiBase}/emails/{{$json.id}}/send`,
        },
      },
    ],
    connections: {
      "Webhook Trigger": { main: [[{ node: "Generate Email", type: "main", index: 0 }]] },
      "Generate Email": { main: [[{ node: "Save Email Draft", type: "main", index: 0 }]] },
      "Save Email Draft": { main: [[{ node: "Send Email", type: "main", index: 0 }]] },
    },
  };

  return new Response(JSON.stringify(workflow, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="n8n-${campaign.id}.json"`,
    },
  });
});

export default app;
