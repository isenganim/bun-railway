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
    // Upsert user vertex
    await arcadeCommand("sql",
      "UPDATE User SET name = :name, username = :username UPSERT WHERE id = :id",
      { id: opts.userId, name: opts.userName ?? null, username: opts.username ?? null },
    );
    // Upsert product vertex
    await arcadeCommand("sql",
      "UPDATE Product SET name = :name, category = :category, price = :price UPSERT WHERE id = :id",
      { id: opts.productId, name: opts.productName ?? null, category: opts.productCategory ?? null, price: opts.productPrice ?? null },
    );
    // Create PURCHASED edge
    await arcadeCommand("sql",
      `CREATE EDGE PURCHASED FROM (SELECT FROM User WHERE id = :userId) TO (SELECT FROM Product WHERE id = :productId) SET orderId = :orderId, quantity = :quantity, unitPrice = :unitPrice, date = :date`,
      { userId: opts.userId, productId: opts.productId, orderId: opts.orderId, quantity: opts.quantity, unitPrice: opts.unitPrice, date: opts.date },
    );
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
    await arcadeCommand("sql",
      "UPDATE User SET name = :name, username = :username UPSERT WHERE id = :id",
      { id: opts.userId, name: opts.userName ?? null, username: opts.username ?? null },
    );
    await arcadeCommand("sql",
      "UPDATE Product SET name = :name, category = :category, price = :price UPSERT WHERE id = :id",
      { id: opts.productId, name: opts.productName ?? null, category: opts.productCategory ?? null, price: opts.productPrice ?? null },
    );
    await arcadeCommand("sql",
      `CREATE EDGE REVIEWED FROM (SELECT FROM User WHERE id = :userId) TO (SELECT FROM Product WHERE id = :productId) SET reviewId = :reviewId, rating = :rating, comment = :comment, date = :date`,
      { userId: opts.userId, productId: opts.productId, reviewId: opts.reviewId, rating: opts.rating, comment: opts.comment, date: opts.date },
    );
  } catch (err) {
    console.error("[arcadedb-sync] Failed to sync REVIEWED:", err);
  }
}

export async function unsyncReviewed(reviewId: number): Promise<void> {
  try {
    await arcadeCommand("sql",
      "DELETE FROM REVIEWED WHERE reviewId = :reviewId",
      { reviewId },
    );
  } catch (err) {
    console.error("[arcadedb-sync] Failed to remove REVIEWED:", err);
  }
}
