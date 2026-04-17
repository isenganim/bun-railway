import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, desc, count } from "drizzle-orm";
import { db } from "../db";
import { coupons } from "../db/schema";
import { createCouponSchema } from "../validators";
import { authMiddleware, requireRole } from "../middleware/auth";
import { ok, created, notFound, badRequest, paginate } from "../lib/response";

const app = new Hono();

// GET /coupons
app.get("/", async (c) => {
  const page = Number(c.req.query("page") ?? 1);
  const limit = Math.min(Number(c.req.query("limit") ?? 20), 100);
  const offset = (page - 1) * limit;

  const [data, [{ value: total }]] = await Promise.all([
    db.select().from(coupons).orderBy(desc(coupons.createdAt)).limit(limit).offset(offset),
    db.select({ value: count() }).from(coupons),
  ]);

  return paginate(c, data, Number(total), page, limit);
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

// POST /coupons (admin only)
app.post("/", authMiddleware(), requireRole("admin"), zValidator("json", createCouponSchema), async (c) => {
  const body = c.req.valid("json");

  const [existing] = await db.select({ id: coupons.id }).from(coupons).where(eq(coupons.code, body.code));
  if (existing) return badRequest(c, "Coupon code already exists");

  if (body.discountType === "percentage" && body.discountValue > 100) {
    return badRequest(c, "Percentage discount cannot exceed 100");
  }

  const [coupon] = await db.insert(coupons).values({
    code: body.code,
    discountType: body.discountType,
    discountValue: String(body.discountValue),
    minOrderAmount: String(body.minOrderAmount),
    maxUsage: body.maxUsage,
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
  }).returning();

  return created(c, coupon);
});

// PATCH /coupons/:id (admin only)
app.patch("/:id", authMiddleware(), requireRole("admin"), async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return badRequest(c, "Invalid ID");

  const body = await c.req.json().catch(() => null);
  if (!body) return badRequest(c, "Request body required");

  const updateData: Record<string, unknown> = {};
  if (body.isActive !== undefined) updateData.isActive = body.isActive;
  if (body.maxUsage !== undefined) updateData.maxUsage = body.maxUsage;
  if (body.expiresAt !== undefined) updateData.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;

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
