import { Hono } from "hono";
import { eq, count, desc } from "drizzle-orm";
import { db } from "../db";
import { orders, orderItems, products, users } from "../db/schema";
import { ok, created, notFound, badRequest, paginate } from "../lib/response";

const app = new Hono();

// GET /orders
app.get("/", async (c) => {
  const page = Number(c.req.query("page") ?? 1);
  const limit = Math.min(Number(c.req.query("limit") ?? 20), 100);
  const offset = (page - 1) * limit;

  const [data, [{ value: total }]] = await Promise.all([
    db.select({
      id: orders.id,
      status: orders.status,
      totalAmount: orders.totalAmount,
      shippingAddress: orders.shippingAddress,
      createdAt: orders.createdAt,
      user: { id: users.id, name: users.name, email: users.email },
    })
      .from(orders)
      .innerJoin(users, eq(orders.userId, users.id))
      .orderBy(desc(orders.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ value: count() }).from(orders),
  ]);

  return paginate(c, data, Number(total), page, limit);
});

// GET /orders/:id
app.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return badRequest(c, "Invalid ID");

  const [order] = await db.select().from(orders).where(eq(orders.id, id));
  if (!order) return notFound(c, "Order not found");

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

// POST /orders
app.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.userId || !body?.shippingAddress || !body?.items?.length)
    return badRequest(c, "userId, shippingAddress, items are required");

  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, body.userId));
  if (!user) return notFound(c, "User not found");

  let totalAmount = 0;
  const itemsToInsert: { productId: number; quantity: number; unitPrice: string }[] = [];

  for (const item of body.items) {
    const [product] = await db.select().from(products).where(eq(products.id, item.productId));
    if (!product) return notFound(c, `Product ${item.productId} not found`);
    if (product.stock < item.quantity) return badRequest(c, `Insufficient stock for ${product.name}`);

    const price = Number(product.price);
    totalAmount += price * item.quantity;
    itemsToInsert.push({ productId: product.id, quantity: item.quantity, unitPrice: String(price) });

    await db.update(products)
      .set({ stock: product.stock - item.quantity })
      .where(eq(products.id, product.id));
  }

  const [order] = await db.insert(orders).values({
    userId: body.userId,
    totalAmount: String(totalAmount),
    shippingAddress: body.shippingAddress,
    notes: body.notes,
  }).returning();

  await db.insert(orderItems).values(itemsToInsert.map((i) => ({ ...i, orderId: order.id })));

  return created(c, order);
});

// PATCH /orders/:id/status
app.patch("/:id/status", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return badRequest(c, "Invalid ID");

  const body = await c.req.json().catch(() => null);
  if (!body?.status) return badRequest(c, "status is required");

  const [order] = await db.update(orders)
    .set({ status: body.status, updatedAt: new Date() })
    .where(eq(orders.id, id))
    .returning();

  if (!order) return notFound(c, "Order not found");
  return ok(c, order);
});

export default app;
