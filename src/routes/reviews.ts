import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { zValidator } from "@hono/zod-validator";
import { eq, avg, count } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { reviews, users, products } from "../db/schema";
import { createReviewSchema } from "../validators";
import { authMiddleware, requireRole, getCurrentUser } from "../middleware/auth";
import { ok, created, notFound, badRequest } from "../lib/response";
import { syncReviewed, unsyncReviewed } from "../lib/arcadedb-sync";

const app = new Hono();

// ── Shared schemas ────────────────────────────────────────────────────────────

const ReviewSchema = z.object({
  id: z.number(),
  userId: z.number(),
  productId: z.number(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().nullable(),
  createdAt: z.string(),
});

const ErrorSchema = z.object({ success: z.literal(false), error: z.string() });
const MessageSchema = z.object({ success: z.literal(true), data: z.object({ message: z.string() }) });

// ── GET /reviews/product/:productId ──────────────────────────────────────────

app.get(
  "/product/:productId",
  describeRoute({
    tags: ["Reviews"],
    summary: "Get reviews for a product",
    description: "Returns all reviews for a product with average rating stats.",
    responses: {
      200: {
        description: "Reviews with stats",
        content: {
          "application/json": {
            schema: resolver(z.object({
              success: z.literal(true),
              data: z.array(z.object({
                id: z.number(),
                rating: z.number(),
                comment: z.string().nullable(),
                createdAt: z.string(),
                user: z.object({ id: z.number(), name: z.string(), avatar: z.string().nullable() }),
              })),
              stats: z.object({ avgRating: z.string(), totalReviews: z.number() }),
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
  },
);

// ── POST /reviews ─────────────────────────────────────────────────────────────

app.post(
  "/",
  describeRoute({
    tags: ["Reviews"],
    summary: "Create review",
    description: "Submits a review for a product. userId is derived from the JWT token.",
    security: [{ bearerAuth: [] }],
    responses: {
      201: { description: "Review created", content: { "application/json": { schema: resolver(z.object({ success: z.literal(true), data: ReviewSchema })) } } },
      400: { description: "Validation error", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      401: { description: "Unauthorized", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      404: { description: "User or product not found", content: { "application/json": { schema: resolver(ErrorSchema) } } },
    },
  }),
  authMiddleware(),
  zValidator("json", createReviewSchema),
  async (c) => {
    const body = c.req.valid("json");
    const currentUser = getCurrentUser(c);
    if (!currentUser) return c.json({ success: false, error: "Unauthorized" }, 401);

    const userId = currentUser.sub;

    const [[user], [product]] = await Promise.all([
      db.select({ id: users.id, name: users.name, username: users.username }).from(users).where(eq(users.id, userId)),
      db.select({ id: products.id, name: products.name, category: products.category, price: products.price }).from(products).where(eq(products.id, body.productId)),
    ]);

    if (!user) return notFound(c, "User not found");
    if (!product) return notFound(c, "Product not found");

    const [review] = await db.insert(reviews).values({
      userId,
      productId: body.productId,
      rating: body.rating,
      comment: body.comment,
    }).returning();

    // ── ArcadeDB: fire-and-forget sync ──────────────────────────────────────────
    syncReviewed({
      userId,
      userName: user.name,
      username: user.username,
      productId: body.productId,
      productName: product.name,
      productCategory: product.category,
      productPrice: product.price,
      reviewId: review.id,
      rating: body.rating,
      comment: body.comment ?? "",
      date: review.createdAt.toISOString(),
    }).catch(() => {/* already logged inside syncReviewed */});

    return created(c, review);
  },
);

// ── DELETE /reviews/:id ───────────────────────────────────────────────────────

app.delete(
  "/:id",
  describeRoute({
    tags: ["Reviews"],
    summary: "Delete review",
    description: "Deletes a review. Admin or moderator only.",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "Review deleted", content: { "application/json": { schema: resolver(MessageSchema) } } },
      400: { description: "Invalid ID", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      401: { description: "Unauthorized", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      403: { description: "Forbidden", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      404: { description: "Review not found", content: { "application/json": { schema: resolver(ErrorSchema) } } },
    },
  }),
  authMiddleware(),
  requireRole("admin", "moderator"),
  async (c) => {
    const id = Number(c.req.param("id"));
    if (isNaN(id)) return badRequest(c, "Invalid ID");

    const [review] = await db.delete(reviews).where(eq(reviews.id, id)).returning();
    if (!review) return notFound(c, "Review not found");

    // ── ArcadeDB: remove relationship ───────────────────────────────────────────
    unsyncReviewed(review.id).catch(() => {/* already logged inside unsyncReviewed */});

    return ok(c, { message: "Review deleted" });
  },
);

export default app;
