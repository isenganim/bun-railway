import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { zValidator } from "@hono/zod-validator";
import { eq, ilike, count, desc, and, gte, lte, avg, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { products, reviews, orderItems } from "../db/schema";
import { createProductSchema, updateProductSchema, parsePagination, parseLimit } from "../validators";
import { authMiddleware, requireRole } from "../middleware/auth";
import { ok, created, notFound, badRequest, paginate } from "../lib/response";

const app = new Hono();

// ── Shared schemas ────────────────────────────────────────────────────────────

const ProductSchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  price: z.string(),
  stock: z.number(),
  category: z.enum(["electronics", "clothing", "food", "books", "sports", "home", "beauty", "toys"]),
  imageUrl: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
});

const PaginatedProductsSchema = z.object({
  success: z.literal(true),
  data: z.array(ProductSchema),
  meta: z.object({ total: z.number(), page: z.number(), limit: z.number(), totalPages: z.number() }),
});

const ProductResponseSchema = z.object({ success: z.literal(true), data: ProductSchema });
const ErrorSchema = z.object({ success: z.literal(false), error: z.string() });
const MessageSchema = z.object({ success: z.literal(true), data: z.object({ message: z.string() }) });

// ── GET /products ─────────────────────────────────────────────────────────────

app.get(
  "/",
  describeRoute({
    tags: ["Products"],
    summary: "List products",
    description: "Paginated product list with optional search, category, price range, and sort filters.",
    responses: {
      200: { description: "Paginated products", content: { "application/json": { schema: resolver(PaginatedProductsSchema) } } },
      400: { description: "Invalid parameters", content: { "application/json": { schema: resolver(ErrorSchema) } } },
    },
  }),
  async (c) => {
    const pg = parsePagination(c.req.query("page"), c.req.query("limit"));
    if (!pg) return badRequest(c, "Invalid pagination parameters");

    const search = c.req.query("search");
    const category = c.req.query("category");
    const minPriceRaw = c.req.query("minPrice");
    const maxPriceRaw = c.req.query("maxPrice");
    const sort = c.req.query("sort");

    const conditions = [];
    if (search) conditions.push(ilike(products.name, `%${search}%`));
    if (category) conditions.push(eq(products.category, category as any));

    if (minPriceRaw) {
      const minPrice = Number(minPriceRaw);
      if (isNaN(minPrice) || minPrice < 0) return badRequest(c, "minPrice must be a non-negative number");
      conditions.push(gte(products.price, String(minPrice)));
    }
    if (maxPriceRaw) {
      const maxPrice = Number(maxPriceRaw);
      if (isNaN(maxPrice) || maxPrice < 0) return badRequest(c, "maxPrice must be a non-negative number");
      conditions.push(lte(products.price, String(maxPrice)));
    }

    const where = conditions.length ? and(...conditions) : undefined;

    let orderBy;
    switch (sort) {
      case "price_asc": orderBy = products.price; break;
      case "price_desc": orderBy = desc(products.price); break;
      default: orderBy = desc(products.createdAt);
    }

    const [data, [{ value: total }]] = await Promise.all([
      db.select().from(products).where(where).orderBy(orderBy).limit(pg.limit).offset(pg.offset),
      db.select({ value: count() }).from(products).where(where),
    ]);

    return paginate(c, data, Number(total), pg.page, pg.limit);
  },
);

// ── GET /products/top-rated ───────────────────────────────────────────────────

app.get(
  "/top-rated",
  describeRoute({
    tags: ["Products"],
    summary: "Top rated products",
    description: "Returns products sorted by average review rating.",
    responses: {
      200: { description: "Top rated products" },
      400: { description: "Invalid limit", content: { "application/json": { schema: resolver(ErrorSchema) } } },
    },
  }),
  async (c) => {
    const limit = parseLimit(c.req.query("limit"), 10, 50);
    if (limit === null) return badRequest(c, "limit must be a positive integer");

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
  },
);

// ── GET /products/best-sellers ────────────────────────────────────────────────

app.get(
  "/best-sellers",
  describeRoute({
    tags: ["Products"],
    summary: "Best selling products",
    description: "Returns products sorted by total units sold.",
    responses: {
      200: { description: "Best sellers" },
      400: { description: "Invalid limit", content: { "application/json": { schema: resolver(ErrorSchema) } } },
    },
  }),
  async (c) => {
    const limit = parseLimit(c.req.query("limit"), 10, 50);
    if (limit === null) return badRequest(c, "limit must be a positive integer");

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
  },
);

