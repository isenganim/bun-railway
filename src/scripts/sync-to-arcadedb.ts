import { db } from "../db";
import { users, products, orders, orderItems, reviews } from "../db/schema";
import { arcadeQuery } from "../db/arcadedb";

const ARCADEDB_URL = process.env.ARCADEDB_URL || "http://localhost:2480";
const ARCADEDB_DATABASE = process.env.ARCADEDB_DATABASE || "bun_railway";
const ARCADEDB_USER = process.env.ARCADEDB_USER || "root";
const ARCADEDB_PASSWORD = process.env.ARCADEDB_PASSWORD?.trim() || "playwithdata";
const auth = "Basic " + btoa(`${ARCADEDB_USER}:${ARCADEDB_PASSWORD}`);

const SYNC_TIMEOUT = 120_000; // 2 minutes for bulk ops

async function syncCommand(language: string, command: string, params?: Record<string, unknown>) {
  const res = await fetch(`${ARCADEDB_URL}/api/v1/command/${ARCADEDB_DATABASE}`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ language, command, params }),
    signal: AbortSignal.timeout(SYNC_TIMEOUT),
  });
  if (!res.ok) throw new Error(`ArcadeDB command error: ${res.status} ${await res.text()}`);
  return res.json();
}

const BATCH_SIZE = 50;

async function runInBatches<T>(items: T[], fn: (item: T) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    await Promise.all(items.slice(i, i + BATCH_SIZE).map(fn));
  }
}

async function syncToArcadeDB() {
  try {
    console.log("🔄 Syncing data to ArcadeDB...");

    console.log("  Creating schema types...");
    for (const cmd of [
      "CREATE VERTEX TYPE User IF NOT EXISTS",
      "CREATE VERTEX TYPE Product IF NOT EXISTS",
      "CREATE EDGE TYPE PURCHASED IF NOT EXISTS",
      "CREATE EDGE TYPE REVIEWED IF NOT EXISTS",
    ]) await syncCommand("sql", cmd);

    console.log("  Clearing existing graph data...");
    await syncCommand("sql", "DELETE FROM PURCHASED");
    await syncCommand("sql", "DELETE FROM REVIEWED");
    await syncCommand("sql", "DELETE FROM User");
    await syncCommand("sql", "DELETE FROM Product");

    const allUsers = await db.select().from(users);
    console.log(`  Syncing ${allUsers.length} users...`);
    await runInBatches(allUsers, (user) =>
      syncCommand("sql",
        "CREATE VERTEX User SET id = :id, name = :name, email = :email, username = :username, role = :role, status = :status",
        { id: user.id, name: user.name, email: user.email, username: user.username, role: user.role, status: user.status },
      ),
    );

    const allProducts = await db.select().from(products);
    console.log(`  Syncing ${allProducts.length} products...`);
    await runInBatches(allProducts, (product) =>
      syncCommand("sql",
        "CREATE VERTEX Product SET id = :id, name = :name, slug = :slug, price = :price, category = :category, stock = :stock, isActive = :isActive",
        { id: product.id, name: product.name, slug: product.slug, price: String(product.price), category: product.category, stock: product.stock, isActive: product.isActive },
      ),
    );

    console.log("  Creating indexes...");
    await syncCommand("sql", "CREATE PROPERTY User.id IF NOT EXISTS INTEGER");
    await syncCommand("sql", "CREATE PROPERTY Product.id IF NOT EXISTS INTEGER");
    await syncCommand("sql", "CREATE INDEX IF NOT EXISTS ON User (id) UNIQUE");
    await syncCommand("sql", "CREATE INDEX IF NOT EXISTS ON Product (id) UNIQUE");

    const allOrderItems = await db.select().from(orderItems);
    const itemsByOrder = new Map<number, typeof allOrderItems>();
    for (const item of allOrderItems) {
      const list = itemsByOrder.get(item.orderId) ?? [];
      list.push(item);
      itemsByOrder.set(item.orderId, list);
    }

    // Build flat list of purchase edges
    const allOrders = await db.select().from(orders);
    const purchaseEdges: { userId: number; productId: number; orderId: number; quantity: number; unitPrice: number; date: string }[] = [];
    for (const order of allOrders) {
      for (const item of itemsByOrder.get(order.id) ?? []) {
        purchaseEdges.push({ userId: order.userId, productId: item.productId, orderId: order.id, quantity: item.quantity, unitPrice: Number(item.unitPrice), date: order.createdAt.toISOString() });
      }
    }
    console.log(`  Syncing ${purchaseEdges.length} purchase edges (from ${allOrders.length} orders)...`);
    await runInBatches(purchaseEdges, (e) =>
      syncCommand("opencypher", `
        MATCH (u:User {id: $userId}), (p:Product {id: $productId})
        CREATE (u)-[:PURCHASED {orderId: $orderId, quantity: $quantity, unitPrice: $unitPrice, date: $date}]->(p)
      `, e),
    );

    const allReviews = await db.select().from(reviews);
    console.log(`  Syncing ${allReviews.length} reviews...`);
    await runInBatches(allReviews, (review) =>
      syncCommand("opencypher", `
        MATCH (u:User {id: $userId}), (p:Product {id: $productId})
        CREATE (u)-[:REVIEWED {reviewId: $reviewId, rating: $rating, comment: $comment, date: $date}]->(p)
      `, { userId: review.userId, productId: review.productId, reviewId: review.id, rating: review.rating, comment: review.comment ?? "", date: review.createdAt.toISOString() }),
    );

    console.log("✅ Sync complete!");

    // Print summary
    const { result } = await arcadeQuery("opencypher", `
      MATCH (u:User) WITH count(u) AS users
      MATCH (p:Product) WITH users, count(p) AS products
      MATCH ()-[pu:PURCHASED]->() WITH users, products, count(pu) AS purchases
      MATCH ()-[re:REVIEWED]->()
      RETURN users, products, purchases, count(re) AS reviews
    `);
    if (result.length > 0) {
      const r: any = result[0];
      console.log(`  Nodes: ${r.users} users, ${r.products} products`);
      console.log(`  Relationships: ${r.purchases} purchases, ${r.reviews} reviews`);
    }
  } catch (error) {
    console.error("❌ Sync failed:", error);
    throw error;
  }
}

syncToArcadeDB()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
