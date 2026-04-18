import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { zValidator } from "@hono/zod-validator";
import { eq, and, count } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { wishlists, products, users } from "../db/schema";
import { wishlistSchema } from "../validators";
import { authMiddleware, requireOwnerOrRole } from "../middleware/auth";
import { ok, created, notFound, badRequest } from "../lib/response";

const app = new Hono();

const extractUserId = (c: any) => Number(c.req.param("userId"));

// ── Shared schemas ────────────────────────────────────────────────────────────

const WishlistItemSchema = z.object({
  id: z.number(),
  createdAt: z.string(),
  product: z.object({
    id: z.number(),
    name: z.string(),
    slug: z.string(),
    price: z.string(),
    category: z.enum(["electronics", "clothing", "food", "books", "sports", "home", "beauty", "toys"]),
    imageUrl: z.string().nullable(),
    isActive: z.boolean(),
  }),
});

const ErrorSchema = z.object({ success: z.literal(false), error: z.string() });
const MessageSchema = z.object({ success: z.literal(true), data: z.object({ message: z.string() }) });

// GET /wishlists/users/:userId — auth required, owner or admin
app.get(
  "/users/:userId",
  describeRoute({
    tags: ["Wishlists"],
    summary: "Get user wishlist",
    description: "Returns all wishlist items for a user with product details. Owner or admin only.",
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: "Wishlist items",
        content: {
          "application/json": {
            schema: resolver(z.object({ success: z.literal(true), data: z.array(WishlistItemSchema) })),
          },
        },
      },
      400: { description: "Invalid user ID", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      401: { description: "Unauthorized", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      403: { description: "Forbidden", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      404: { description: "User not found", content: { "application/json": { schema: resolver(ErrorSchema) } } },
    },
  }),
  authMiddleware(), requireOwnerOrRole(extractUserId, "admin"), async (c) => {
  const userId = Number(c.req.param("userId"));
  if (isNaN(userId)) return badRequest(c, "Invalid user ID");

  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
  if (!user) return notFound(c, "User not found");

  const data = await db.select({
    id: wishlists.id,
    createdAt: wishlists.createdAt,
    product: {
      id: products.id,
      name: products.name,
      slug: products.slug,
      price: products.price,
      category: products.category,
      imageUrl: products.imageUrl,
      isActive: products.isActive,
    },
  })
    .from(wishlists)
    .innerJoin(products, eq(wishlists.productId, products.id))
    .where(eq(wishlists.userId, userId));

  return ok(c, data);
});

// POST /wishlists/users/:userId — auth required, owner or admin, validate user+product
app.post(
  "/users/:userId",
  describeRoute({
    tags: ["Wishlists"],
    summary: "Add to wishlist",
    description: "Adds a product to a user's wishlist. Owner or admin only.",
    security: [{ bearerAuth: [] }],
    responses: {
      201: {
        description: "Item added to wishlist",
        content: {
          "application/json": {
            schema: resolver(z.object({
              success: z.literal(true),
              data: z.object({ id: z.number(), userId: z.number(), productId: z.number(), createdAt: z.string() }),
            })),
          },
        },
      },
      400: { description: "Already in wishlist or invalid input", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      401: { description: "Unauthorized", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      403: { description: "Forbidden", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      404: { description: "User or product not found", content: { "application/json": { schema: resolver(ErrorSchema) } } },
    },
  }),
  authMiddleware(), requireOwnerOrRole(extractUserId, "admin"), zValidator("json", wishlistSchema), async (c) => {
  const userId = Number(c.req.param("userId"));
  if (isNaN(userId)) return badRequest(c, "Invalid user ID");

  const body = c.req.valid("json");

  const [[user], [product]] = await Promise.all([
    db.select({ id: users.id }).from(users).where(eq(users.id, userId)),
    db.select({ id: products.id }).from(products).where(eq(products.id, body.productId)),
  ]);

  if (!user) return notFound(c, "User not found");
  if (!product) return notFound(c, "Product not found");

  const [existing] = await db.select({ id: wishlists.id })
    .from(wishlists)
    .where(and(eq(wishlists.userId, userId), eq(wishlists.productId, body.productId)));

  if (existing) return badRequest(c, "Product already in wishlist");

  const [item] = await db.insert(wishlists).values({
    userId,
    productId: body.productId,
  }).returning();

  return created(c, item);
});

// DELETE /wishlists/users/:userId/products/:productId — auth required, owner or admin
app.delete(
  "/users/:userId/products/:productId",
  describeRoute({
    tags: ["Wishlists"],
    summary: "Remove from wishlist",
    description: "Removes a product from a user's wishlist. Owner or admin only.",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "Item removed from wishlist", content: { "application/json": { schema: resolver(MessageSchema) } } },
      400: { description: "Invalid ID", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      401: { description: "Unauthorized", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      403: { description: "Forbidden", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      404: { description: "Wishlist item not found", content: { "application/json": { schema: resolver(ErrorSchema) } } },
    },
  }),
  authMiddleware(), requireOwnerOrRole(extractUserId, "admin"), async (c) => {
  const userId = Number(c.req.param("userId"));
  const productId = Number(c.req.param("productId"));
  if (isNaN(userId) || isNaN(productId)) return badRequest(c, "Invalid ID");

  const [item] = await db.delete(wishlists)
    .where(and(eq(wishlists.userId, userId), eq(wishlists.productId, productId)))
    .returning();

  if (!item) return notFound(c, "Wishlist item not found");

  return ok(c, { message: "Removed from wishlist" });
});

// GET /wishlists/products/:productId/count — public
app.get(
  "/products/:productId/count",
  describeRoute({
    tags: ["Wishlists"],
    summary: "Get wishlist count for product",
    description: "Returns how many users have wishlisted a product. Public endpoint.",
    responses: {
      200: {
        description: "Wishlist count",
        content: {
          "application/json": {
            schema: resolver(z.object({
              success: z.literal(true),
              data: z.object({ productId: z.number(), wishlistCount: z.number() }),
            })),
          },
        },
      },
      400: { description: "Invalid product ID", content: { "application/json": { schema: resolver(ErrorSchema) } } },
    },
  }),
  async (c) => {
  const productId = Number(c.req.param("productId"));
  if (isNaN(productId)) return badRequest(c, "Invalid product ID");

  const [result] = await db.select({ value: count() })
    .from(wishlists)
    .where(eq(wishlists.productId, productId));

  return ok(c, { productId, wishlistCount: Number(result.value) });
});

export default app;
