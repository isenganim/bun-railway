import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, and, count } from "drizzle-orm";
import { db } from "../db";
import { wishlists, products, users } from "../db/schema";
import { wishlistSchema } from "../validators";
import { ok, created, notFound, badRequest } from "../lib/response";

const app = new Hono();

// GET /wishlists/users/:userId
app.get("/users/:userId", async (c) => {
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

// POST /wishlists/users/:userId
app.post("/users/:userId", zValidator("json", wishlistSchema), async (c) => {
  const userId = Number(c.req.param("userId"));
  if (isNaN(userId)) return badRequest(c, "Invalid user ID");

  const body = c.req.valid("json");

  const [[user], [product]] = await Promise.all([
    db.select({ id: users.id }).from(users).where(eq(users.id, userId)),
    db.select({ id: products.id }).from(products).where(eq(products.id, body.productId)),
  ]);

  if (!user) return notFound(c, "User not found");
  if (!product) return notFound(c, "Product not found");

  // Check if already in wishlist
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

// DELETE /wishlists/users/:userId/products/:productId
app.delete("/users/:userId/products/:productId", async (c) => {
  const userId = Number(c.req.param("userId"));
  const productId = Number(c.req.param("productId"));
  if (isNaN(userId) || isNaN(productId)) return badRequest(c, "Invalid ID");

  const [item] = await db.delete(wishlists)
    .where(and(eq(wishlists.userId, userId), eq(wishlists.productId, productId)))
    .returning();

  if (!item) return notFound(c, "Wishlist item not found");

  return ok(c, { message: "Removed from wishlist" });
});

// GET /wishlists/products/:productId/count
app.get("/products/:productId/count", async (c) => {
  const productId = Number(c.req.param("productId"));
  if (isNaN(productId)) return badRequest(c, "Invalid product ID");

  const [result] = await db.select({ value: count() })
    .from(wishlists)
    .where(eq(wishlists.productId, productId));

  return ok(c, { productId, wishlistCount: Number(result.value) });
});

export default app;
