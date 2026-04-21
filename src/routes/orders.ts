import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { zValidator } from "@hono/zod-validator";
import { eq, count, desc, sql, and, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { orders, orderItems, orderStatusHistory, products, users, coupons, notifications } from "../db/schema";
import { createOrderSchema, updateOrderStatusSchema, parsePagination } from "../validators";
import { authMiddleware, requireRole, getCurrentUser } from "../middleware/auth";
import { ok, created, notFound, badRequest, paginate } from "../lib/response";
import { syncPurchased } from "../lib/arcadedb-sync";

const app = new Hono();

const STAFF_ROLES = ["admin", "moderator"];

// ── Shared schemas ────────────────────────────────────────────────────────────

const OrderSchema = z.object({
  id: z.number(),
  userId: z.number(),
  status: z.enum(["pending", "processing", "shipped", "delivered", "cancelled"]),
  totalAmount: z.string(),
  discountAmount: z.string().nullable(),
  shippingAddress: z.string(),
  trackingNumber: z.string().nullable(),
  carrier: z.string().nullable(),
  estimatedDelivery: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ErrorSchema = z.object({ success: z.literal(false), error: z.string() });

// ── GET /orders ───────────────────────────────────────────────────────────────

app.get(
  "/",
  describeRoute({
    tags: ["Orders"],
    summary: "List all orders",
    description: "Returns paginated orders with user info. Admin or moderator only.",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "Paginated orders" },
      401: { description: "Unauthorized", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      403: { description: "Forbidden", content: { "application/json": { schema: resolver(ErrorSchema) } } },
    },
  }),
  authMiddleware(),
  requireRole("admin", "moderator"),
  async (c) => {
    const pg = parsePagination(c.req.query("page"), c.req.query("limit"));
    if (!pg) return badRequest(c, "Invalid pagination parameters");

    const [data, [{ value: total }]] = await Promise.all([
      db.select({
        id: orders.id,
        status: orders.status,
        totalAmount: orders.totalAmount,
        discountAmount: orders.discountAmount,
        shippingAddress: orders.shippingAddress,
        trackingNumber: orders.trackingNumber,
        carrier: orders.carrier,
        createdAt: orders.createdAt,
        user: { id: users.id, name: users.name, email: users.email },
      })
        .from(orders)
        .innerJoin(users, eq(orders.userId, users.id))
        .orderBy(desc(orders.createdAt))
        .limit(pg.limit)
        .offset(pg.offset),
      db.select({ value: count() }).from(orders),
    ]);

    return paginate(c, data, Number(total), pg.page, pg.limit);
  },
);

// ── GET /orders/:id ───────────────────────────────────────────────────────────

app.get(
  "/:id",
  describeRoute({
    tags: ["Orders"],
    summary: "Get order by ID",
    description: "Returns order details with items. Requires auth — owner or staff only.",
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: "Order with items",
        content: {
          "application/json": {
            schema: resolver(z.object({
              success: z.literal(true),
              data: OrderSchema.extend({
                items: z.array(z.object({
                  id: z.number(),
                  quantity: z.number(),
                  unitPrice: z.string(),
                  product: z.object({ id: z.number(), name: z.string(), imageUrl: z.string().nullable() }),
                })),
              }),
            })),
          },
        },
      },
      400: { description: "Invalid ID", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      401: { description: "Unauthorized", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      403: { description: "Forbidden", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      404: { description: "Order not found", content: { "application/json": { schema: resolver(ErrorSchema) } } },
    },
  }),
  authMiddleware(),
  async (c) => {
    const id = Number(c.req.param("id"));
    if (isNaN(id)) return badRequest(c, "Invalid ID");

    const [order] = await db.select().from(orders).where(eq(orders.id, id));
    if (!order) return notFound(c, "Order not found");

    const user = getCurrentUser(c);
    if (!user || (order.userId !== user.sub && !STAFF_ROLES.includes(user.role))) {
      return c.json({ success: false, error: "Forbidden" }, 403);
    }

    const items = await db.select({
      id: orderItems.id,
      quantity: orderItems.quantity,
      unitPrice: orderItems.unitPrice,
      product: { id: products.id, name: products.name, imageUrl: products.imageUrl },
    })
      .from(orderItems)
      .innerJoin(products, eq(orderItems.productId, products.id))
      .where(eq(orderItems.orderId, id));

    return ok(c, { ...order, items });
  },
);

// ── GET /orders/:id/tracking ──────────────────────────────────────────────────

app.get(
  "/:id/tracking",
  describeRoute({
    tags: ["Orders"],
    summary: "Get order tracking",
    description: "Returns tracking info and status history. Requires auth — owner or staff only.",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "Tracking info with status history" },
      401: { description: "Unauthorized", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      403: { description: "Forbidden", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      404: { description: "Order not found", content: { "application/json": { schema: resolver(ErrorSchema) } } },
    },
  }),
  authMiddleware(),
  async (c) => {
    const id = Number(c.req.param("id"));
    if (isNaN(id)) return badRequest(c, "Invalid ID");

    const [order] = await db.select({
      id: orders.id,
      userId: orders.userId,
      status: orders.status,
      trackingNumber: orders.trackingNumber,
      carrier: orders.carrier,
      estimatedDelivery: orders.estimatedDelivery,
    }).from(orders).where(eq(orders.id, id));

    if (!order) return notFound(c, "Order not found");

    const user = getCurrentUser(c);
    if (!user || (order.userId !== user.sub && !STAFF_ROLES.includes(user.role))) {
      return c.json({ success: false, error: "Forbidden" }, 403);
    }

    const history = await db.select()
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, id))
      .orderBy(desc(orderStatusHistory.createdAt));

    return ok(c, { ...order, history });
  },
);

// ── POST /orders ──────────────────────────────────────────────────────────────

app.post(
  "/",
  describeRoute({
    tags: ["Orders"],
    summary: "Create order",
    description: "Places a new order. userId is derived from the JWT token. Validates stock and coupon atomically.",
    security: [{ bearerAuth: [] }],
    responses: {
      201: { description: "Order created", content: { "application/json": { schema: resolver(z.object({ success: z.literal(true), data: OrderSchema })) } } },
      400: { description: "Validation error / insufficient stock / invalid coupon", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      401: { description: "Unauthorized", content: { "application/json": { schema: resolver(ErrorSchema) } } },
    },
  }),
  authMiddleware(),
  zValidator("json", createOrderSchema),
  async (c) => {
    const body = c.req.valid("json");
    const currentUser = getCurrentUser(c);
    if (!currentUser) return c.json({ success: false, error: "Unauthorized" }, 401);

    const userId = currentUser.sub;

    const [userExists] = await db.select({ id: users.id, name: users.name, username: users.username }).from(users).where(eq(users.id, userId));
    if (!userExists) return notFound(c, "User not found");

    let totalAmount = 0;
    const itemsToInsert: { productId: number; quantity: number; unitPrice: string; productName: string; productCategory: string; productPrice: string }[] = [];

    for (const item of body.items) {
      const [product] = await db.select().from(products).where(eq(products.id, item.productId));
      if (!product) return notFound(c, `Product ${item.productId} not found`);
      if (product.stock < item.quantity) return badRequest(c, `Insufficient stock for ${product.name}`);

      const price = Number(product.price);
      totalAmount += price * item.quantity;
      itemsToInsert.push({ productId: product.id, quantity: item.quantity, unitPrice: String(price), productName: product.name, productCategory: product.category, productPrice: product.price });
    }

    let discountAmount = 0;
    let couponId: number | undefined;
    let hasCoupon = false;

    if (body.couponCode) {
      const [coupon] = await db.select().from(coupons).where(eq(coupons.code, body.couponCode.toUpperCase()));

      if (!coupon) return badRequest(c, "Invalid coupon code");
      if (!coupon.isActive) return badRequest(c, "Coupon is no longer active");
      if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) return badRequest(c, "Coupon has expired");
      if (coupon.maxUsage && coupon.currentUsage >= coupon.maxUsage) return badRequest(c, "Coupon usage limit reached");
      if (Number(coupon.minOrderAmount) > totalAmount) return badRequest(c, `Minimum order amount is ${coupon.minOrderAmount}`);

      if (coupon.discountType === "percentage") {
        discountAmount = totalAmount * (Number(coupon.discountValue) / 100);
      } else {
        discountAmount = Math.min(Number(coupon.discountValue), totalAmount);
      }

      couponId = coupon.id;
      hasCoupon = true;
    }

    const finalAmount = totalAmount - discountAmount;

    const order = await db.transaction(async (tx) => {
      for (const item of itemsToInsert) {
        const [updatedProduct] = await tx.update(products)
          .set({ stock: sql`${products.stock} - ${item.quantity}` })
          .where(and(eq(products.id, item.productId), sql`${products.stock} >= ${item.quantity}`))
          .returning({ id: products.id });

        if (!updatedProduct) throw new Error("INSUFFICIENT_STOCK");
      }

      if (hasCoupon && couponId) {
        const [updated] = await tx.update(coupons)
          .set({ currentUsage: sql`${coupons.currentUsage} + 1` })
          .where(and(eq(coupons.id, couponId), or(isNull(coupons.maxUsage), sql`${coupons.currentUsage} < ${coupons.maxUsage}`)))
          .returning({ id: coupons.id });

        if (!updated) throw new Error("COUPON_LIMIT_REACHED");
      }

      const [newOrder] = await tx.insert(orders).values({
        userId,
        totalAmount: String(finalAmount),
        discountAmount: String(discountAmount),
        couponId,
        shippingAddress: body.shippingAddress,
        notes: body.notes,
      }).returning();

      await tx.insert(orderItems).values(itemsToInsert.map((i) => ({ ...i, orderId: newOrder.id })));
      await tx.insert(orderStatusHistory).values({ orderId: newOrder.id, toStatus: "pending", note: "Order created" });

      return newOrder;
    }).catch((err) => {
      if (err.message === "COUPON_LIMIT_REACHED") return null;
      if (err.message === "INSUFFICIENT_STOCK") return "INSUFFICIENT_STOCK" as const;
      throw err;
    });

    if (order === "INSUFFICIENT_STOCK") return badRequest(c, "Insufficient stock for one or more products");
    if (!order) return badRequest(c, "Coupon usage limit reached");

    // ── ArcadeDB: fire-and-forget sync ──────────────────────────────────────────
    // Run after the PG transaction is confirmed. ArcadeDB failures don't affect
    // the response — the order is already committed.
    syncPurchased({
      userId,
      userName: userExists.name,
      username: userExists.username,
      items: itemsToInsert.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        productCategory: item.productCategory,
        productPrice: item.productPrice,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
      })),
      orderId: order.id,
      date: order.createdAt.toISOString(),
    });

    return created(c, order);
  },
);

