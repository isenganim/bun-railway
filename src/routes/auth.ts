import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users } from "../db/schema";
import { generateToken, hashPassword, verifyPassword, authMiddleware, getCurrentUser } from "../middleware/auth";
import { registerSchema, loginSchema } from "../validators";
import { ok, created, badRequest } from "../lib/response";

const app = new Hono();

// POST /auth/register — catch DB unique constraint instead of TOCTOU
app.post("/register", zValidator("json", registerSchema), async (c) => {
  const body = c.req.valid("json");

  const passwordHash = await hashPassword(body.password);

  let user;
  try {
    [user] = await db.insert(users).values({
      name: body.name,
      email: body.email,
      username: body.username,
      passwordHash,
      bio: body.bio,
    }).returning({
      id: users.id,
      name: users.name,
      email: users.email,
      username: users.username,
      role: users.role,
    });
  } catch (err: any) {
    // Postgres unique_violation
    if (err?.code === "23505") {
      const detail = String(err?.detail || err?.message || "");
      const field = detail.includes("email") ? "Email" : "Username";
      return badRequest(c, `${field} already in use`);
    }
    throw err;
  }

  const token = await generateToken({ id: user.id, role: user.role, username: user.username });

  return created(c, { user, token });
});

// POST /auth/login
app.post("/login", zValidator("json", loginSchema), async (c) => {
  const body = c.req.valid("json");

  const [user] = await db.select().from(users).where(eq(users.email, body.email));
  if (!user || !user.passwordHash) {
    return c.json({ success: false, error: "Invalid email or password" }, 401);
  }

  if (user.status === "banned") {
    return c.json({ success: false, error: "Account is banned" }, 403);
  }

  const valid = await verifyPassword(body.password, user.passwordHash);
  if (!valid) {
    return c.json({ success: false, error: "Invalid email or password" }, 401);
  }

  const token = await generateToken({ id: user.id, role: user.role, username: user.username });

  return ok(c, {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      role: user.role,
    },
    token,
  });
});

// GET /auth/me (protected)
app.use("/me", authMiddleware());
app.get("/me", async (c) => {
  const payload = getCurrentUser(c);
  if (!payload) return c.json({ success: false, error: "Unauthorized" }, 401);

  const [user] = await db.select({
    id: users.id,
    name: users.name,
    email: users.email,
    username: users.username,
    role: users.role,
    status: users.status,
    bio: users.bio,
    avatar: users.avatar,
    createdAt: users.createdAt,
  }).from(users).where(eq(users.id, payload.sub));

  if (!user) return c.json({ success: false, error: "User not found" }, 404);

  return ok(c, user);
});

export default app;