// ── GET /products/:id ─────────────────────────────────────────────────────────

app.get(
  "/:id",
  describeRoute({
    tags: ["Products"],
    summary: "Get product by ID",
    description: "Returns a product with its latest 10 reviews.",
    responses: {
      200: {
        description: "Product with reviews",
        content: {
          "application/json": {
            schema: resolver(z.object({
              success: z.literal(true),
              data: ProductSchema.extend({
                reviews: z.array(z.object({
                  id: z.number(),
                  userId: z.number(),
                  productId: z.number(),
                  rating: z.number(),
                  comment: z.string().nullable(),
                  createdAt: z.string(),
                })),
              }),
            })),
          },
        },
      },
      400: { description: "Invalid ID", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      404: { description: "Product not found", content: { "application/json": { schema: resolver(ErrorSchema) } } },
    },
  }),
  async (c) => {
    const id = Number(c.req.param("id"));
    if (isNaN(id)) return badRequest(c, "Invalid ID");

    const [product] = await db.select().from(products).where(eq(products.id, id));
    if (!product) return notFound(c, "Product not found");

    const productReviews = await db.select().from(reviews).where(eq(reviews.productId, id)).limit(10);

    return ok(c, { ...product, reviews: productReviews });
  },
);

// ── POST /products ────────────────────────────────────────────────────────────

app.post(
  "/",
  describeRoute({
    tags: ["Products"],
    summary: "Create product",
    description: "Creates a new product. Admin or moderator only.",
    security: [{ bearerAuth: [] }],
    responses: {
      201: { description: "Product created", content: { "application/json": { schema: resolver(ProductResponseSchema) } } },
      400: { description: "Validation error", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      401: { description: "Unauthorized", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      403: { description: "Forbidden", content: { "application/json": { schema: resolver(ErrorSchema) } } },
    },
  }),
  authMiddleware(),
  requireRole("admin", "moderator"),
  zValidator("json", createProductSchema),
  async (c) => {
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
  },
);

// ── PATCH /products/:id ───────────────────────────────────────────────────────

app.patch(
  "/:id",
  describeRoute({
    tags: ["Products"],
    summary: "Update product",
    description: "Updates product fields. Admin or moderator only.",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "Product updated", content: { "application/json": { schema: resolver(ProductResponseSchema) } } },
      400: { description: "Validation error", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      401: { description: "Unauthorized", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      403: { description: "Forbidden", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      404: { description: "Product not found", content: { "application/json": { schema: resolver(ErrorSchema) } } },
    },
  }),
  authMiddleware(),
  requireRole("admin", "moderator"),
  zValidator("json", updateProductSchema),
  async (c) => {
    const id = Number(c.req.param("id"));
    if (isNaN(id)) return badRequest(c, "Invalid ID");

    const body = c.req.valid("json");

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) {
      updateData.name = body.name;
      updateData.slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    }
    if (body.description !== undefined) updateData.description = body.description;
    if (body.price !== undefined) updateData.price = String(body.price);
    if (body.stock !== undefined) updateData.stock = body.stock;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;

    if (Object.keys(updateData).length === 0) return badRequest(c, "No valid fields to update");

    const [product] = await db.update(products)
      .set(updateData)
      .where(eq(products.id, id))
      .returning();

    if (!product) return notFound(c, "Product not found");
    return ok(c, product);
  },
);

// ── DELETE /products/:id ──────────────────────────────────────────────────────

app.delete(
  "/:id",
  describeRoute({
    tags: ["Products"],
    summary: "Delete product",
    description: "Permanently deletes a product. Admin only.",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "Product deleted", content: { "application/json": { schema: resolver(MessageSchema) } } },
      401: { description: "Unauthorized", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      403: { description: "Forbidden", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      404: { description: "Product not found", content: { "application/json": { schema: resolver(ErrorSchema) } } },
    },
  }),
  authMiddleware(),
  requireRole("admin"),
  async (c) => {
    const id = Number(c.req.param("id"));
    if (isNaN(id)) return badRequest(c, "Invalid ID");

    const [product] = await db.delete(products).where(eq(products.id, id)).returning();
    if (!product) return notFound(c, "Product not found");

    return ok(c, { message: "Product deleted" });
  },
);

export default app;
