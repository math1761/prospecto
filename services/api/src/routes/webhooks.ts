import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createDb, type Env } from "../db/client";
import { webhookConfigs } from "../db/schema";
import { internalFetch } from "../lib/internal-dispatch";


// Supported outbound events
const WEBHOOK_EVENTS = [
  "prospect.status_changed",
  "prospect.replied",
  "prospect.bounced",
  "prospect.decay_flagged",
  "prospect.note_added",
  "email.sent",
  "email.opened",
  "email.clicked",
  "sequence.completed",
  "import.completed",
  "deliverability.checked",
  "cadence.optimized",
] as const;

const app = new Hono<{ Bindings: Env }>();

app.get("/", async (c) => {
  const db = createDb(c.env);
  return c.json(await db.select().from(webhookConfigs));
});

app.post("/", async (c) => {
  const db = createDb(c.env);
  const body = await c.req.json<typeof webhookConfigs.$inferInsert>();

  // Validate events
  const invalid = (body.events as string[])?.filter(
    (e) => !(WEBHOOK_EVENTS as readonly string[]).includes(e),
  );
  if (invalid?.length) {
    return c.json({ error: "Invalid events", invalid, valid: WEBHOOK_EVENTS }, 400);
  }

  const [row] = await db
    .insert(webhookConfigs)
    .values({ ...body, id: crypto.randomUUID(), secret: body.secret ?? crypto.randomUUID() })
    .returning();
  return c.json(row, 201);
});

app.get("/:id", async (c) => {
  const db = createDb(c.env);
  const [row] = await db.select().from(webhookConfigs).where(eq(webhookConfigs.id, c.req.param("id")));
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

app.patch("/:id", async (c) => {
  const db = createDb(c.env);
  const data = await c.req.json<Partial<typeof webhookConfigs.$inferInsert>>();
  const [updated] = await db
    .update(webhookConfigs)
    .set(data)
    .where(eq(webhookConfigs.id, c.req.param("id")))
    .returning();
  if (!updated) return c.json({ error: "Not found" }, 404);
  return c.json(updated);
});

app.delete("/:id", async (c) => {
  const db = createDb(c.env);
  await db.delete(webhookConfigs).where(eq(webhookConfigs.id, c.req.param("id")));
  return c.body(null, 204);
});

// ─── Test fire ────────────────────────────────────────────────────────────────

app.post("/:id/test", async (c) => {
  const db = createDb(c.env);
  const [cfg] = await db.select().from(webhookConfigs).where(eq(webhookConfigs.id, c.req.param("id")));
  if (!cfg) return c.json({ error: "Not found" }, 404);

  const body = JSON.stringify({
    event: "test",
    payload: { message: "Prospecto webhook test" },
    timestamp: new Date().toISOString(),
  });

  try {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    return c.json({ ok: res.ok, status: res.status });
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 502);
  }
});

// ─── Inbound n8n trigger ──────────────────────────────────────────────────────
// n8n can call this to trigger actions (generate, send, status update, etc.)

app.post("/inbound", async (c) => {
  const secret = c.req.header("X-N8N-Secret");
  if (c.env.N8N_WEBHOOK_SECRET && secret !== c.env.N8N_WEBHOOK_SECRET) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { action, payload } = await c.req.json<{
    action: "generate" | "send" | "update_status" | "enrich";
    payload: Record<string, unknown>;
  }>();

  // Delegate to internal routes via service fetch
  const routeMap: Record<string, string> = {
    generate: `/prospects/${payload.prospectId}/generate-email`,
    enrich: `/prospects/${payload.prospectId}/enrich`,
    update_status: `/prospects/${payload.prospectId}`,
    send: `/emails/${payload.emailId}/send`,
  };

  const route = routeMap[action];
  if (!route) return c.json({ error: "Unknown action", valid: Object.keys(routeMap) }, 400);

  const method = action === "update_status" ? "PATCH" : "POST";
  const body = method === "PATCH" ? JSON.stringify({ status: payload.status }) : "{}";

  const res = await internalFetch(route, {
    method,
    headers: { "Content-Type": "application/json" },
    body,
  }, c.env);

  const data = await res.json();
  return c.json({ ok: res.ok, result: data });
});

export default app;
