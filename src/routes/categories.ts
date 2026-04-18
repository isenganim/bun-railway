import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { categories } from "../db/schema";
import { createCategorySchema, updateCategorySchema } from "../validators";
import { authMiddleware, requireRole } from "../middleware/auth";
import { ok, created, notFound, badRequest } from "../lib/response";

const app = new Hono();

// ── Shared schemas ────────────────────────────────────────────────────────────

const CategorySchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  parentId: z.number().nullable(),
  createdAt: z.string(),
});

// CategorySchema extended with children for tree/single endpoints
const CategoryWithChildrenSchema: z.ZodType<any> = z.lazy(() =>
  CategorySchema.extend({ children: z.array(CategoryWithChildrenSchema) }),
);

const ErrorSchema = z.object({ success: z.literal(false), error: z.string() });
const MessageSchema = z.object({ success: z.literal(true), data: z.object({ message: z.string() }) });

// ── GET /categories ───────────────────────────────────────────────────────────

app.get(
  "/",
  describeRoute({
    tags: ["Categories"],
    summary: "List categories (tree)",
    description: "Returns all categories as a nested tree structure.",
    responses: {
      200: {
        description: "Category tree",
        content: {
          "application/json": {
            schema: resolver(z.object({ success: z.literal(true), data: z.array(CategoryWithChildrenSchema) })),
          },
        },
      },
    },
  }),
  async (c) => {
    const data = await db.select().from(categories);

    const categoryMap = new Map<number, any>();
    const roots: any[] = [];

    for (const cat of data) {
      categoryMap.set(cat.id, { ...cat, children: [] });
    }

    for (const cat of data) {
      const node = categoryMap.get(cat.id)!;
      if (cat.parentId && categoryMap.has(cat.parentId)) {
        categoryMap.get(cat.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return ok(c, roots);
  },
);

// ── GET /categories/flat ──────────────────────────────────────────────────────

app.get(
  "/flat",
  describeRoute({
    tags: ["Categories"],
    summary: "List categories (flat)",
    description: "Returns all categories as a flat list without nesting.",
    responses: {
      200: {
        description: "Flat category list",
        content: {
          "application/json": {
            schema: resolver(z.object({ success: z.literal(true), data: z.array(CategorySchema) })),
          },
        },
      },
    },
  }),
  async (c) => {
    const data = await db.select({
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
      description: categories.description,
      icon: categories.icon,
      parentId: categories.parentId,
    }).from(categories);

    return ok(c, data);
  },
);

// ── GET /categories/:id ───────────────────────────────────────────────────────

app.get(
  "/:id",
  describeRoute({
    tags: ["Categories"],
    summary: "Get category by ID",
    description: "Returns a category with its direct children.",
    responses: {
      200: { description: "Category with children", content: { "application/json": { schema: resolver(z.object({ success: z.literal(true), data: CategoryWithChildrenSchema })) } } },
      404: { description: "Category not found", content: { "application/json": { schema: resolver(ErrorSchema) } } },
    },
  }),
  async (c) => {
    const id = Number(c.req.param("id"));
    if (isNaN(id)) return badRequest(c, "Invalid ID");

    const [category] = await db.select().from(categories).where(eq(categories.id, id));
    if (!category) return notFound(c, "Category not found");

    const children = await db.select().from(categories).where(eq(categories.parentId, id));

    return ok(c, { ...category, children });
  },
);

// ── POST /categories ──────────────────────────────────────────────────────────

app.post(
  "/",
  describeRoute({
    tags: ["Categories"],
    summary: "Create category",
    description: "Creates a new category. Admin only.",
    security: [{ bearerAuth: [] }],
    responses: {
      201: { description: "Category created", content: { "application/json": { schema: resolver(z.object({ success: z.literal(true), data: CategorySchema })) } } },
      400: { description: "Validation error or duplicate name", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      401: { description: "Unauthorized", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      403: { description: "Forbidden", content: { "application/json": { schema: resolver(ErrorSchema) } } },
    },
  }),
  authMiddleware(),
  requireRole("admin"),
  zValidator("json", createCategorySchema),
  async (c) => {
    const body = c.req.valid("json");
    const slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

    if (body.parentId) {
      const [parent] = await db.select({ id: categories.id }).from(categories).where(eq(categories.id, body.parentId));
      if (!parent) return notFound(c, "Parent category not found");
    }

    const [existing] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug));
    if (existing) return badRequest(c, "Category with this name already exists");

    const [category] = await db.insert(categories).values({
      name: body.name,
      slug,
      description: body.description,
      icon: body.icon,
      parentId: body.parentId,
    }).returning();

    return created(c, category);
  },
);

// ── PATCH /categories/:id ─────────────────────────────────────────────────────

app.patch(
  "/:id",
  describeRoute({
    tags: ["Categories"],
    summary: "Update category",
    description: "Updates a category. Detects circular parent references. Admin only.",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "Category updated", content: { "application/json": { schema: resolver(z.object({ success: z.literal(true), data: CategorySchema })) } } },
      400: { description: "Validation error or circular reference", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      401: { description: "Unauthorized", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      403: { description: "Forbidden", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      404: { description: "Category not found", content: { "application/json": { schema: resolver(ErrorSchema) } } },
    },
  }),
  authMiddleware(),
  requireRole("admin"),
  zValidator("json", updateCategorySchema),
  async (c) => {
    const id = Number(c.req.param("id"));
    if (isNaN(id)) return badRequest(c, "Invalid ID");

    const body = c.req.valid("json");
    const updateData: Record<string, unknown> = {};

    if (body.name) {
      updateData.name = body.name;
      updateData.slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    }
    if (body.description !== undefined) updateData.description = body.description;
    if (body.icon !== undefined) updateData.icon = body.icon;

    if (body.parentId !== undefined) {
      if (body.parentId === null) {
        updateData.parentId = null;
      } else {
        let currentParentId: number | null = body.parentId;
        while (currentParentId) {
          if (currentParentId === id) return badRequest(c, "Category cannot be moved under its own descendant");
          const [ancestor] = await db
            .select({ id: categories.id, parentId: categories.parentId })
            .from(categories)
            .where(eq(categories.id, currentParentId));
          if (!ancestor) return notFound(c, "Parent category not found");
          currentParentId = ancestor.parentId;
        }
        updateData.parentId = body.parentId;
      }
    }

    if (updateData.slug) {
      const [existing] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, updateData.slug as string));
      if (existing && existing.id !== id) return badRequest(c, "Category with this name already exists");
    }

    const [category] = await db.update(categories).set(updateData).where(eq(categories.id, id)).returning();

    if (!category) return notFound(c, "Category not found");
    return ok(c, category);
  },
);

// ── DELETE /categories/:id ────────────────────────────────────────────────────

app.delete(
  "/:id",
  describeRoute({
    tags: ["Categories"],
    summary: "Delete category",
    description: "Deletes a category. Fails if it has subcategories. Admin only.",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "Category deleted", content: { "application/json": { schema: resolver(MessageSchema) } } },
      400: { description: "Category has subcategories", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      401: { description: "Unauthorized", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      403: { description: "Forbidden", content: { "application/json": { schema: resolver(ErrorSchema) } } },
      404: { description: "Category not found", content: { "application/json": { schema: resolver(ErrorSchema) } } },
    },
  }),
  authMiddleware(),
  requireRole("admin"),
  async (c) => {
    const id = Number(c.req.param("id"));
    if (isNaN(id)) return badRequest(c, "Invalid ID");

    const children = await db.select({ id: categories.id }).from(categories).where(eq(categories.parentId, id));
    if (children.length > 0) return badRequest(c, "Cannot delete category with subcategories");

    const [category] = await db.delete(categories).where(eq(categories.id, id)).returning();
    if (!category) return notFound(c, "Category not found");

    return ok(c, { message: "Category deleted" });
  },
);

export default app;
