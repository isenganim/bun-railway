import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { zValidator } from "@hono/zod-validator";
import { eq, ilike, count, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { users, orders, reviews } from "../db/schema";
import { updateUserSchema, parsePagination } from "../validators";
import { authMiddleware, requireRole, requireOwnerOrRole } from "../middleware/auth";
import { ok, created, notFound, badRequest, paginate } from "../lib/response";

const app = new Hono();

// ── Shared schemas ────────────────────────────────────────────────────────────

const UserSchema = z.object({
  id: z.number(),
  name: z.string(),
  username: z.string(),
  role: z.enum(["admin", "user", "moderator"]),
  status: z.enum(["active", "inactive", "banned"]),
  bio: z.string().nullable(),
  avatar: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const PaginatedUsersSchema = z.object({
  success: z.literal(true),
  data: z.array(UserSchema),
  meta: z.object({
    total: z.number(),
    page: z.number(),
    limit: z.number(),
    totalPages: z.number(),
  }),
});

const UserResponseSchema = z.object({ success: z.literal(true), data: UserSchema });
const ErrorSchema = z.object({ success: z.literal(false), error: z.string() });
const MessageSchema = z.object({ success: z.literal(true), data: z.object({ message: z.string() }) });

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

// ── GET /users ────────────────────────────────────────────────────────────────

app.get(
  "/",
  describeRoute({
    tags: ["Users"],
    summary: "List users",
    description: "Returns a paginated list of users. Email is not exposed.",
    responses: {
      200: {
        description: "Paginated user list",
        content: { "application/json": { schema: resolver(PaginatedUsersSchema) } },
      },
      400: { description: "Invalid pagination", content: { "application/json": { schema: resolver(ErrorSchema) } } },
    },
  }),
  async (c) => {
    const pg = parsePagination(c.req.query("page"), c.req.query("limit"));
    if (!pg) return badRequest(c, "Invalid pagination parameters");

    const search = c.req.query("search");
    const where = search ? ilike(users.name, `%${search}%`) : undefined;

    const [data, [{ value: total }]] = await Promise.all([
      db.select(safeUserFields).from(users).where(where).orderBy(desc(users.createdAt)).limit(pg.limit).offset(pg.offset),
      db.select({ value: count() }).from(users).where(where),
    ]);

    return paginate(c, data, Number(total), pg.page, pg.limit);
  },
);

// ── GET /users/:id ────────────────────────────────────────────────────────────

app.get(
  "/:id",
  describeRoute({
    tags: ["Users"],
    summary: "Get user by ID",
    responses: {
      200: { description: "User found", content: { "application/json": { schema: resolver(UserResponseSchema) } } },
      404: { description: "User not found", content: { "application/json": { schema: resolver(ErrorSchema) } } },
    },
  }),
  async (c) => {
    const id = Number(c.req.param("id"));
    if (isNaN(id)) return badRequest(c, "Invalid ID");

    const [user] = await db.select(safeUserFields).from(users).where(eq(users.id, id));
    if (!user) return notFound(c, "User not found");

    return ok(c, user);
  },
);

// ── GET /users/:id/orders ─────────────────────────────────────────────────────

app.get(
  "/:id/orders",
  describeRoute({
    tags: ["Users"],
    summary: "Get user orders",
    description: "Returns paginated orders for a user. Requires auth — owner or admin only.",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "Paginated orders" },
      401: { description: "Unauthorized", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      403: { description: "Forbidden", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      404: { description: "User not found", content: { "application/json": { schema: resolver(ErrorSchema) } } },
    },
  }),
  authMiddleware(),
  requireOwnerOrRole(extractUserId, "admin"),
  async (c) => {
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
  },
);

// ── GET /users/:id/reviews ────────────────────────────────────────────────────

app.get(
  "/:id/reviews",
  describeRoute({
    tags: ["Users"],
    summary: "Get user reviews",
    description: "Returns all reviews written by a user.",
    responses: {
      200: { description: "List of reviews" },
      404: { description: "User not found", content: { "application/json": { schema: resolver(ErrorSchema) } } },
    },
  }),
  async (c) => {
    const id = Number(c.req.param("id"));
    if (isNaN(id)) return badRequest(c, "Invalid ID");

    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, id));
    if (!user) return notFound(c, "User not found");

    const data = await db.select().from(reviews).where(eq(reviews.userId, id)).orderBy(desc(reviews.createdAt));

    return ok(c, data);
  },
);

// ── POST /users ───────────────────────────────────────────────────────────────

app.post(
  "/",
  describeRoute({
    tags: ["Users"],
    summary: "Create user (no password)",
    description: "Creates a user without a password. For seeding/admin use. Use /auth/register for normal signup.",
    responses: {
      201: { description: "User created", content: { "application/json": { schema: resolver(UserResponseSchema) } } },
      400: { description: "Missing required fields", content: { "application/json": { schema: resolver(ErrorSchema) } } },
    },
  }),
  async (c) => {
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
  },
);

// ── PATCH /users/:id ──────────────────────────────────────────────────────────

app.patch(
  "/:id",
  describeRoute({
    tags: ["Users"],
    summary: "Update user",
    description: "Updates name, bio, or avatar. Requires auth — owner or admin only.",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "User updated", content: { "application/json": { schema: resolver(UserResponseSchema) } } },
      400: { description: "Invalid input", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      401: { description: "Unauthorized", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      403: { description: "Forbidden", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      404: { description: "User not found", content: { "application/json": { schema: resolver(ErrorSchema) } } },
    },
  }),
  authMiddleware(),
  requireOwnerOrRole(extractUserId, "admin"),
  zValidator("json", updateUserSchema),
  async (c) => {
    const id = Number(c.req.param("id"));
    if (isNaN(id)) return badRequest(c, "Invalid ID");

    const body = c.req.valid("json");

    const [user] = await db.update(users)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning(safeUserFields);

    if (!user) return notFound(c, "User not found");
    return ok(c, user);
  },
);

// ── DELETE /users/:id ─────────────────────────────────────────────────────────

app.delete(
  "/:id",
  describeRoute({
    tags: ["Users"],
    summary: "Delete user",
    description: "Permanently deletes a user. Admin only.",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "User deleted", content: { "application/json": { schema: resolver(MessageSchema) } } },
      401: { description: "Unauthorized", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      403: { description: "Forbidden", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      404: { description: "User not found", content: { "application/json": { schema: resolver(ErrorSchema) } } },
    },
  }),
  authMiddleware(),
  requireRole("admin"),
  async (c) => {
    const id = Number(c.req.param("id"));
    if (isNaN(id)) return badRequest(c, "Invalid ID");

    const [user] = await db.delete(users).where(eq(users.id, id)).returning();
    if (!user) return notFound(c, "User not found");

    return ok(c, { message: "User deleted" });
  },
);

export default app;
