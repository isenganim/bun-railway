import { Hono } from "hono";
import { eq, ilike, count, desc, and } from "drizzle-orm";
import { db } from "../db";
import { products, reviews } from "../db/schema";
import { ok, created, notFound, badRequest, paginate } from "../lib/response";

const app = new Hono();

// GET /products
app.get("/", async (c) => {
  const page = Number(c.req.query("page") ?? 1);
  const limit = Math.min(Number(c.req.query("limit") ?? 20), 100);
  const search = c.req.query("search");
  const category = c.req.query("category");
  const offset = (page - 1) * limit;

  const conditions = [];
  if (search) conditions.push(ilike(products.name, `%${search}%`));
  if (category) conditions.push(eq(products.category, category as any));

  const where = conditions.length ? and(...conditions) : undefined;

  const [data, [{ value: total }]] = await Promise.all([
    db.select().from(products).where(where).orderBy(desc(products.createdAt)).limit(limit).offset(offset),
    db.select({ value: count() }).from(products).where(where),
  ]);

  return paginate(c, data, Number(total), page, limit);
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

// POST /products
app.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.name || !body?.price || !body?.category)
    return badRequest(c, "name, price, category are required");

  const slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  const [product] = await db.insert(products).values({
    name: body.name,
    slug,
    description: body.description,
    price: String(body.price),
    stock: body.stock ?? 0,
    category: body.category,
    imageUrl: body.imageUrl,
  }).returning();

  return created(c, product);
});

// PATCH /products/:id
app.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return badRequest(c, "Invalid ID");

  const body = await c.req.json().catch(() => null);
  if (!body) return badRequest(c, "Request body required");

  const [product] = await db.update(products)
    .set({
      name: body.name,
      description: body.description,
      price: body.price ? String(body.price) : undefined,
      stock: body.stock,
      isActive: body.isActive,
    })
    .where(eq(products.id, id))
    .returning();

  if (!product) return notFound(c, "Product not found");
  return ok(c, product);
});

// DELETE /products/:id
app.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return badRequest(c, "Invalid ID");

  const [product] = await db.delete(products).where(eq(products.id, id)).returning();
  if (!product) return notFound(c, "Product not found");

  return ok(c, { message: "Product deleted" });
});

export default app;
