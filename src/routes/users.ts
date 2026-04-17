import { Hono } from "hono";
import { eq, ilike, count, desc } from "drizzle-orm";
import { db } from "../db";
import { users } from "../db/schema";
import { ok, created, notFound, badRequest, paginate } from "../lib/response";

const app = new Hono();

// GET /users
app.get("/", async (c) => {
  const page = Number(c.req.query("page") ?? 1);
  const limit = Math.min(Number(c.req.query("limit") ?? 20), 100);
  const search = c.req.query("search");
  const offset = (page - 1) * limit;

  const where = search ? ilike(users.name, `%${search}%`) : undefined;

  const [data, [{ value: total }]] = await Promise.all([
    db.select().from(users).where(where).orderBy(desc(users.createdAt)).limit(limit).offset(offset),
    db.select({ value: count() }).from(users).where(where),
  ]);

  return paginate(c, data, Number(total), page, limit);
});

// GET /users/:id
app.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return badRequest(c, "Invalid ID");

  const [user] = await db.select().from(users).where(eq(users.id, id));
  if (!user) return notFound(c, "User not found");

  return ok(c, user);
});

// POST /users
app.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.name || !body?.email || !body?.username)
    return badRequest(c, "name, email, username are required");

  const [user] = await db.insert(users).values({
    name: body.name,
    email: body.email,
    username: body.username,
    bio: body.bio,
  }).returning();

  return created(c, user);
});

// PATCH /users/:id
app.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return badRequest(c, "Invalid ID");

  const body = await c.req.json().catch(() => null);
  if (!body) return badRequest(c, "Request body required");

  const [user] = await db.update(users)
    .set({ name: body.name, bio: body.bio, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();

  if (!user) return notFound(c, "User not found");
  return ok(c, user);
});

// DELETE /users/:id
app.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return badRequest(c, "Invalid ID");

  const [user] = await db.delete(users).where(eq(users.id, id)).returning();
  if (!user) return notFound(c, "User not found");

  return ok(c, { message: "User deleted" });
});

export default app;
