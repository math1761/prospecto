import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createDb, type Env } from "../db/client";
import { emails, prospects } from "../db/schema";

const app = new Hono<{ Bindings: Env }>();

app.post("/generate", async (c) => {
  const { emailId, body, prospectId, count = 10 } = await c.req.json<{
    emailId?: string;
    body?: string;
    prospectId?: string;
    count?: number;
  }>();

  let emailBody = body ?? "";
  let prospectData: Record<string, unknown> = {};

  if (emailId) {
    const db = createDb(c.env);
    const [row] = await db
      .select({ email: emails, prospect: prospects })
      .from(emails)
      .innerJoin(prospects, eq(emails.prospectId, prospects.id))
      .where(eq(emails.id, emailId));
    if (!row) return c.json({ error: "Not found" }, 404);
    emailBody = row.email.body;
    prospectData = row.prospect;
  }

  const res = await c.env.AI_SERVICE.fetch("http://ai/subject-lab", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body: emailBody, prospect: prospectData, count }),
  });

  return new Response(res.body, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
});

export default app;
