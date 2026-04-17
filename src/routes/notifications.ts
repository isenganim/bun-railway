import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, and, count, desc } from "drizzle-orm";
import { db } from "../db";
import { notifications, users } from "../db/schema";
import { createNotificationSchema } from "../validators";
import { authMiddleware, requireRole } from "../middleware/auth";
import { ok, created, notFound, badRequest, paginate } from "../lib/response";

const app = new Hono();

// GET /notifications/users/:userId
app.get("/users/:userId", async (c) => {
  const userId = Number(c.req.param("userId"));
  if (isNaN(userId)) return badRequest(c, "Invalid user ID");

  const page = Number(c.req.query("page") ?? 1);
  const limit = Math.min(Number(c.req.query("limit") ?? 20), 100);
  const unreadOnly = c.req.query("unread") === "true";
  const offset = (page - 1) * limit;

  const conditions = [eq(notifications.userId, userId)];
  if (unreadOnly) conditions.push(eq(notifications.isRead, false));

  const where = and(...conditions);

  const [data, [{ value: total }]] = await Promise.all([
    db.select().from(notifications).where(where).orderBy(desc(notifications.createdAt)).limit(limit).offset(offset),
    db.select({ value: count() }).from(notifications).where(where),
  ]);

  // Get unread count
  const [{ value: unreadCount }] = await db.select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));

  return paginate(c, data, Number(total), page, limit);
});

// GET /notifications/users/:userId/unread-count
app.get("/users/:userId/unread-count", async (c) => {
  const userId = Number(c.req.param("userId"));
  if (isNaN(userId)) return badRequest(c, "Invalid user ID");

  const [{ value: unreadCount }] = await db.select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));

  return ok(c, { userId, unreadCount: Number(unreadCount) });
});

// PATCH /notifications/:id/read
app.patch("/:id/read", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return badRequest(c, "Invalid ID");

  const [notification] = await db.update(notifications)
    .set({ isRead: true })
    .where(eq(notifications.id, id))
    .returning();

  if (!notification) return notFound(c, "Notification not found");
  return ok(c, notification);
});

// PATCH /notifications/users/:userId/read-all
app.patch("/users/:userId/read-all", async (c) => {
  const userId = Number(c.req.param("userId"));
  if (isNaN(userId)) return badRequest(c, "Invalid user ID");

  await db.update(notifications)
    .set({ isRead: true })
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));

  return ok(c, { message: "All notifications marked as read" });
});

// POST /notifications (admin/system use)
app.post("/", authMiddleware(), requireRole("admin"), zValidator("json", createNotificationSchema), async (c) => {
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

// DELETE /notifications/:id
app.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return badRequest(c, "Invalid ID");

  const [notification] = await db.delete(notifications).where(eq(notifications.id, id)).returning();
  if (!notification) return notFound(c, "Notification not found");

  return ok(c, { message: "Notification deleted" });
});

export default app;