// ── PATCH /orders/:id/status ──────────────────────────────────────────────────

app.patch(
  "/:id/status",
  describeRoute({
    tags: ["Orders"],
    summary: "Update order status",
    description: "Updates order status and optionally sets tracking info. Admin or moderator only. Sends a notification to the user.",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "Order status updated", content: { "application/json": { schema: resolver(z.object({ success: z.literal(true), data: OrderSchema })) } } },
      400: { description: "Validation error", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      401: { description: "Unauthorized", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      403: { description: "Forbidden", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      404: { description: "Order not found", content: { "application/json": { schema: resolver(ErrorSchema) } } },
    },
  }),
  authMiddleware(),
  requireRole("admin", "moderator"),
  zValidator("json", updateOrderStatusSchema),
  async (c) => {
    const id = Number(c.req.param("id"));
    if (isNaN(id)) return badRequest(c, "Invalid ID");

    const body = c.req.valid("json");

    const result = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(orders).where(eq(orders.id, id));
      if (!existing) return null;

      const updateData: Record<string, unknown> = { status: body.status, updatedAt: new Date() };
      if (body.trackingNumber) updateData.trackingNumber = body.trackingNumber;
      if (body.carrier) updateData.carrier = body.carrier;
      if (body.estimatedDelivery) updateData.estimatedDelivery = new Date(body.estimatedDelivery);

      const [updated] = await tx.update(orders).set(updateData).where(eq(orders.id, id)).returning();

      await tx.insert(orderStatusHistory).values({
        orderId: id,
        fromStatus: existing.status,
        toStatus: body.status,
        note: body.note,
      });

      await tx.insert(notifications).values({
        userId: existing.userId,
        type: "order_status",
        title: `Order #${id} status updated`,
        message: `Your order status changed from ${existing.status} to ${body.status}`,
        metadata: JSON.stringify({ orderId: id, fromStatus: existing.status, toStatus: body.status }),
      });

      return updated;
    });

    if (!result) return notFound(c, "Order not found");

    return ok(c, result);
  },
);

export default app;
