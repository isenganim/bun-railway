import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { zValidator } from "@hono/zod-validator";
import { eq, and, count, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { notifications, users } from "../db/schema";
import { createNotificationSchema, parsePagination } from "../validators";
import { authMiddleware, requireRole, requireOwnerOrRole, getCurrentUser } from "../middleware/auth";
import { ok, created, notFound, badRequest, paginate } from "../lib/response";

const app = new Hono();

const extractUserId = (c: any) => Number(c.req.param("userId"));

// ── Shared schemas ────────────────────────────────────────────────────────────

const NotificationSchema = z.object({
  id: z.number(),
  userId: z.number(),
  type: z.enum(["order_status", "review_reply", "promotion", "system"]),
  title: z.string(),
  message: z.string(),
  isRead: z.boolean(),
  metadata: z.string().nullable(),
  createdAt: z.string(),
});

const ErrorSchema = z.object({ success: z.literal(false), error: z.string() });
const MessageSchema = z.object({ success: z.literal(true), data: z.object({ message: z.string() }) });
const NotificationResponseSchema = z.object({ success: z.literal(true), data: NotificationSchema });
const PaginatedNotificationsSchema = z.object({
  success: z.literal(true),
  data: z.array(NotificationSchema),
  meta: z.object({ total: z.number(), page: z.number(), limit: z.number(), totalPages: z.number() }),
});

// GET /notifications/users/:userId — auth required, owner or admin
app.get(
  "/users/:userId",
  describeRoute({
    tags: ["Notifications"],
    summary: "Get user notifications",
    description: "Returns paginated notifications for a user. Supports ?unread=true filter. Owner or admin only.",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "Paginated notifications", content: { "application/json": { schema: resolver(PaginatedNotificationsSchema) } } },
      400: { description: "Invalid parameters", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      401: { description: "Unauthorized", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      403: { description: "Forbidden", content: { "application/json": { schema: resolver(ErrorSchema) } } },
    },
  }),
  authMiddleware(), requireOwnerOrRole(extractUserId, "admin"), async (c) => {
  const userId = Number(c.req.param("userId"));
  if (isNaN(userId)) return badRequest(c, "Invalid user ID");

  const pg = parsePagination(c.req.query("page"), c.req.query("limit"));
  if (!pg) return badRequest(c, "Invalid pagination parameters");

  const unreadOnly = c.req.query("unread") === "true";

  const conditions = [eq(notifications.userId, userId)];
  if (unreadOnly) conditions.push(eq(notifications.isRead, false));

  const where = and(...conditions);

  const [data, [{ value: total }]] = await Promise.all([
    db.select().from(notifications).where(where).orderBy(desc(notifications.createdAt)).limit(pg.limit).offset(pg.offset),
    db.select({ value: count() }).from(notifications).where(where),
  ]);

  return paginate(c, data, Number(total), pg.page, pg.limit);
});

// GET /notifications/users/:userId/unread-count — auth required, owner or admin
app.get(
  "/users/:userId/unread-count",
  describeRoute({
    tags: ["Notifications"],
    summary: "Get unread notification count",
    description: "Returns the number of unread notifications for a user. Owner or admin only.",
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: "Unread count",
        content: {
          "application/json": {
            schema: resolver(z.object({
              success: z.literal(true),
              data: z.object({ userId: z.number(), unreadCount: z.number() }),
            })),
          },
        },
      },
      400: { description: "Invalid user ID", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      401: { description: "Unauthorized", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      403: { description: "Forbidden", content: { "application/json": { schema: resolver(ErrorSchema) } } },
    },
  }),
  authMiddleware(), requireOwnerOrRole(extractUserId, "admin"), async (c) => {
  const userId = Number(c.req.param("userId"));
  if (isNaN(userId)) return badRequest(c, "Invalid user ID");

  const [{ value: unreadCount }] = await db.select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));

  return ok(c, { userId, unreadCount: Number(unreadCount) });
});

