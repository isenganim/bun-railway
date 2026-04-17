import { Context } from "hono";

export const ok = (c: Context, data: unknown, meta?: Record<string, unknown>) =>
  c.json({ success: true, data, ...meta });

export const created = (c: Context, data: unknown) =>
  c.json({ success: true, data }, 201);

export const notFound = (c: Context, message = "Not found") =>
  c.json({ success: false, error: message }, 404);

export const badRequest = (c: Context, message: string) =>
  c.json({ success: false, error: message }, 400);

export const paginate = (c: Context, data: unknown[], total: number, page: number, limit: number) =>
  ok(c, data, { meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
