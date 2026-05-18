
import type { DB } from "../db/client";
import { auditLog } from "../db/schema";

export async function audit(
  db: DB,
  entity: string,
  entityId: string,
  action: string,
  meta?: unknown,
  userId?: string,
) {
  await db.insert(auditLog).values({
    id: crypto.randomUUID(),
    entity,
    entityId,
    action,
    userId,
    meta: meta ?? null,
  });
}
