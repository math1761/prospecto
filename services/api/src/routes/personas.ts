import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createDb, type Env } from "../db/client";
import { personas } from "../db/schema";


const app = new Hono<{ Bindings: Env }>();

app.get("/", async (c) => {
  const db = createDb(c.env);
  return c.json(await db.select().from(personas));
});

app.post("/", async (c) => {
  const db = createDb(c.env);
  const body = await c.req.json<typeof personas.$inferInsert>();
  const [row] = await db
    .insert(personas)
    .values({ ...body, id: crypto.randomUUID() })
    .returning();
  return c.json(row, 201);
});

app.get("/:id", async (c) => {
  const db = createDb(c.env);
  const [row] = await db.select().from(personas).where(eq(personas.id, c.req.param("id")));
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

app.patch("/:id", async (c) => {
  const db = createDb(c.env);
  const data = await c.req.json<Partial<typeof personas.$inferInsert>>();
  const [updated] = await db
    .update(personas)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(personas.id, c.req.param("id")))
    .returning();
  if (!updated) return c.json({ error: "Not found" }, 404);
  return c.json(updated);
});

app.delete("/:id", async (c) => {
  const db = createDb(c.env);
  await db.delete(personas).where(eq(personas.id, c.req.param("id")));
  return c.body(null, 204);
});

// Activate a persona (deactivates all others)
app.post("/:id/activate", async (c) => {
  const db = createDb(c.env);
  // Deactivate all
  await db.update(personas).set({ isActive: false });
  // Activate target
  const [activated] = await db
    .update(personas)
    .set({ isActive: true, updatedAt: new Date() })
    .where(eq(personas.id, c.req.param("id")))
    .returning();
  if (!activated) return c.json({ error: "Not found" }, 404);
  return c.json(activated);
});

export default app;
