import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createDb, type Env } from "../db/client";
import { users } from "../db/schema";

import { audit } from "../lib/audit";

const app = new Hono<{ Bindings: Env }>();

app.get("/", async (c) => {
  const db = createDb(c.env);
  const rows = await db.select().from(users);
  return c.json(rows);
});

app.post("/", async (c) => {
  const db = createDb(c.env);
  const body = await c.req.json<typeof users.$inferInsert>();
  const [row] = await db
    .insert(users)
    .values({ ...body, id: crypto.randomUUID() })
    .returning();
  await audit(db, "user", row.id, "created");
  return c.json(row, 201);
});

app.get("/:id", async (c) => {
  const db = createDb(c.env);
  const [row] = await db.select().from(users).where(eq(users.id, c.req.param("id")));
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

app.patch("/:id", async (c) => {
  const db = createDb(c.env);
  const data = await c.req.json<Partial<typeof users.$inferInsert>>();
  const [updated] = await db
    .update(users)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(users.id, c.req.param("id")))
    .returning();
  if (!updated) return c.json({ error: "Not found" }, 404);
  await audit(db, "user", updated.id, "updated");
  return c.json(updated);
});

app.patch("/:id/role", async (c) => {
  const db = createDb(c.env);
  const { role } = await c.req.json<{ role: string }>();
  const [updated] = await db
    .update(users)
    .set({ role: role as any, updatedAt: new Date() })
    .where(eq(users.id, c.req.param("id")))
    .returning();
  if (!updated) return c.json({ error: "Not found" }, 404);
  await audit(db, "user", updated.id, "role_changed", { role });
  return c.json(updated);
});

app.delete("/:id", async (c) => {
  const db = createDb(c.env);
  await db.delete(users).where(eq(users.id, c.req.param("id")));
  return c.body(null, 204);
});

export default app;
