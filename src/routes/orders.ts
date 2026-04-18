import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, count, desc, sql, and, isNull, or } from "drizzle-orm";
import { db } from "../db";
import { orders, orderItems, orderStatusHistory, products, users, coupons, notifications } from "../db/schema";
import { createOrderSchema, updateOrderStatusSchema, parsePagination } from "../validators";
import { authMiddleware, requireRole, getCurrentUser } from "../middleware/auth";
import { ok, created, notFound, badRequest, paginate } from "../lib/response";

const app = new Hono();

const STAFF_ROLES = ["admin", "moderator"];

// GET /orders (admin/moderator only)
app.get("/", authMiddleware(), requireRole("admin", "moderator"), async (c) => {
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
});

// GET /orders/:id — auth required, owner or staff
app.get("/:id", authMiddleware(), async (c) => {
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
});

// GET /orders/:id/tracking — auth required, owner or staff
app.get("/:id/tracking", authMiddleware(), async (c) => {
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
});

// POST /orders — auth required, userId from JWT, atomic stock + coupon in transaction
app.post("/", authMiddleware(), zValidator("json", createOrderSchema), async (c) => {
  const body = c.req.valid("json");
  const currentUser = getCurrentUser(c);
  if (!currentUser) return c.json({ success: false, error: "Unauthorized" }, 401);

  const userId = currentUser.sub;

  const [userExists] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
  if (!userExists) return notFound(c, "User not found");

  // Validate all products and stock before any mutations
  let totalAmount = 0;
  const itemsToInsert: { productId: number; quantity: number; unitPrice: string }[] = [];

  for (const item of body.items) {
    const [product] = await db.select().from(products).where(eq(products.id, item.productId));
    if (!product) return notFound(c, `Product ${item.productId} not found`);
    if (product.stock < item.quantity) return badRequest(c, `Insufficient stock for ${product.name}`);

    const price = Number(product.price);
    totalAmount += price * item.quantity;
    itemsToInsert.push({ productId: product.id, quantity: item.quantity, unitPrice: String(price) });
  }

  // Validate coupon before any mutations
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

  // All validation passed — execute mutations in transaction with atomic operations
  const order = await db.transaction(async (tx) => {
    // Atomic stock decrement with stock >= quantity guard
    for (const item of itemsToInsert) {
      const [updatedProduct] = await tx.update(products)
        .set({ stock: sql`${products.stock} - ${item.quantity}` })
        .where(and(
          eq(products.id, item.productId),
          sql`${products.stock} >= ${item.quantity}`,
        ))
        .returning({ id: products.id });

      if (!updatedProduct) {
        throw new Error("INSUFFICIENT_STOCK");
      }
    }

    // Atomic coupon usage increment with maxUsage guard in WHERE
    if (hasCoupon && couponId) {
      const [updated] = await tx.update(coupons)
        .set({ currentUsage: sql`${coupons.currentUsage} + 1` })
        .where(and(
          eq(coupons.id, couponId),
          or(isNull(coupons.maxUsage), sql`${coupons.currentUsage} < ${coupons.maxUsage}`),
        ))
        .returning({ id: coupons.id });

      if (!updated) {
        throw new Error("COUPON_LIMIT_REACHED");
      }
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

    await tx.insert(orderStatusHistory).values({
      orderId: newOrder.id,
      toStatus: "pending",
      note: "Order created",
    });

    return newOrder;
  }).catch((err) => {
    if (err.message === "COUPON_LIMIT_REACHED") return null;
    if (err.message === "INSUFFICIENT_STOCK") return "INSUFFICIENT_STOCK" as const;
    throw err;
  });

  if (order === "INSUFFICIENT_STOCK") return badRequest(c, "Insufficient stock for one or more products");
  if (!order) return badRequest(c, "Coupon usage limit reached");

  return created(c, order);
});

// PATCH /orders/:id/status — admin/moderator only, SELECT inside transaction
app.patch("/:id/status", authMiddleware(), requireRole("admin", "moderator"), zValidator("json", updateOrderStatusSchema), async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return badRequest(c, "Invalid ID");

  const body = c.req.valid("json");

  // Wrap everything in a transaction including the read
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(orders).where(eq(orders.id, id));
    if (!existing) return null;

    const updateData: Record<string, unknown> = {
      status: body.status,
      updatedAt: new Date(),
    };
    if (body.trackingNumber) updateData.trackingNumber = body.trackingNumber;
    if (body.carrier) updateData.carrier = body.carrier;
    if (body.estimatedDelivery) updateData.estimatedDelivery = new Date(body.estimatedDelivery);

    const [updated] = await tx.update(orders)
      .set(updateData)
      .where(eq(orders.id, id))
      .returning();

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
});

export default app;
