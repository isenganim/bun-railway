import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { categories } from "../db/schema";
import { createCategorySchema, updateCategorySchema } from "../validators";
import { authMiddleware, requireRole } from "../middleware/auth";
import { ok, created, notFound, badRequest } from "../lib/response";

const app = new Hono();

// GET /categories
app.get("/", async (c) => {
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
});

// GET /categories/flat
app.get("/flat", async (c) => {
  const data = await db.select({
    id: categories.id,
    name: categories.name,
    slug: categories.slug,
    description: categories.description,
    icon: categories.icon,
    parentId: categories.parentId,
  }).from(categories);

  return ok(c, data);
});

// GET /categories/:id
app.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return badRequest(c, "Invalid ID");

  const [category] = await db.select().from(categories).where(eq(categories.id, id));
  if (!category) return notFound(c, "Category not found");

  const children = await db.select().from(categories).where(eq(categories.parentId, id));

  return ok(c, { ...category, children });
});

// POST /categories (admin only)
app.post("/", authMiddleware(), requireRole("admin"), zValidator("json", createCategorySchema), async (c) => {
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
});

// PATCH /categories/:id (admin only) — validated, cycle detection via ancestor walk
app.patch("/:id", authMiddleware(), requireRole("admin"), zValidator("json", updateCategorySchema), async (c) => {
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

  // Validate parentId — walk ancestor chain to detect cycles
  if (body.parentId !== undefined) {
    if (body.parentId === null) {
      // Allow clearing parent (move to root)
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

  // Check slug uniqueness if name changed
  if (updateData.slug) {
    const [existing] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, updateData.slug as string));
    if (existing && existing.id !== id) return badRequest(c, "Category with this name already exists");
  }

  const [category] = await db.update(categories)
    .set(updateData)
    .where(eq(categories.id, id))
    .returning();

  if (!category) return notFound(c, "Category not found");
  return ok(c, category);
});

// DELETE /categories/:id (admin only)
app.delete("/:id", authMiddleware(), requireRole("admin"), async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return badRequest(c, "Invalid ID");

  const children = await db.select({ id: categories.id }).from(categories).where(eq(categories.parentId, id));
  if (children.length > 0) return badRequest(c, "Cannot delete category with subcategories");

  const [category] = await db.delete(categories).where(eq(categories.id, id)).returning();
  if (!category) return notFound(c, "Category not found");

  return ok(c, { message: "Category deleted" });
});

export default app;
