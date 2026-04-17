import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, ilike, count, desc, and, gte, lte, avg, sql } from "drizzle-orm";
import { db } from "../db";
import { products, reviews, orderItems } from "../db/schema";
import { createProductSchema, updateProductSchema } from "../validators";
import { authMiddleware, requireRole } from "../middleware/auth";
import { ok, created, notFound, badRequest, paginate } from "../lib/response";

const app = new Hono();

// GET /products
app.get("/", async (c) => {
  const page = Number(c.req.query("page") ?? 1);
  const limit = Math.min(Number(c.req.query("limit") ?? 20), 100);
  const search = c.req.query("search");
  const category = c.req.query("category");
  const minPrice = c.req.query("minPrice");
  const maxPrice = c.req.query("maxPrice");
  const sort = c.req.query("sort"); // price_asc, price_desc, newest, rating
  const offset = (page - 1) * limit;

  const conditions = [];
  if (search) conditions.push(ilike(products.name, `%${search}%`));
  if (category) conditions.push(eq(products.category, category as any));
  if (minPrice) conditions.push(gte(products.price, minPrice));
  if (maxPrice) conditions.push(lte(products.price, maxPrice));

  const where = conditions.length ? and(...conditions) : undefined;

  let orderBy;
  switch (sort) {
    case "price_asc": orderBy = products.price; break;
    case "price_desc": orderBy = desc(products.price); break;
    case "newest": orderBy = desc(products.createdAt); break;
    default: orderBy = desc(products.createdAt);
  }

  const [data, [{ value: total }]] = await Promise.all([
    db.select().from(products).where(where).orderBy(orderBy).limit(limit).offset(offset),
    db.select({ value: count() }).from(products).where(where),
  ]);

  return paginate(c, data, Number(total), page, limit);
});

// GET /products/top-rated
app.get("/top-rated", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 10), 50);

  const data = await db.select({
    id: products.id,
    name: products.name,
    slug: products.slug,
    price: products.price,
    category: products.category,
    imageUrl: products.imageUrl,
    avgRating: avg(reviews.rating),
    reviewCount: count(reviews.id),
  })
    .from(products)
    .innerJoin(reviews, eq(products.id, reviews.productId))
    .where(eq(products.isActive, true))
    .groupBy(products.id)
    .orderBy(desc(avg(reviews.rating)))
    .limit(limit);

  return ok(c, data);
});

// GET /products/best-sellers
app.get("/best-sellers", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 10), 50);

  const data = await db.select({
    id: products.id,
    name: products.name,
    slug: products.slug,
    price: products.price,
    category: products.category,
    imageUrl: products.imageUrl,
    totalSold: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)::int`,
  })
    .from(products)
    .innerJoin(orderItems, eq(products.id, orderItems.productId))
    .where(eq(products.isActive, true))
    .groupBy(products.id)
    .orderBy(desc(sql`SUM(${orderItems.quantity})`))
    .limit(limit);

  return ok(c, data);
});

// GET /products/:id
app.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return badRequest(c, "Invalid ID");

  const [product] = await db.select().from(products).where(eq(products.id, id));
  if (!product) return notFound(c, "Product not found");

  const productReviews = await db.select().from(reviews).where(eq(reviews.productId, id)).limit(10);

  return ok(c, { ...product, reviews: productReviews });
});

// POST /products (admin/moderator only)
app.post("/", authMiddleware(), requireRole("admin", "moderator"), zValidator("json", createProductSchema), async (c) => {
  const body = c.req.valid("json");
  const slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  const [product] = await db.insert(products).values({
    name: body.name,
    slug,
    description: body.description,
    price: String(body.price),
    stock: body.stock,
    category: body.category,
    imageUrl: body.imageUrl,
  }).returning();

  return created(c, product);
});

// PATCH /products/:id (admin/moderator only)
app.patch("/:id", authMiddleware(), requireRole("admin", "moderator"), zValidator("json", updateProductSchema), async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return badRequest(c, "Invalid ID");

  const body = c.req.valid("json");

  const updateData: Record<string, unknown> = {};
  if (body.name !== undefined) updateData.name = body.name;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.price !== undefined) updateData.price = String(body.price);
  if (body.stock !== undefined) updateData.stock = body.stock;
  if (body.isActive !== undefined) updateData.isActive = body.isActive;

  const [product] = await db.update(products)
    .set(updateData)
    .where(eq(products.id, id))
    .returning();

  if (!product) return notFound(c, "Product not found");
  return ok(c, product);
});

// DELETE /products/:id (admin only)
app.delete("/:id", authMiddleware(), requireRole("admin"), async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return badRequest(c, "Invalid ID");

  const [product] = await db.delete(products).where(eq(products.id, id)).returning();
  if (!product) return notFound(c, "Product not found");

  return ok(c, { message: "Product deleted" });
});

export default app;