// PATCH /notifications/:id/read — auth required, owner of notification or admin
app.patch(
  "/:id/read",
  describeRoute({
    tags: ["Notifications"],
    summary: "Mark notification as read",
    description: "Marks a single notification as read. Owner of the notification or admin only.",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "Notification marked as read", content: { "application/json": { schema: resolver(NotificationResponseSchema) } } },
      401: { description: "Unauthorized", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      403: { description: "Forbidden", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      404: { description: "Notification not found", content: { "application/json": { schema: resolver(ErrorSchema) } } },
    },
  }),
  authMiddleware(), async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return badRequest(c, "Invalid ID");

  const [existing] = await db.select().from(notifications).where(eq(notifications.id, id));
  if (!existing) return notFound(c, "Notification not found");

  const user = getCurrentUser(c);
  if (!user || (existing.userId !== user.sub && user.role !== "admin")) {
    return c.json({ success: false, error: "Forbidden" }, 403);
  }

  const [notification] = await db.update(notifications)
    .set({ isRead: true })
    .where(eq(notifications.id, id))
    .returning();

  return ok(c, notification);
});

// PATCH /notifications/users/:userId/read-all — auth required, owner or admin
app.patch(
  "/users/:userId/read-all",
  describeRoute({
    tags: ["Notifications"],
    summary: "Mark all notifications as read",
    description: "Marks all unread notifications for a user as read. Owner or admin only.",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "All notifications marked as read", content: { "application/json": { schema: resolver(MessageSchema) } } },
      401: { description: "Unauthorized", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      403: { description: "Forbidden", content: { "application/json": { schema: resolver(ErrorSchema) } } },
    },
  }),
  authMiddleware(), requireOwnerOrRole(extractUserId, "admin"), async (c) => {
  const userId = Number(c.req.param("userId"));
  if (isNaN(userId)) return badRequest(c, "Invalid user ID");

  await db.update(notifications)
    .set({ isRead: true })
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));

  return ok(c, { message: "All notifications marked as read" });
});

// POST /notifications (admin/system use)
app.post(
  "/",
  describeRoute({
    tags: ["Notifications"],
    summary: "Create notification",
    description: "Sends a notification to a specific user. Admin only.",
    security: [{ bearerAuth: [] }],
    responses: {
      201: { description: "Notification created", content: { "application/json": { schema: resolver(NotificationResponseSchema) } } },
      400: { description: "Validation error", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      401: { description: "Unauthorized", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      403: { description: "Forbidden", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      404: { description: "User not found", content: { "application/json": { schema: resolver(ErrorSchema) } } },
    },
  }),
  authMiddleware(), requireRole("admin"), zValidator("json", createNotificationSchema), async (c) => {
  const body = c.req.valid("json");

  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, body.userId));
  if (!user) return notFound(c, "User not found");

  const [notification] = await db.insert(notifications).values({
    userId: body.userId,
    type: body.type,
    title: body.title,
    message: body.message,
    metadata: body.metadata,
  }).returning();

  return created(c, notification);
});

// DELETE /notifications/:id — auth required, owner or admin
app.delete(
  "/:id",
  describeRoute({
    tags: ["Notifications"],
    summary: "Delete notification",
    description: "Deletes a notification. Owner of the notification or admin only.",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "Notification deleted", content: { "application/json": { schema: resolver(MessageSchema) } } },
      401: { description: "Unauthorized", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      403: { description: "Forbidden", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      404: { description: "Notification not found", content: { "application/json": { schema: resolver(ErrorSchema) } } },
    },
  }),
  authMiddleware(), async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return badRequest(c, "Invalid ID");

  const [existing] = await db.select().from(notifications).where(eq(notifications.id, id));
  if (!existing) return notFound(c, "Notification not found");

  const user = getCurrentUser(c);
  if (!user || (existing.userId !== user.sub && user.role !== "admin")) {
    return c.json({ success: false, error: "Forbidden" }, 403);
  }

  await db.delete(notifications).where(eq(notifications.id, id));

  return ok(c, { message: "Notification deleted" });
});

export default app;
