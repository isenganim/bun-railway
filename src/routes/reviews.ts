import { Hono } from "hono";
import { eq, avg, count } from "drizzle-orm";
import { db } from "../db";
import { reviews, users, products } from "../db/schema";
import { ok, created, notFound, badRequest } from "../lib/response";

const app = new Hono();

// GET /reviews/product/:productId
app.get("/product/:productId", async (c) => {
  const productId = Number(c.req.param("productId"));
  if (isNaN(productId)) return badRequest(c, "Invalid product ID");

  const [stats] = await db.select({
    avgRating: avg(reviews.rating),
    totalReviews: count(),
  }).from(reviews).where(eq(reviews.productId, productId));

  const data = await db.select({
    id: reviews.id,
    rating: reviews.rating,
    comment: reviews.comment,
    createdAt: reviews.createdAt,
    user: { id: users.id, name: users.name, avatar: users.avatar },
  })
    .from(reviews)
    .innerJoin(users, eq(reviews.userId, users.id))
    .where(eq(reviews.productId, productId))
    .orderBy(reviews.createdAt);

  return ok(c, data, {
    stats: { avgRating: Number(stats.avgRating ?? 0).toFixed(1), totalReviews: stats.totalReviews },
  });
});

// POST /reviews
app.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.userId || !body?.productId || !body?.rating)
    return badRequest(c, "userId, productId, rating are required");

  if (body.rating < 1 || body.rating > 5)
    return badRequest(c, "rating must be between 1 and 5");

  const [[user], [product]] = await Promise.all([
    db.select({ id: users.id }).from(users).where(eq(users.id, body.userId)),
    db.select({ id: products.id }).from(products).where(eq(products.id, body.productId)),
  ]);

  if (!user) return notFound(c, "User not found");
  if (!product) return notFound(c, "Product not found");

  const [review] = await db.insert(reviews).values({
    userId: body.userId,
    productId: body.productId,
    rating: body.rating,
    comment: body.comment,
  }).returning();

  return created(c, review);
});

// DELETE /reviews/:id
app.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return badRequest(c, "Invalid ID");

  const [review] = await db.delete(reviews).where(eq(reviews.id, id)).returning();
  if (!review) return notFound(c, "Review not found");

  return ok(c, { message: "Review deleted" });
});

export default app;
