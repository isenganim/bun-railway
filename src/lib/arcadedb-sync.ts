import { arcadeCommand } from "../db/arcadedb";

export async function syncPurchased(opts: {
  userId: number;
  userName?: string;
  username?: string;
  items: { productId: number; productName?: string; productCategory?: string; productPrice?: string; quantity: number; unitPrice: number }[];
  orderId: number;
  date: string;
}): Promise<void> {
  try {
    const lines: string[] = [
      `UPDATE User SET name = '${esc(opts.userName)}', username = '${esc(opts.username)}' UPSERT WHERE id = ${opts.userId};`,
    ];
    for (const item of opts.items) {
      lines.push(`UPDATE Product SET name = '${esc(item.productName)}', category = '${esc(item.productCategory)}', price = '${esc(item.productPrice)}' UPSERT WHERE id = ${item.productId};`);
      lines.push(`CREATE EDGE PURCHASED FROM (SELECT FROM User WHERE id = ${opts.userId}) TO (SELECT FROM Product WHERE id = ${item.productId}) SET orderId = ${opts.orderId}, quantity = ${item.quantity}, unitPrice = ${item.unitPrice}, date = '${esc(opts.date)}';`);
    }
    await arcadeCommand("sqlscript", lines.join("\n"));
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
    const script = [
      `UPDATE User SET name = '${esc(opts.userName)}', username = '${esc(opts.username)}' UPSERT WHERE id = ${opts.userId};`,
      `UPDATE Product SET name = '${esc(opts.productName)}', category = '${esc(opts.productCategory)}', price = '${esc(opts.productPrice)}' UPSERT WHERE id = ${opts.productId};`,
      `CREATE EDGE REVIEWED FROM (SELECT FROM User WHERE id = ${opts.userId}) TO (SELECT FROM Product WHERE id = ${opts.productId}) SET reviewId = ${opts.reviewId}, rating = ${opts.rating}, comment = '${esc(opts.comment)}', date = '${esc(opts.date)}';`,
    ].join("\n");
    await arcadeCommand("sqlscript", script);
  } catch (err) {
    console.error("[arcadedb-sync] Failed to sync REVIEWED:", err);
  }
}

export async function unsyncReviewed(reviewId: number): Promise<void> {
  try {
    await arcadeCommand("sql", "DELETE FROM REVIEWED WHERE reviewId = :reviewId", { reviewId });
  } catch (err) {
    console.error("[arcadedb-sync] Failed to remove REVIEWED:", err);
  }
}

function esc(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val).replace(/'/g, "\\'");
}
