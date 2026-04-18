import { z } from "zod";

// Auth
export const registerSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email().max(150),
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_]+$/, "Username must be alphanumeric"),
  password: z.string().min(8).max(128),
  bio: z.string().max(500).optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Users
export const updateUserSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  bio: z.string().max(500).optional(),
  avatar: z.string().url().max(255).optional(),
});

// Products
export const createProductSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  price: z.number().positive(),
  stock: z.number().int().min(0).optional().default(0),
  category: z.enum(["electronics", "clothing", "food", "books", "sports", "home", "beauty", "toys"]),
  imageUrl: z.string().url().max(255).optional(),
});

export const updateProductSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  price: z.number().positive().optional(),
  stock: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

// Orders — userId removed, derived from JWT
export const createOrderSchema = z.object({
  shippingAddress: z.string().min(5),
  notes: z.string().optional(),
  couponCode: z.string().optional(),
  items: z.array(z.object({
    productId: z.number().int().positive(),
    quantity: z.number().int().positive(),
  })).min(1),
});

export const updateOrderStatusSchema = z.object({
  status: z.enum(["pending", "processing", "shipped", "delivered", "cancelled"]),
  trackingNumber: z.string().max(100).optional(),
  carrier: z.string().max(50).optional(),
  estimatedDelivery: z.string().datetime().optional(),
  note: z.string().optional(),
});

// Reviews — userId removed, derived from JWT
export const createReviewSchema = z.object({
  productId: z.number().int().positive(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

// Wishlists
export const wishlistSchema = z.object({
  productId: z.number().int().positive(),
});

// Coupons
export const createCouponSchema = z.object({
  code: z.string().min(3).max(50).toUpperCase(),
  discountType: z.enum(["percentage", "fixed"]),
  discountValue: z.number().positive(),
  minOrderAmount: z.number().min(0).optional().default(0),
  maxUsage: z.number().int().positive().optional(),
  expiresAt: z.string().datetime().optional(),
});

export const updateCouponSchema = z.object({
  isActive: z.boolean().optional(),
  maxUsage: z.number().int().positive().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: "No fields to update" });

// Categories
export const createCategorySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  icon: z.string().max(255).optional(),
  parentId: z.number().int().positive().optional(),
});

export const updateCategorySchema = createCategorySchema.partial().refine(
  (d) => Object.keys(d).length > 0,
  { message: "No fields to update" },
);

// Notifications
export const createNotificationSchema = z.object({
  userId: z.number().int().positive(),
  type: z.enum(["order_status", "review_reply", "promotion", "system"]),
  title: z.string().min(1).max(200),
  message: z.string().min(1),
  metadata: z.string().optional(),
});
