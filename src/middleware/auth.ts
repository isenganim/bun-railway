import { Context, Next } from "hono";
import { jwt } from "hono/jwt";
import { sign, verify } from "hono/jwt";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users } from "../db/schema";

const _jwtSecret = process.env.JWT_SECRET;
if (!_jwtSecret || _jwtSecret.length < 32) {
  throw new Error("JWT_SECRET must be set to a strong secret (>=32 chars)");
}
const JWT_SECRET: string = _jwtSecret;

const TOKEN_EXPIRY = 60 * 60 * 24; // 24 hours

export interface JwtPayload {
  sub: number;
  role: string;
  username: string;
  exp: number;
  [key: string]: unknown;
}

export async function generateToken(user: { id: number; role: string; username: string }): Promise<string> {
  const payload: JwtPayload = {
    sub: user.id,
    role: user.role,
    username: user.username,
    exp: Math.floor(Date.now() / 1000) + TOKEN_EXPIRY,
  };
  return await sign(payload, JWT_SECRET, "HS256");
}

export async function verifyToken(token: string): Promise<JwtPayload> {
  return (await verify(token, JWT_SECRET, "HS256")) as unknown as JwtPayload;
}

export function authMiddleware() {
  return jwt({ secret: JWT_SECRET, alg: "HS256" });
}

export function requireRole(...roles: string[]) {
  return async (c: Context, next: Next) => {
    const payload = c.get("jwtPayload") as JwtPayload | undefined;
    if (!payload) {
      return c.json({ success: false, error: "Authentication required" }, 401);
    }
    if (!roles.includes(payload.role)) {
      return c.json({ success: false, error: "Insufficient permissions" }, 403);
    }
    await next();
  };
}

export function requireOwnerOrRole(userIdExtractor: (c: Context) => number, ...roles: string[]) {
  return async (c: Context, next: Next) => {
    const payload = c.get("jwtPayload") as JwtPayload | undefined;
    if (!payload) {
      return c.json({ success: false, error: "Authentication required" }, 401);
    }
    const targetUserId = userIdExtractor(c);
    if (payload.sub !== targetUserId && !roles.includes(payload.role)) {
      return c.json({ success: false, error: "Forbidden" }, 403);
    }
    await next();
  };
}

export function getCurrentUser(c: Context): JwtPayload | null {
  return (c.get("jwtPayload") as JwtPayload) ?? null;
}

export async function hashPassword(password: string): Promise<string> {
  return await Bun.password.hash(password, { algorithm: "bcrypt", cost: 10 });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return await Bun.password.verify(password, hash);
}
