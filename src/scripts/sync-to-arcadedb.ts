import { db } from "../db";
import { users, products, orders, orderItems, reviews } from "../db/schema";
import { arcadeQuery } from "../db/arcadedb";

const ARCADEDB_URL = process.env.ARCADEDB_URL || "http://localhost:2480";
const ARCADEDB_DATABASE = process.env.ARCADEDB_DATABASE || "bun_railway";
const ARCADEDB_USER = process.env.ARCADEDB_USER || "root";
const ARCADEDB_PASSWORD = process.env.ARCADEDB_PASSWORD?.trim() || "playwithdata";
const auth = "Basic " + btoa(`${ARCADEDB_USER}:${ARCADEDB_PASSWORD}`);

const SYNC_TIMEOUT = 120_000;

async function syncCommand(language: string, command: string, params?: Record<string, unknown>) {
  const res = await fetch(`${ARCADEDB_URL}/api/v1/command/${ARCADEDB_DATABASE}`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ language, command, params, retry: 5 }),
    signal: AbortSignal.timeout(SYNC_TIMEOUT),
  });
  if (!res.ok) throw new Error(`ArcadeDB command error: ${res.status} ${await res.text()}`);
  return res.json();
}

const BATCH_SIZE = 200;

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
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

    // Batch insert users via sqlscript + JSON CONTENT
    const allUsers = await db.select().from(users);
    console.log(`  Syncing ${allUsers.length} users...`);
    for (const batch of chunk(allUsers, BATCH_SIZE)) {
      const script = batch.map(u =>
        `CREATE VERTEX User CONTENT ${JSON.stringify({ id: u.id, name: u.name, email: u.email, username: u.username, role: u.role, status: u.status })};`
      ).join("\n");
      await syncCommand("sqlscript", script);
    }

    // Batch insert products via sqlscript + JSON CONTENT
    const allProducts = await db.select().from(products);
    console.log(`  Syncing ${allProducts.length} products...`);
    for (const batch of chunk(allProducts, BATCH_SIZE)) {
      const script = batch.map(p =>
        `CREATE VERTEX Product CONTENT ${JSON.stringify({ id: p.id, name: p.name, slug: p.slug, price: String(p.price), category: p.category, stock: p.stock, isActive: p.isActive })};`
      ).join("\n");
      await syncCommand("sqlscript", script);
    }

    console.log("  Creating indexes...");
    await syncCommand("sql", "CREATE PROPERTY User.id IF NOT EXISTS INTEGER");
    await syncCommand("sql", "CREATE PROPERTY Product.id IF NOT EXISTS INTEGER");
    await syncCommand("sql", "CREATE INDEX IF NOT EXISTS ON User (id) UNIQUE");
    await syncCommand("sql", "CREATE INDEX IF NOT EXISTS ON Product (id) UNIQUE");

    // Build purchase edges
    const allOrderItems = await db.select().from(orderItems);
    const itemsByOrder = new Map<number, typeof allOrderItems>();
    for (const item of allOrderItems) {
      const list = itemsByOrder.get(item.orderId) ?? [];
      list.push(item);
      itemsByOrder.set(item.orderId, list);
    }

    const allOrders = await db.select().from(orders);
    const purchaseEdges: { userId: number; productId: number; orderId: number; quantity: number; unitPrice: number; date: string }[] = [];
    for (const order of allOrders) {
      for (const item of itemsByOrder.get(order.id) ?? []) {
        purchaseEdges.push({ userId: order.userId, productId: item.productId, orderId: order.id, quantity: item.quantity, unitPrice: Number(item.unitPrice), date: order.createdAt.toISOString() });
      }
    }

    console.log(`  Syncing ${purchaseEdges.length} purchase edges (from ${allOrders.length} orders)...`);
    for (const batch of chunk(purchaseEdges, BATCH_SIZE)) {
      const script = batch.map(e =>
        `CREATE EDGE PURCHASED FROM (SELECT FROM User WHERE id = ${e.userId}) TO (SELECT FROM Product WHERE id = ${e.productId}) CONTENT ${JSON.stringify({ orderId: e.orderId, quantity: e.quantity, unitPrice: e.unitPrice, date: e.date })};`
      ).join("\n");
      await syncCommand("sqlscript", script);
    }

    // Batch insert review edges
    const allReviews = await db.select().from(reviews);
    console.log(`  Syncing ${allReviews.length} reviews...`);
    for (const batch of chunk(allReviews, BATCH_SIZE)) {
      const script = batch.map(r =>
        `CREATE EDGE REVIEWED FROM (SELECT FROM User WHERE id = ${r.userId}) TO (SELECT FROM Product WHERE id = ${r.productId}) CONTENT ${JSON.stringify({ reviewId: r.id, rating: r.rating, comment: r.comment ?? "", date: r.createdAt.toISOString() })};`
      ).join("\n");
      await syncCommand("sqlscript", script);
    }

    console.log("✅ Sync complete!");

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
