import { getNeo4jDriver } from "../db/neo4j";

/**
 * Fire-and-forget helper: write a PURCHASED relationship to Neo4j.
 * Ensures the User and Product nodes exist (MERGE), then creates the edge.
 * Never throws — Neo4j errors are logged but don't affect the caller.
 */
export async function syncPurchased(opts: {
  userId: number;
  productId: number;
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
         MERGE (p:Product {id: $productId})
         CREATE (u)-[:PURCHASED {
           orderId: $orderId,
           quantity: $quantity,
           unitPrice: $unitPrice,
           date: $date
         }]->(p)`,
        {
          userId: opts.userId,
          productId: opts.productId,
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
    // Neo4j is non-critical — log and continue
    console.error("[neo4j-sync] Failed to sync PURCHASED relationship:", err);
  }
}

/**
 * Fire-and-forget helper: write a REVIEWED relationship to Neo4j.
 * Ensures the User and Product nodes exist (MERGE), then creates the edge.
 * Never throws — Neo4j errors are logged but don't affect the caller.
 */
export async function syncReviewed(opts: {
  userId: number;
  productId: number;
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
         MERGE (p:Product {id: $productId})
         CREATE (u)-[:REVIEWED {
           reviewId: $reviewId,
           rating: $rating,
           comment: $comment,
           date: $date
         }]->(p)`,
        {
          userId: opts.userId,
          productId: opts.productId,
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
 * review is deleted. Never throws.
 */
export async function unsyncReviewed(reviewId: number): Promise<void> {
  try {
    const session = getNeo4jDriver().session();
    try {
      await session.run(
        `MATCH ()-[r:REVIEWED {reviewId: $reviewId}]->() DELETE r`,
        { reviewId },
      );
    } finally {
      await session.close();
    }
  } catch (err) {
    console.error("[neo4j-sync] Failed to remove REVIEWED relationship:", err);
  }
}
