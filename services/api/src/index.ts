import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { MessageBatch } from "@cloudflare/workers-types";
import { createDb, type Env } from "./db/client";
import { prospects, emails } from "./db/schema";
import { eq } from "drizzle-orm";
import type { GenerateJob, SendJob } from "./lib/jobs";
import { createAuth, type Auth } from "./lib/auth";
import prospectsRoutes from "./routes/prospects";
import campaignsRoutes from "./routes/campaigns";
import emailsRoutes from "./routes/emails";
import templatesRoutes from "./routes/templates";
import analyticsRoutes from "./routes/analytics";
import sequencesRoutes from "./routes/sequences";
import abTestsRoutes from "./routes/ab-tests";
import personasRoutes from "./routes/personas";
import webhooksRoutes from "./routes/webhooks";
import schedulesRoutes from "./routes/schedules";
import crmRoutes from "./routes/crm";
import usersRoutes from "./routes/users";

type Variables = { auth: Auth };
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (origin) => origin,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["POST", "GET", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  }),
);

// Health check — public
app.get("/health", (c) => c.json({ ok: true, service: "api" }));

// Better Auth handler — public (handles /api/auth/sign-in, /api/auth/sign-up, etc.)
app.all("/api/auth/*", async (c) => {
  const auth = createAuth(c.env, c.req.raw);
  return auth.handler(c.req.raw);
});

// Public routes — unsubscribe, webhook delivery
const publicPaths = ["/prospects/unsubscribe/", "/webhooks/deliver/"];
app.use("*", async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (publicPaths.some((p) => path.startsWith(p))) return next();

  const auth = createAuth(c.env, c.req.raw);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  c.set("auth", auth);
  await next();
});

// Protected API routes
app.route("/prospects", prospectsRoutes);
app.route("/campaigns", campaignsRoutes);
app.route("/emails", emailsRoutes);
app.route("/templates", templatesRoutes);
app.route("/analytics", analyticsRoutes);
app.route("/sequences", sequencesRoutes);
app.route("/ab-tests", abTestsRoutes);
app.route("/personas", personasRoutes);
app.route("/webhooks", webhooksRoutes);
app.route("/schedules", schedulesRoutes);
app.route("/crm", crmRoutes);
app.route("/users", usersRoutes);

// ─── Queue consumers ──────────────────────────────────────────────────────────

async function processGenerateJob(job: GenerateJob, env: Env): Promise<void> {
  const db = createDb(env);
  const [prospect] = await db.select().from(prospects).where(eq(prospects.id, job.prospectId));
  if (!prospect) return;

  const res = await env.AI_SERVICE.fetch("http://ai/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prospect,
      templateId: job.templateId,
      campaignId: job.campaignId,
    }),
  });

  if (!res.ok) throw new Error(`AI generation failed: ${res.status}`);
  const { subject, body } = await res.json<{ subject: string; body: string }>();

  await db.insert(emails).values({
    id: crypto.randomUUID(),
    prospectId: job.prospectId,
    campaignId: job.campaignId ?? prospect.campaignId,
    templateId: job.templateId,
    subject,
    body,
    trackingId: crypto.randomUUID(),
  });
}

async function processSendJob(job: SendJob, env: Env): Promise<void> {
  const res = await app.fetch(
    new Request(`http://internal/emails/${job.emailId}/send`, { method: "POST" }),
    env,
  );
  if (!res.ok) throw new Error(`Send failed: ${res.status} ${await res.text()}`);
}

export default {
  fetch: app.fetch.bind(app),

  async queue(batch: MessageBatch<GenerateJob | SendJob>, env: Env): Promise<void> {
    await Promise.allSettled(
      batch.messages.map(async (msg) => {
        try {
          const job = msg.body;
          if ("prospectId" in job) {
            await processGenerateJob(job as GenerateJob, env);
          } else {
            await processSendJob(job as SendJob, env);
          }
          msg.ack();
        } catch {
          msg.retry();
        }
      }),
    );
  },
};
