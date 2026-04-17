import { db } from "../db";
import { users, products, orders, orderItems, reviews } from "../db/schema";
import { eq } from "drizzle-orm";
import { getNeo4jDriver, closeNeo4j } from "../db/neo4j";

async function syncToNeo4j() {
  const driver = getNeo4jDriver();
  const session = driver.session();

  try {
    console.log("🔄 Syncing data to Neo4j...");

    // Clear existing data
    console.log("  Clearing existing Neo4j data...");
    await session.run("MATCH (n) DETACH DELETE n");

    // Sync users
    const allUsers = await db.select().from(users);
    console.log(`  Syncing ${allUsers.length} users...`);
    for (const user of allUsers) {
      await session.run(
        `CREATE (u:User {
          id: $id, name: $name, email: $email,
          username: $username, role: $role, status: $status
        })`,
        {
          id: user.id,
          name: user.name,
          email: user.email,
          username: user.username,
          role: user.role,
          status: user.status,
        }
      );
    }

    // Sync products
    const allProducts = await db.select().from(products);
    console.log(`  Syncing ${allProducts.length} products...`);
    for (const product of allProducts) {
      await session.run(
        `CREATE (p:Product {
          id: $id, name: $name, slug: $slug,
          price: $price, category: $category,
          stock: $stock, isActive: $isActive
        })`,
        {
          id: product.id,
          name: product.name,
          slug: product.slug,
          price: Number(product.price),
          category: product.category,
          stock: product.stock,
          isActive: product.isActive,
        }
      );
    }

    // Create indexes for faster lookups
    console.log("  Creating indexes...");
    await session.run("CREATE INDEX user_id IF NOT EXISTS FOR (u:User) ON (u.id)");
    await session.run("CREATE INDEX product_id IF NOT EXISTS FOR (p:Product) ON (p.id)");

    // Sync orders as PURCHASED relationships
    const allOrders = await db.select().from(orders);
    console.log(`  Syncing ${allOrders.length} orders...`);
    for (const order of allOrders) {
      const items = await db
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, order.id));

      for (const item of items) {
        await session.run(
          `MATCH (u:User {id: $userId}), (p:Product {id: $productId})
           CREATE (u)-[:PURCHASED {
             orderId: $orderId, quantity: $quantity,
             unitPrice: $unitPrice, date: $date
           }]->(p)`,
          {
            userId: order.userId,
            productId: item.productId,
            orderId: order.id,
            quantity: item.quantity,
            unitPrice: Number(item.unitPrice),
            date: order.createdAt.toISOString(),
          }
        );
      }
    }

    // Sync reviews as REVIEWED relationships
    const allReviews = await db.select().from(reviews);
    console.log(`  Syncing ${allReviews.length} reviews...`);
    for (const review of allReviews) {
      await session.run(
        `MATCH (u:User {id: $userId}), (p:Product {id: $productId})
         CREATE (u)-[:REVIEWED {
           reviewId: $reviewId, rating: $rating,
           comment: $comment, date: $date
         }]->(p)`,
        {
          userId: review.userId,
          productId: review.productId,
          reviewId: review.id,
          rating: review.rating,
          comment: review.comment ?? "",
          date: review.createdAt.toISOString(),
        }
      );
    }

    console.log("✅ Sync complete!");

    // Print summary
    const summary = await session.run(
      `MATCH (u:User) WITH count(u) AS users
       MATCH (p:Product) WITH users, count(p) AS products
       MATCH ()-[pu:PURCHASED]->() WITH users, products, count(pu) AS purchases
       MATCH ()-[re:REVIEWED]->() 
       RETURN users, products, purchases, count(re) AS reviews`
    );

    if (summary.records.length > 0) {
      const r = summary.records[0];
      console.log(`  Nodes: ${r.get("users")} users, ${r.get("products")} products`);
      console.log(`  Relationships: ${r.get("purchases")} purchases, ${r.get("reviews")} reviews`);
    }
  } catch (error) {
    console.error("❌ Sync failed:", error);
    throw error;
  } finally {
    await session.close();
    await closeNeo4j();
  }
}

syncToNeo4j();
