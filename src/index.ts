import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { prettyJSON } from "hono/pretty-json";
import { count } from "drizzle-orm";
import { db } from "./db";
import * as schema from "./db/schema";
import { getNeo4jDriver } from "./db/neo4j";
import { rateLimiter } from "./middleware/rate-limit";

// Routes
import authRoute from "./routes/auth";
import usersRoute from "./routes/users";
import productsRoute from "./routes/products";
import ordersRoute from "./routes/orders";
import reviewsRoute from "./routes/reviews";
import recommendationsRoute from "./routes/recommendations";
import wishlistsRoute from "./routes/wishlists";
import couponsRoute from "./routes/coupons";
import categoriesRoute from "./routes/categories";
import notificationsRoute from "./routes/notifications";

const app = new Hono();

// Global middleware
app.use(logger());
app.use(cors());
app.use(prettyJSON());
app.use(rateLimiter({ windowMs: 60 * 1000, max: 100 }));

// Root & health
app.get("/", (c) => c.json({
  message: "Bun + Hono API 🚀",
  version: "2.0.0",
  docs: {
    auth: "/api/v1/auth",
    users: "/api/v1/users",
    products: "/api/v1/products",
    orders: "/api/v1/orders",
    reviews: "/api/v1/reviews",
    wishlists: "/api/v1/wishlists",
    coupons: "/api/v1/coupons",
    categories: "/api/v1/categories",
    notifications: "/api/v1/notifications",
    recommendations: "/api/v1/recommendations",
  },
}));

app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

app.get("/health/db", async (c) => {
  const results: Record<string, { status: string; latency?: string; error?: string }> = {};

  // Check PostgreSQL
  const pgStart = Date.now();
  try {
    await db.select({ count: count() }).from(schema.users);
    results.postgresql = { status: "connected", latency: `${Date.now() - pgStart}ms` };
  } catch (err) {
    results.postgresql = { status: "error", error: err instanceof Error ? err.message : String(err) };
  }

  // Check Neo4j
  const neo4jStart = Date.now();
  try {
    const driver = getNeo4jDriver();
    const session = driver.session();
    const result = await session.run("RETURN 1 AS ok");
    await session.close();
    const ok = result.records[0]?.get("ok");
    results.neo4j = {
      status: ok ? "connected" : "error",
      latency: `${Date.now() - neo4jStart}ms`,
    };
  } catch (err) {
    results.neo4j = { status: "error", latency: `${Date.now() - neo4jStart}ms`, error: err instanceof Error ? err.message : String(err) };
  }

  const allHealthy = Object.values(results).every((r) => r.status === "connected");
  return c.json({ status: allHealthy ? "healthy" : "degraded", services: results }, allHealthy ? 200 : 503);
});

app.get("/stats", async (c) => {
  const [u, p, o, oi, r, w, cp, n] = await Promise.all([
    db.select({ count: count() }).from(schema.users),
    db.select({ count: count() }).from(schema.products),
    db.select({ count: count() }).from(schema.orders),
    db.select({ count: count() }).from(schema.orderItems),
    db.select({ count: count() }).from(schema.reviews),
    db.select({ count: count() }).from(schema.wishlists),
    db.select({ count: count() }).from(schema.coupons),
    db.select({ count: count() }).from(schema.notifications),
  ]);
  return c.json({
    users: u[0].count,
    products: p[0].count,
    orders: o[0].count,
    order_items: oi[0].count,
    reviews: r[0].count,
    wishlists: w[0].count,
    coupons: cp[0].count,
    notifications: n[0].count,
  });
});

// API v1 routes
const v1 = new Hono();
v1.route("/auth", authRoute);
v1.route("/users", usersRoute);
v1.route("/products", productsRoute);
v1.route("/orders", ordersRoute);
v1.route("/reviews", reviewsRoute);
v1.route("/wishlists", wishlistsRoute);
v1.route("/coupons", couponsRoute);
v1.route("/categories", categoriesRoute);
v1.route("/notifications", notificationsRoute);
v1.route("/recommendations", recommendationsRoute);

app.route("/api/v1", v1);

// Backward compatibility: keep old routes working
app.route("/users", usersRoute);
app.route("/products", productsRoute);
app.route("/orders", ordersRoute);
app.route("/reviews", reviewsRoute);
app.route("/recommendations", recommendationsRoute);

app.notFound((c) => c.json({ success: false, error: "Route not found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ success: false, error: "Internal server error" }, 500);
});

const port = Number(process.env.PORT ?? 3000);
console.log(`🚀 Server running on port ${port}`);

export default { port, fetch: app.fetch };
