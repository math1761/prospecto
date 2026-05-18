import { eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { webhookConfigs } from "../db/schema";

export async function fireWebhooks(
  db: DB,
  event: string,
  payload: unknown,
) {
  const configs = await db
    .select()
    .from(webhookConfigs)
    .where(eq(webhookConfigs.isActive, true));

  const matching = configs.filter((c) => (c.events as string[]).includes(event));

  await Promise.allSettled(
    matching.map(async (cfg) => {
      const body = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
      const headers: Record<string, string> = { "Content-Type": "application/json" };

      if (cfg.secret) {
        // HMAC-SHA256 signature for n8n verification
        const key = await crypto.subtle.importKey(
          "raw",
          new TextEncoder().encode(cfg.secret),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"],
        );
        const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
        headers["X-Prospecto-Signature"] = Array.from(new Uint8Array(sig))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
      }

      await fetch(cfg.url, { method: "POST", headers, body });

      // Update lastTriggeredAt — fire and forget, don't block response
      db.update(webhookConfigs)
        .set({ lastTriggeredAt: new Date() })
        .where(eq(webhookConfigs.id, cfg.id))
        .catch(() => {});
    }),
  );
}
