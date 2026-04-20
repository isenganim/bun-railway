import { arcadeCommand } from "../db/arcadedb";

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
    await arcadeCommand("opencypher", `
      MERGE (u:User {id: $userId})
      ON CREATE SET u.name = $userName, u.username = $username
      MERGE (p:Product {id: $productId})
      ON CREATE SET p.name = $productName, p.category = $productCategory, p.price = $productPrice
      CREATE (u)-[:PURCHASED {orderId: $orderId, quantity: $quantity, unitPrice: $unitPrice, date: $date}]->(p)
    `, {
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
    });
  } catch (err) {
    console.error("[arcadedb-sync] Failed to sync PURCHASED:", err);
  }
}

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
    await arcadeCommand("opencypher", `
      MERGE (u:User {id: $userId})
      ON CREATE SET u.name = $userName, u.username = $username
      MERGE (p:Product {id: $productId})
      ON CREATE SET p.name = $productName, p.category = $productCategory, p.price = $productPrice
      CREATE (u)-[:REVIEWED {reviewId: $reviewId, rating: $rating, comment: $comment, date: $date}]->(p)
    `, {
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
    });
  } catch (err) {
    console.error("[arcadedb-sync] Failed to sync REVIEWED:", err);
  }
}

export async function unsyncReviewed(reviewId: number): Promise<void> {
  try {
    await arcadeCommand("opencypher",
      `MATCH ()-[r:REVIEWED]->() WHERE r.reviewId = $reviewId DELETE r`,
      { reviewId },
    );
  } catch (err) {
    console.error("[arcadedb-sync] Failed to remove REVIEWED:", err);
  }
}
