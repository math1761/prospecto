import { Hono } from "hono";

type Env = {
  RESEND_API_KEY: string;
  FROM_EMAIL: string;
  FROM_NAME: string;
  API_BASE_URL: string;
};

type SendPayload = {
  to: string;
  name: string;
  subject: string;
  body: string;
  trackingId?: string;
  unsubscribeUrl?: string;
};

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true, service: "mailer" }));

// Rewrite all http(s) links in the body to go through the click tracker
function rewriteLinks(body: string, apiBase: string, trackingId: string): string {
  return body.replace(
    /href="(https?:\/\/[^"]+)"/gi,
    (_, url) => `href="${apiBase}/emails/track/${trackingId}/click?url=${encodeURIComponent(url)}"`,
  );
}

app.post("/send", async (c) => {
  const payload = await c.req.json<SendPayload>();

  let html = payload.body.replace(/\n/g, "<br>");

  // Rewrite outbound links for click tracking
  if (payload.trackingId) {
    html = rewriteLinks(html, c.env.API_BASE_URL, payload.trackingId);
  }

  // Inject unsubscribe link
  if (payload.unsubscribeUrl) {
    html += `<br><br><hr style="border:none;border-top:1px solid #333;margin:20px 0">` +
      `<p style="font-size:12px;color:#888;text-align:center">` +
      `Don't want to receive these emails? ` +
      `<a href="${payload.unsubscribeUrl}" style="color:#888">Unsubscribe</a>` +
      `</p>`;
  }

  // Tracking pixel — append after unsubscribe footer so it's last
  if (payload.trackingId) {
    html += `<img src="${c.env.API_BASE_URL}/emails/track/${payload.trackingId}/open" ` +
      `width="1" height="1" style="display:none" alt="" />`;
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${c.env.RESEND_API_KEY}`,
    "Content-Type": "application/json",
  };

  if (payload.unsubscribeUrl) {
    headers["List-Unsubscribe"] = `<${payload.unsubscribeUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers,
    body: JSON.stringify({
      from: `${c.env.FROM_NAME} <${c.env.FROM_EMAIL}>`,
      to: [payload.to],
      subject: payload.subject,
      html,
      text: payload.body,
    }),
  });

  if (!response.ok) {
    const err = await response.json();
    return c.json({ error: "Resend error", detail: err }, 502);
  }

  const data = await response.json();
  return c.json(data);
});

export default app;
