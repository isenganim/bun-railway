import { Context, Next } from "hono";
import { getConnInfo } from "hono/bun";

interface RateLimitStore {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitStore>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of store) {
    if (now > value.resetAt) {
      store.delete(key);
    }
  }
}, 5 * 60 * 1000);

interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  keyGenerator?: (c: Context) => string;
  skipPaths?: string[];
}

export function rateLimiter(options: RateLimitOptions = {}) {
  const {
    windowMs = 60 * 1000, // 1 minute
    max = 100,
    keyGenerator = (c) => {
      // Use Bun's connInfo for the actual remote address when available,
      // fall back to proxy headers only as a secondary source
      try {
        const info = getConnInfo(c);
        if (info.remote.address) return info.remote.address;
      } catch {}
      // Behind a trusted reverse proxy (Railway, etc.), use forwarded headers
      const forwarded = c.req.header("x-forwarded-for");
      if (forwarded) return forwarded.split(",")[0].trim();
      return c.req.header("x-real-ip") || "unknown";
    },
    skipPaths = ["/health", "/health/db"],
  } = options;

  return async (c: Context, next: Next) => {
    // Skip rate limiting for health checks
    if (skipPaths.includes(c.req.path)) {
      await next();
      return;
    }

    const key = keyGenerator(c);
    const now = Date.now();
    const entry = store.get(key);

    if (!entry || now > entry.resetAt) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      c.header("X-RateLimit-Limit", String(max));
      c.header("X-RateLimit-Remaining", String(max - 1));
      c.header("X-RateLimit-Reset", String(Math.ceil((now + windowMs) / 1000)));
      await next();
      return;
    }

    entry.count++;

    c.header("X-RateLimit-Limit", String(max));
    c.header("X-RateLimit-Remaining", String(Math.max(0, max - entry.count)));
    c.header("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      c.header("Retry-After", String(retryAfter));
      return c.json({ success: false, error: "Too many requests, please try again later" }, 429);
    }

    await next();
  };
}
