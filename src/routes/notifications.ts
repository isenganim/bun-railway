import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, and, count, desc } from "drizzle-orm";
import { db } from "../db";
import { notifications, users } from "../db/schema";
import { createNotificationSchema, parsePagination } from "../validators";
import { authMiddleware, requireRole, requireOwnerOrRole, getCurrentUser } from "../middleware/auth";
import { ok, created, notFound, badRequest, paginate } from "../lib/response";

const app = new Hono();

const extractUserId = (c: any) => Number(c.req.param("userId"));

// GET /notifications/users/:userId — auth required, owner or admin
app.get("/users/:userId", authMiddleware(), requireOwnerOrRole(extractUserId, "admin"), async (c) => {
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
app.get("/users/:userId/unread-count", authMiddleware(), requireOwnerOrRole(extractUserId, "admin"), async (c) => {
  const userId = Number(c.req.param("userId"));
  if (isNaN(userId)) return badRequest(c, "Invalid user ID");

  const [{ value: unreadCount }] = await db.select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));

  return ok(c, { userId, unreadCount: Number(unreadCount) });
});

// PATCH /notifications/:id/read — auth required, owner of notification or admin
app.patch("/:id/read", authMiddleware(), async (c) => {
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
app.patch("/users/:userId/read-all", authMiddleware(), requireOwnerOrRole(extractUserId, "admin"), async (c) => {
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

// DELETE /notifications/:id — auth required, owner or admin
app.delete("/:id", authMiddleware(), async (c) => {
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
