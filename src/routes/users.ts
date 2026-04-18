import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, ilike, count, desc } from "drizzle-orm";
import { db } from "../db";
import { users, orders, reviews } from "../db/schema";
import { updateUserSchema, parsePagination } from "../validators";
import { authMiddleware, requireRole, requireOwnerOrRole } from "../middleware/auth";
import { ok, created, notFound, badRequest, paginate } from "../lib/response";

const app = new Hono();

const safeUserFields = {
  id: users.id,
  name: users.name,
  username: users.username,
  role: users.role,
  status: users.status,
  bio: users.bio,
  avatar: users.avatar,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
};

const extractUserId = (c: any) => Number(c.req.param("id"));

// GET /users — public, no email exposed
app.get("/", async (c) => {
  const pg = parsePagination(c.req.query("page"), c.req.query("limit"));
  if (!pg) return badRequest(c, "Invalid pagination parameters");

  const search = c.req.query("search");
  const where = search ? ilike(users.name, `%${search}%`) : undefined;

  const [data, [{ value: total }]] = await Promise.all([
    db.select(safeUserFields).from(users).where(where).orderBy(desc(users.createdAt)).limit(pg.limit).offset(pg.offset),
    db.select({ value: count() }).from(users).where(where),
  ]);

  return paginate(c, data, Number(total), pg.page, pg.limit);
});

// GET /users/:id — public, no email exposed
app.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return badRequest(c, "Invalid ID");

  const [user] = await db.select(safeUserFields).from(users).where(eq(users.id, id));
  if (!user) return notFound(c, "User not found");

  return ok(c, user);
});

// GET /users/:id/orders — auth required, owner or admin
app.get("/:id/orders", authMiddleware(), requireOwnerOrRole(extractUserId, "admin"), async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return badRequest(c, "Invalid ID");

  const pg = parsePagination(c.req.query("page"), c.req.query("limit"));
  if (!pg) return badRequest(c, "Invalid pagination parameters");

  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, id));
  if (!user) return notFound(c, "User not found");

  const [data, [{ value: total }]] = await Promise.all([
    db.select().from(orders).where(eq(orders.userId, id)).orderBy(desc(orders.createdAt)).limit(pg.limit).offset(pg.offset),
    db.select({ value: count() }).from(orders).where(eq(orders.userId, id)),
  ]);

  return paginate(c, data, Number(total), pg.page, pg.limit);
});

// GET /users/:id/reviews — public
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

// PATCH /users/:id — auth required, owner or admin, safe projection
app.patch("/:id", authMiddleware(), requireOwnerOrRole(extractUserId, "admin"), zValidator("json", updateUserSchema), async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return badRequest(c, "Invalid ID");

  const body = c.req.valid("json");

  const [user] = await db.update(users)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning(safeUserFields);

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
