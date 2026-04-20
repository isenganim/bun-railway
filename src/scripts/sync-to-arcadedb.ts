import { db } from "../db";
import { users, products, orders, orderItems, reviews } from "../db/schema";
import { eq } from "drizzle-orm";
import { arcadeCommand, arcadeQuery } from "../db/arcadedb";

async function syncToArcadeDB() {
  try {
    console.log("🔄 Syncing data to ArcadeDB...");

    // Ensure vertex/edge types exist
    console.log("  Creating schema types...");
    for (const cmd of [
      "CREATE VERTEX TYPE User IF NOT EXISTS",
      "CREATE VERTEX TYPE Product IF NOT EXISTS",
      "CREATE EDGE TYPE PURCHASED IF NOT EXISTS",
      "CREATE EDGE TYPE REVIEWED IF NOT EXISTS",
    ]) await arcadeCommand("sql", cmd);

    // Clear existing data
    console.log("  Clearing existing graph data...");
    await arcadeCommand("sql", "DELETE FROM PURCHASED");
    await arcadeCommand("sql", "DELETE FROM REVIEWED");
    await arcadeCommand("sql", "DELETE FROM User");
    await arcadeCommand("sql", "DELETE FROM Product");

    // Sync users
    const allUsers = await db.select().from(users);
    console.log(`  Syncing ${allUsers.length} users...`);
    for (const user of allUsers) {
      await arcadeCommand("sql",
        "CREATE VERTEX User SET id = :id, name = :name, email = :email, username = :username, role = :role, status = :status",
        { id: user.id, name: user.name, email: user.email, username: user.username, role: user.role, status: user.status },
      );
    }

    // Sync products
    const allProducts = await db.select().from(products);
    console.log(`  Syncing ${allProducts.length} products...`);
    for (const product of allProducts) {
      await arcadeCommand("sql",
        "CREATE VERTEX Product SET id = :id, name = :name, slug = :slug, price = :price, category = :category, stock = :stock, isActive = :isActive",
        { id: product.id, name: product.name, slug: product.slug, price: Number(product.price), category: product.category, stock: product.stock, isActive: product.isActive },
      );
    }

    // Create indexes
    console.log("  Creating indexes...");
    await arcadeCommand("sql", "CREATE INDEX IF NOT EXISTS ON User (id) UNIQUE").catch(() => {});
    await arcadeCommand("sql", "CREATE INDEX IF NOT EXISTS ON Product (id) UNIQUE").catch(() => {});

    // Sync orders as PURCHASED relationships
    const allOrders = await db.select().from(orders);
    console.log(`  Syncing ${allOrders.length} orders...`);
    for (const order of allOrders) {
      const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
      for (const item of items) {
        await arcadeCommand("opencypher", `
          MATCH (u:User {id: $userId}), (p:Product {id: $productId})
          CREATE (u)-[:PURCHASED {orderId: $orderId, quantity: $quantity, unitPrice: $unitPrice, date: $date}]->(p)
        `, { userId: order.userId, productId: item.productId, orderId: order.id, quantity: item.quantity, unitPrice: Number(item.unitPrice), date: order.createdAt.toISOString() });
      }
    }

    // Sync reviews as REVIEWED relationships
    const allReviews = await db.select().from(reviews);
    console.log(`  Syncing ${allReviews.length} reviews...`);
    for (const review of allReviews) {
      await arcadeCommand("opencypher", `
        MATCH (u:User {id: $userId}), (p:Product {id: $productId})
        CREATE (u)-[:REVIEWED {reviewId: $reviewId, rating: $rating, comment: $comment, date: $date}]->(p)
      `, { userId: review.userId, productId: review.productId, reviewId: review.id, rating: review.rating, comment: review.comment ?? "", date: review.createdAt.toISOString() });
    }

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

syncToArcadeDB();
