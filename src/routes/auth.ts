import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { users } from "../db/schema";
import { generateToken, hashPassword, verifyPassword, authMiddleware, getCurrentUser } from "../middleware/auth";
import { registerSchema, loginSchema } from "../validators";
import { ok, created, badRequest } from "../lib/response";

const app = new Hono();

// ── Shared response schemas ───────────────────────────────────────────────────

const UserSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string().email(),
  username: z.string(),
  role: z.enum(["admin", "user", "moderator"]),
});

const AuthResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    user: UserSchema,
    token: z.string(),
  }),
});

const MeResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    id: z.number(),
    name: z.string(),
    email: z.string().email(),
    username: z.string(),
    role: z.enum(["admin", "user", "moderator"]),
    status: z.enum(["active", "inactive", "banned"]),
    bio: z.string().nullable(),
    avatar: z.string().nullable(),
    createdAt: z.string(),
  }),
});

const ErrorSchema = z.object({
  success: z.literal(false),
  error: z.string(),
});

// ── POST /auth/register ───────────────────────────────────────────────────────

app.post(
  "/register",
  describeRoute({
    tags: ["Auth"],
    summary: "Register a new user",
    description: "Creates a new user account and returns a JWT token.",
    responses: {
      201: {
        description: "User registered successfully",
        content: { "application/json": { schema: resolver(AuthResponseSchema) } },
      },
      400: {
        description: "Email or username already in use",
        content: { "application/json": { schema: resolver(ErrorSchema) } },
      },
    },
  }),
  zValidator("json", registerSchema),
  async (c) => {
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
      if (err?.code === "23505") {
        const detail = String(err?.detail || err?.message || "");
        const field = detail.includes("email") ? "Email" : "Username";
        return badRequest(c, `${field} already in use`);
      }
      throw err;
    }

    const token = await generateToken({ id: user.id, role: user.role, username: user.username });
    return created(c, { user, token });
  },
);

// ── POST /auth/login ──────────────────────────────────────────────────────────

app.post(
  "/login",
  describeRoute({
    tags: ["Auth"],
    summary: "Login",
    description: "Authenticates a user and returns a JWT token.",
    responses: {
      200: {
        description: "Login successful",
        content: { "application/json": { schema: resolver(AuthResponseSchema) } },
      },
      401: {
        description: "Invalid credentials",
        content: { "application/json": { schema: resolver(ErrorSchema) } },
      },
      403: {
        description: "Account is not active",
        content: { "application/json": { schema: resolver(ErrorSchema) } },
      },
    },
  }),
  zValidator("json", loginSchema),
  async (c) => {
    const body = c.req.valid("json");

    const [user] = await db.select().from(users).where(eq(users.email, body.email));
    if (!user || !user.passwordHash) {
      return c.json({ success: false, error: "Invalid email or password" }, 401);
    }

    const valid = await verifyPassword(body.password, user.passwordHash);
    if (!valid) {
      return c.json({ success: false, error: "Invalid email or password" }, 401);
    }

    if (user.status !== "active") {
      return c.json({ success: false, error: "Account is not active" }, 403);
    }

    const token = await generateToken({ id: user.id, role: user.role, username: user.username });

    return ok(c, {
      user: { id: user.id, name: user.name, email: user.email, username: user.username, role: user.role },
      token,
    });
  },
);

// ── GET /auth/me ──────────────────────────────────────────────────────────────

app.use("/me", authMiddleware());
app.get(
  "/me",
  describeRoute({
    tags: ["Auth"],
    summary: "Get current user",
    description: "Returns the authenticated user's profile. Requires Bearer token.",
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: "Current user profile",
        content: { "application/json": { schema: resolver(MeResponseSchema) } },
      },
      401: {
        description: "Unauthorized",
        content: { "application/json": { schema: resolver(ErrorSchema) } },
      },
    },
  }),
  async (c) => {
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
  },
);

export default app;
