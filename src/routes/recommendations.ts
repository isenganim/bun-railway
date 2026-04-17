import { Hono } from "hono";
import neo4j from "neo4j-driver";
import { getNeo4jDriver } from "../db/neo4j";
import { ok, notFound, badRequest } from "../lib/response";

const app = new Hono();

// GET /recommendations/products/:id
// "Users yang beli product ini juga beli..."
app.get("/products/:id", async (c) => {
  const productId = Number(c.req.param("id"));
  if (isNaN(productId)) return badRequest(c, "Invalid product ID");

  const limit = Math.min(Number(c.req.query("limit") ?? 5), 20);
  const session = getNeo4jDriver().session();

  try {
    const result = await session.run(
      `MATCH (p:Product {id: $productId})<-[:PURCHASED]-(u:User)-[:PURCHASED]->(rec:Product)
       WHERE rec.id <> $productId
       RETURN rec.id AS id, rec.name AS name, rec.category AS category,
              rec.price AS price, count(DISTINCT u) AS score
       ORDER BY score DESC
       LIMIT $limit`,
      { productId, limit: neo4jInt(limit) }
    );

    const recommendations = result.records.map((r) => ({
      id: toNumber(r.get("id")),
      name: r.get("name"),
      category: r.get("category"),
      price: r.get("price"),
      score: toNumber(r.get("score")),
    }));

    return ok(c, recommendations);
  } finally {
    await session.close();
  }
});

// GET /recommendations/users/:id
// "Product recommendations berdasarkan purchase history + review rating tinggi dari similar users"
app.get("/users/:id", async (c) => {
  const userId = Number(c.req.param("id"));
  if (isNaN(userId)) return badRequest(c, "Invalid user ID");

  const limit = Math.min(Number(c.req.query("limit") ?? 5), 20);
  const session = getNeo4jDriver().session();

  try {
    // Check user exists in Neo4j
    const userCheck = await session.run(
      "MATCH (u:User {id: $userId}) RETURN u",
      { userId }
    );
    if (userCheck.records.length === 0) return notFound(c, "User not found");

    const result = await session.run(
      `MATCH (u:User {id: $userId})-[:PURCHASED]->(p:Product)<-[:PURCHASED]-(similar:User)
       MATCH (similar)-[:PURCHASED]->(rec:Product)
       WHERE NOT (u)-[:PURCHASED]->(rec)
       OPTIONAL MATCH (similar)-[rev:REVIEWED]->(rec)
       WITH rec, count(DISTINCT similar) AS commonBuyers, avg(rev.rating) AS avgRating
       RETURN rec.id AS id, rec.name AS name, rec.category AS category,
              rec.price AS price, commonBuyers,
              COALESCE(avgRating, 0) AS avgRating
       ORDER BY commonBuyers DESC, avgRating DESC
       LIMIT $limit`,
      { userId, limit: neo4jInt(limit) }
    );

    const recommendations = result.records.map((r) => ({
      id: toNumber(r.get("id")),
      name: r.get("name"),
      category: r.get("category"),
      price: r.get("price"),
      commonBuyers: toNumber(r.get("commonBuyers")),
      avgRating: Number(Number(r.get("avgRating")).toFixed(1)),
    }));

    return ok(c, recommendations);
  } finally {
    await session.close();
  }
});

// GET /recommendations/trending
// Products paling banyak dibeli + rating tinggi
app.get("/trending", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 10), 50);
  const session = getNeo4jDriver().session();

  try {
    const result = await session.run(
      `MATCH (p:Product)<-[pu:PURCHASED]-()
       OPTIONAL MATCH (p)<-[rev:REVIEWED]-()
       WITH p, count(pu) AS purchases, avg(rev.rating) AS avgRating, count(rev) AS reviewCount
       RETURN p.id AS id, p.name AS name, p.category AS category,
              p.price AS price, purchases, reviewCount,
              COALESCE(avgRating, 0) AS avgRating
       ORDER BY purchases DESC, avgRating DESC
       LIMIT $limit`,
      { limit: neo4jInt(limit) }
    );

    const trending = result.records.map((r) => ({
      id: toNumber(r.get("id")),
      name: r.get("name"),
      category: r.get("category"),
      price: r.get("price"),
      purchases: toNumber(r.get("purchases")),
      reviewCount: toNumber(r.get("reviewCount")),
      avgRating: Number(Number(r.get("avgRating")).toFixed(1)),
    }));

    return ok(c, trending);
  } finally {
    await session.close();
  }
});

// GET /recommendations/similar-users/:id
// Users dengan purchase pattern mirip
app.get("/similar-users/:id", async (c) => {
  const userId = Number(c.req.param("id"));
  if (isNaN(userId)) return badRequest(c, "Invalid user ID");

  const limit = Math.min(Number(c.req.query("limit") ?? 5), 20);
  const session = getNeo4jDriver().session();

  try {
    const result = await session.run(
      `MATCH (u:User {id: $userId})-[:PURCHASED]->(p:Product)<-[:PURCHASED]-(similar:User)
       WHERE similar.id <> $userId
       WITH similar, count(DISTINCT p) AS sharedProducts
       RETURN similar.id AS id, similar.name AS name,
              similar.username AS username, sharedProducts
       ORDER BY sharedProducts DESC
       LIMIT $limit`,
      { userId, limit: neo4jInt(limit) }
    );

    const similarUsers = result.records.map((r) => ({
      id: toNumber(r.get("id")),
      name: r.get("name"),
      username: r.get("username"),
      sharedProducts: toNumber(r.get("sharedProducts")),
    }));

    return ok(c, similarUsers);
  } finally {
    await session.close();
  }
});

// GET /recommendations/graph-stats
// Overview stats dari Neo4j graph
app.get("/graph-stats", async (c) => {
  const session = getNeo4jDriver().session();

  try {
    const result = await session.run(
      `MATCH (u:User) WITH count(u) AS totalUsers
       MATCH (p:Product) WITH totalUsers, count(p) AS totalProducts
       MATCH ()-[pu:PURCHASED]->() WITH totalUsers, totalProducts, count(pu) AS totalPurchases
       MATCH ()-[rev:REVIEWED]->() 
       RETURN totalUsers, totalProducts, totalPurchases, count(rev) AS totalReviews`
    );

    if (result.records.length === 0) {
      return ok(c, { totalUsers: 0, totalProducts: 0, totalPurchases: 0, totalReviews: 0 });
    }

    const r = result.records[0];
    return ok(c, {
      totalUsers: toNumber(r.get("totalUsers")),
      totalProducts: toNumber(r.get("totalProducts")),
      totalPurchases: toNumber(r.get("totalPurchases")),
      totalReviews: toNumber(r.get("totalReviews")),
    });
  } finally {
    await session.close();
  }
});

// Helper: convert Neo4j Integer to JS number
function toNumber(val: unknown): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return val;
  if (typeof val === "object" && val !== null && "toNumber" in val) {
    return (val as { toNumber: () => number }).toNumber();
  }
  return Number(val);
}

// Helper: create Neo4j integer
function neo4jInt(val: number) {
  return neo4j.int(val);
}

export default app;
