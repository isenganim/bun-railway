import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { prettyJSON } from "hono/pretty-json";
import usersRoute from "./routes/users";
import productsRoute from "./routes/products";
import ordersRoute from "./routes/orders";
import reviewsRoute from "./routes/reviews";

const app = new Hono();

app.use(logger());
app.use(cors());
app.use(prettyJSON());

app.get("/", (c) => c.json({ message: "Bun + Hono API 🚀", version: "1.0.0" }));
app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

app.route("/users", usersRoute);
app.route("/products", productsRoute);
app.route("/orders", ordersRoute);
app.route("/reviews", reviewsRoute);

app.notFound((c) => c.json({ success: false, error: "Route not found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ success: false, error: "Internal server error" }, 500);
});

const port = Number(process.env.PORT ?? 3000);
console.log(`🚀 Server running on port ${port}`);

export default { port, fetch: app.fetch };
