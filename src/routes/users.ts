import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, ilike, count, desc } from "drizzle-orm";
import { db } from "../db";
import { users, orders, reviews } from "../db/schema";
import { updateUserSchema } from "../validators";
import { authMiddleware, requireRole } from "../middleware/auth";
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
    db.select({
      id: users.id,
      name: users.name,
      email: users.email,
      username: users.username,
      role: users.role,
      status: users.status,
      bio: users.bio,
      avatar: users.avatar,
      createdAt: users.createdAt,
    }).from(users).where(where).orderBy(desc(users.createdAt)).limit(limit).offset(offset),
    db.select({ value: count() }).from(users).where(where),
  ]);

  return paginate(c, data, Number(total), page, limit);
});

// GET /users/:id
app.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return badRequest(c, "Invalid ID");

  const [user] = await db.select({
    id: users.id,
    name: users.name,
    email: users.email,
    username: users.username,
    role: users.role,
    status: users.status,
    bio: users.bio,
    avatar: users.avatar,
    createdAt: users.createdAt,
  }).from(users).where(eq(users.id, id));
  if (!user) return notFound(c, "User not found");

  return ok(c, user);
});

// GET /users/:id/orders
app.get("/:id/orders", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return badRequest(c, "Invalid ID");

  const page = Number(c.req.query("page") ?? 1);
  const limit = Math.min(Number(c.req.query("limit") ?? 20), 100);
  const offset = (page - 1) * limit;

  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, id));
  if (!user) return notFound(c, "User not found");

  const [data, [{ value: total }]] = await Promise.all([
    db.select().from(orders).where(eq(orders.userId, id)).orderBy(desc(orders.createdAt)).limit(limit).offset(offset),
    db.select({ value: count() }).from(orders).where(eq(orders.userId, id)),
  ]);

  return paginate(c, data, Number(total), page, limit);
});

// GET /users/:id/reviews
app.get("/:id/reviews", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return badRequest(c, "Invalid ID");

  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, id));
  if (!user) return notFound(c, "User not found");

  const data = await db.select().from(reviews).where(eq(reviews.userId, id)).orderBy(desc(reviews.createdAt));

  return ok(c, data);
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

// PATCH /users/:id (validated)
app.patch("/:id", zValidator("json", updateUserSchema), async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return badRequest(c, "Invalid ID");

  const body = c.req.valid("json");

  const [user] = await db.update(users)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();

  if (!user) return notFound(c, "User not found");
  return ok(c, user);
});

// DELETE /users/:id (admin only)
app.delete("/:id", authMiddleware(), requireRole("admin"), async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return badRequest(c, "Invalid ID");

  const [user] = await db.delete(users).where(eq(users.id, id)).returning();
  if (!user) return notFound(c, "User not found");

  return ok(c, { message: "User deleted" });
});

export default app;
