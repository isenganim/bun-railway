import neo4j from "neo4j-driver";
import { getNeo4jDriver } from "../db/neo4j";

/**
 * Fire-and-forget helper: write a PURCHASED relationship to Neo4j.
 * Ensures the User and Product nodes exist (MERGE) with properties, then creates the edge.
 * Never throws — Neo4j errors are logged but don't affect the caller.
 */
export async function syncPurchased(opts: {
  userId: number;
  userName?: string;
  username?: string;
  productId: number;
  productName?: string;
  productCategory?: string;
  productPrice?: string;
  orderId: number;
  quantity: number;
  unitPrice: number;
  date: string;
}): Promise<void> {
  try {
    const session = getNeo4jDriver().session();
    try {
      await session.run(
        `MERGE (u:User {id: $userId})
         ON CREATE SET u.name = $userName, u.username = $username
         MERGE (p:Product {id: $productId})
         ON CREATE SET p.name = $productName, p.category = $productCategory, p.price = $productPrice
         CREATE (u)-[:PURCHASED {
           orderId: $orderId,
           quantity: $quantity,
           unitPrice: $unitPrice,
           date: $date
         }]->(p)`,
        {
          userId: opts.userId,
          userName: opts.userName ?? null,
          username: opts.username ?? null,
          productId: opts.productId,
          productName: opts.productName ?? null,
          productCategory: opts.productCategory ?? null,
          productPrice: opts.productPrice ?? null,
          orderId: opts.orderId,
          quantity: opts.quantity,
          unitPrice: opts.unitPrice,
          date: opts.date,
        },
      );
    } finally {
      await session.close();
    }
  } catch (err) {
    console.error("[neo4j-sync] Failed to sync PURCHASED relationship:", err);
  }
}

/**
 * Fire-and-forget helper: write a REVIEWED relationship to Neo4j.
 * Ensures the User and Product nodes exist (MERGE) with properties, then creates the edge.
 * Never throws — Neo4j errors are logged but don't affect the caller.
 */
export async function syncReviewed(opts: {
  userId: number;
  userName?: string;
  username?: string;
  productId: number;
  productName?: string;
  productCategory?: string;
  productPrice?: string;
  reviewId: number;
  rating: number;
  comment: string;
  date: string;
}): Promise<void> {
  try {
    const session = getNeo4jDriver().session();
    try {
      await session.run(
        `MERGE (u:User {id: $userId})
         ON CREATE SET u.name = $userName, u.username = $username
         MERGE (p:Product {id: $productId})
         ON CREATE SET p.name = $productName, p.category = $productCategory, p.price = $productPrice
         CREATE (u)-[:REVIEWED {
           reviewId: $reviewId,
           rating: $rating,
           comment: $comment,
           date: $date
         }]->(p)`,
        {
          userId: opts.userId,
          userName: opts.userName ?? null,
          username: opts.username ?? null,
          productId: opts.productId,
          productName: opts.productName ?? null,
          productCategory: opts.productCategory ?? null,
          productPrice: opts.productPrice ?? null,
          reviewId: opts.reviewId,
          rating: opts.rating,
          comment: opts.comment,
          date: opts.date,
        },
      );
    } finally {
      await session.close();
    }
  } catch (err) {
    console.error("[neo4j-sync] Failed to sync REVIEWED relationship:", err);
  }
}

/**
 * Fire-and-forget helper: remove a REVIEWED relationship from Neo4j when a
 * review is deleted. Uses neo4j.int() to match the stored Integer type.
 * Never throws.
 */
export async function unsyncReviewed(reviewId: number): Promise<void> {
  try {
    const session = getNeo4jDriver().session();
    try {
      await session.run(
        `MATCH ()-[r:REVIEWED]->() WHERE r.reviewId = $reviewId DELETE r`,
        { reviewId: neo4j.int(reviewId) },
      );
    } finally {
      await session.close();
    }
  } catch (err) {
    console.error("[neo4j-sync] Failed to remove REVIEWED relationship:", err);
  }
}
