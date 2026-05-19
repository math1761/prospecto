import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createDb, type Env } from "../db/client";
import { crmIntegrations, prospects } from "../db/schema";

import { audit } from "../lib/audit";

const app = new Hono<{ Bindings: Env }>();

// ─── Integrations CRUD ────────────────────────────────────────────────────────

app.get("/", async (c) => {
  const db = createDb(c.env);
  // Mask API keys
  const rows = await db.select().from(crmIntegrations);
  return c.json(rows.map((r) => ({ ...r, apiKey: r.apiKey.slice(0, 8) + "..." })));
});

app.post("/", async (c) => {
  const db = createDb(c.env);
  const body = await c.req.json<typeof crmIntegrations.$inferInsert>();
  const [row] = await db
    .insert(crmIntegrations)
    .values({ ...body, id: crypto.randomUUID() })
    .returning();
  return c.json({ ...row, apiKey: row.apiKey.slice(0, 8) + "..." }, 201);
});

app.patch("/:id", async (c) => {
  const db = createDb(c.env);
  const data = await c.req.json<Partial<typeof crmIntegrations.$inferInsert>>();
  const [updated] = await db
    .update(crmIntegrations)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(crmIntegrations.id, c.req.param("id")))
    .returning();
  if (!updated) return c.json({ error: "Not found" }, 404);
  return c.json({ ...updated, apiKey: updated.apiKey.slice(0, 8) + "..." });
});

app.delete("/:id", async (c) => {
  const db = createDb(c.env);
  await db.delete(crmIntegrations).where(eq(crmIntegrations.id, c.req.param("id")));
  return c.body(null, 204);
});

// ─── Push prospects to CRM ────────────────────────────────────────────────────

app.post("/:id/push", async (c) => {
  const db = createDb(c.env);
  const [integration] = await db
    .select()
    .from(crmIntegrations)
    .where(eq(crmIntegrations.id, c.req.param("id")));
  if (!integration || !integration.isActive) {
    return c.json({ error: "Integration not found or inactive" }, 404);
  }

  const { campaignId, status } = c.req.query();
  const conditions = [];
  if (campaignId) conditions.push(eq(prospects.campaignId, campaignId));

  const rows = await db.select().from(prospects).limit(200);
  const results: Array<{ email: string; status: "pushed" | "error" }> = [];

  for (const prospect of rows) {
    try {
      if (integration.provider === "hubspot") {
        await pushToHubSpot(prospect, integration.apiKey, integration.portalId);
      } else if (integration.provider === "pipedrive") {
        await pushToPipedrive(prospect, integration.apiKey);
      }
      results.push({ email: prospect.email, status: "pushed" });
    } catch {
      results.push({ email: prospect.email, status: "error" });
    }
  }

  await db
    .update(crmIntegrations)
    .set({ lastSyncAt: new Date() })
    .where(eq(crmIntegrations.id, integration.id));

  await audit(db, "crm", integration.id, "pushed", { pushed: results.filter((r) => r.status === "pushed").length });

  return c.json({ results, pushed: results.filter((r) => r.status === "pushed").length });
});

// ─── Pull deal stage back from CRM ───────────────────────────────────────────

app.post("/:id/pull", async (c) => {
  const db = createDb(c.env);
  const [integration] = await db
    .select()
    .from(crmIntegrations)
    .where(eq(crmIntegrations.id, c.req.param("id")));
  if (!integration || !integration.isActive) {
    return c.json({ error: "Integration not found or inactive" }, 404);
  }

  // Pull converted deals and update prospect status
  let deals: Array<{ email: string; stage: string }> = [];

  if (integration.provider === "hubspot") {
    deals = await pullFromHubSpot(integration.apiKey);
  } else if (integration.provider === "pipedrive") {
    deals = await pullFromPipedrive(integration.apiKey);
  }

  const updated: string[] = [];
  for (const deal of deals) {
    if (deal.stage === "closed_won") {
      const result = await db
        .update(prospects)
        .set({ status: "converted", updatedAt: new Date() })
        .where(eq(prospects.email, deal.email))
        .returning();
      if (result.length) updated.push(deal.email);
    }
  }

  await db
    .update(crmIntegrations)
    .set({ lastSyncAt: new Date() })
    .where(eq(crmIntegrations.id, integration.id));

  return c.json({ pulled: deals.length, updated: updated.length });
});

// ─── CRM adapter functions ────────────────────────────────────────────────────

async function pushToHubSpot(
  prospect: typeof prospects.$inferSelect,
  apiKey: string,
  portalId?: string | null,
) {
  const res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      properties: {
        email: prospect.email,
        firstname: prospect.name.split(" ")[0],
        lastname: prospect.name.split(" ").slice(1).join(" "),
        company: prospect.company,
        jobtitle: prospect.title,
        phone: prospect.phone,
        website: prospect.website,
      },
    }),
  });
  if (!res.ok) throw new Error(`HubSpot error: ${res.status}`);
}

async function pushToPipedrive(
  prospect: typeof prospects.$inferSelect,
  apiKey: string,
) {
  const res = await fetch(`https://api.pipedrive.com/v1/persons?api_token=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: prospect.name,
      email: [{ value: prospect.email, primary: true }],
      phone: prospect.phone ? [{ value: prospect.phone }] : undefined,
      org_name: prospect.company,
    }),
  });
  if (!res.ok) throw new Error(`Pipedrive error: ${res.status}`);
}

async function pullFromHubSpot(apiKey: string): Promise<Array<{ email: string; stage: string }>> {
  const res = await fetch(
    "https://api.hubapi.com/crm/v3/objects/deals?properties=dealstage,associations",
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  if (!res.ok) return [];
  const data = await res.json<any>();
  return (data.results ?? []).map((d: any) => ({
    email: d.properties?.email ?? "",
    stage: d.properties?.dealstage ?? "",
  }));
}

async function pullFromPipedrive(apiKey: string): Promise<Array<{ email: string; stage: string }>> {
  const res = await fetch(`https://api.pipedrive.com/v1/deals?api_token=${apiKey}&status=won`);
  if (!res.ok) return [];
  const data = await res.json<any>();
  return (data.data ?? []).map((d: any) => ({
    email: d.person_id?.email?.[0]?.value ?? "",
    stage: "closed_won",
  }));
}

export default app;
