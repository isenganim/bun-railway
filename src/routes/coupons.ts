import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, desc, count } from "drizzle-orm";
import { db } from "../db";
import { coupons } from "../db/schema";
import { createCouponSchema, updateCouponSchema, parsePagination } from "../validators";
import { authMiddleware, requireRole } from "../middleware/auth";
import { ok, created, notFound, badRequest, paginate } from "../lib/response";

const app = new Hono();

// GET /coupons
app.get("/", async (c) => {
  const pg = parsePagination(c.req.query("page"), c.req.query("limit"));
  if (!pg) return badRequest(c, "Invalid pagination parameters");

  const [data, [{ value: total }]] = await Promise.all([
    db.select().from(coupons).orderBy(desc(coupons.createdAt)).limit(pg.limit).offset(pg.offset),
    db.select({ value: count() }).from(coupons),
  ]);

  return paginate(c, data, Number(total), pg.page, pg.limit);
});

// GET /coupons/validate/:code
app.get("/validate/:code", async (c) => {
  const code = c.req.param("code").toUpperCase();

  const [coupon] = await db.select().from(coupons).where(eq(coupons.code, code));
  if (!coupon) return notFound(c, "Coupon not found");

  const issues: string[] = [];
  if (!coupon.isActive) issues.push("Coupon is inactive");
  if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) issues.push("Coupon has expired");
  if (coupon.maxUsage && coupon.currentUsage >= coupon.maxUsage) issues.push("Usage limit reached");

  return ok(c, {
    code: coupon.code,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
    minOrderAmount: coupon.minOrderAmount,
    isValid: issues.length === 0,
    issues,
  });
});

// POST /coupons (admin only) — catch unique constraint race
app.post("/", authMiddleware(), requireRole("admin"), zValidator("json", createCouponSchema), async (c) => {
  const body = c.req.valid("json");

  if (body.discountType === "percentage" && body.discountValue > 100) {
    return badRequest(c, "Percentage discount cannot exceed 100");
  }

  let coupon;
  try {
    [coupon] = await db.insert(coupons).values({
      code: body.code,
      discountType: body.discountType,
      discountValue: String(body.discountValue),
      minOrderAmount: String(body.minOrderAmount),
      maxUsage: body.maxUsage,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
    }).returning();
  } catch (err: any) {
    if (err?.code === "23505") {
      return badRequest(c, "Coupon code already exists");
    }
    throw err;
  }

  return created(c, coupon);
});

// PATCH /coupons/:id (admin only) — validated with Zod
app.patch("/:id", authMiddleware(), requireRole("admin"), zValidator("json", updateCouponSchema), async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return badRequest(c, "Invalid ID");

  const body = c.req.valid("json");

  const updateData: Record<string, unknown> = {};
  if (body.isActive !== undefined) updateData.isActive = body.isActive;
  if (body.maxUsage !== undefined) updateData.maxUsage = body.maxUsage;
  if (body.expiresAt !== undefined) updateData.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;

  // Validate maxUsage >= currentUsage to avoid DB CHECK violation
  if (body.maxUsage !== undefined && body.maxUsage !== null) {
    const [existing] = await db.select({ currentUsage: coupons.currentUsage }).from(coupons).where(eq(coupons.id, id));
    if (!existing) return notFound(c, "Coupon not found");
    if (body.maxUsage < existing.currentUsage) {
      return badRequest(c, "maxUsage cannot be less than currentUsage");
    }
  }

  const [coupon] = await db.update(coupons)
    .set(updateData)
    .where(eq(coupons.id, id))
    .returning();

  if (!coupon) return notFound(c, "Coupon not found");
  return ok(c, coupon);
});

// DELETE /coupons/:id (admin only)
app.delete("/:id", authMiddleware(), requireRole("admin"), async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return badRequest(c, "Invalid ID");

  const [coupon] = await db.delete(coupons).where(eq(coupons.id, id)).returning();
  if (!coupon) return notFound(c, "Coupon not found");

  return ok(c, { message: "Coupon deleted" });
});

export default app;
