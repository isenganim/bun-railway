import { db } from "./index";
import { users, products, orders, orderItems, reviews } from "./schema";
import { sql } from "drizzle-orm";

// ── helpers ──────────────────────────────────────────────────────────────────

const firstNames = ["Budi","Siti","Ahmad","Dewi","Rizky","Putri","Andi","Nurul","Fajar","Indah",
  "Hendra","Maya","Dian","Reza","Fitri","Bagas","Ayu","Wahyu","Lina","Agus",
  "Taufik","Rina","Doni","Sari","Yusuf","Nadia","Arif","Wulan","Eko","Citra",
  "Irfan","Laila","Hasan","Vina","Gilang","Tiara","Fauzi","Rini","Dimas","Sinta"];

const lastNames = ["Santoso","Wijaya","Kusuma","Pratama","Rahayu","Hidayat","Susanto","Wibowo",
  "Nugroho","Saputra","Permata","Lestari","Utama","Purnama","Setiawan","Hartono",
  "Gunawan","Firmansyah","Kurniawan","Andriani","Prasetyo","Wahyudi","Suryadi","Halim"];

const addresses = [
  "Jl. Sudirman No. 123, Jakarta Pusat 10220",
  "Jl. Gatot Subroto Kav. 45, Jakarta Selatan 12930",
  "Jl. Raya Bogor Km. 30, Depok 16412",
  "Jl. Pemuda No. 78, Surabaya 60271",
  "Jl. Malioboro No. 56, Yogyakarta 55213",
  "Jl. Asia Afrika No. 12, Bandung 40111",
  "Jl. Diponegoro No. 34, Semarang 50131",
  "Jl. Ahmad Yani No. 89, Medan 20111",
  "Jl. Imam Bonjol No. 67, Makassar 90111",
  "Jl. Gajah Mada No. 45, Denpasar 80111",
  "Jl. Pahlawan No. 12, Palembang 30111",
  "Jl. Veteran No. 34, Balikpapan 76111",
  "Jl. Merdeka No. 56, Manado 95111",
  "Jl. Kartini No. 78, Pontianak 78111",
  "Jl. Dirgantara No. 90, Pekanbaru 28111",
];

const comments = [
  "Produk bagus, sesuai deskripsi!", "Pengiriman cepat, packing aman.",
  "Kualitas premium, worth it banget!", "Recommended seller!",
  "Barang original, puas banget.", "Mantap jiwa, beli lagi deh.",
  "Sesuai ekspektasi, terima kasih!", "Produk oke, harga terjangkau.",
  "Cepat sampai, kondisi mulus.", "Seller responsif, barang bagus.",
  "Agak lama pengirimannya tapi barang oke.", "Lumayan, sesuai harga.",
  "Kurang sesuai ekspektasi.", "Barang sedikit berbeda dari foto.",
  "Sangat puas, akan order lagi!", "Kualitas terjamin, harga bersaing.",
];

const orderStatuses = ["pending","processing","shipped","delivered","cancelled"] as const;

const catMap: Record<string, string> = {
  "beauty": "beauty", "fragrances": "beauty", "skin-care": "beauty",
  "laptops": "electronics", "smartphones": "electronics", "tablets": "electronics",
  "mobile-accessories": "electronics", "mens-watches": "electronics",
  "womens-watches": "electronics",
  "mens-shirts": "clothing", "mens-shoes": "clothing", "tops": "clothing",
  "womens-bags": "clothing", "womens-dresses": "clothing",
  "womens-jewellery": "clothing", "womens-shoes": "clothing", "sunglasses": "clothing",
  "furniture": "home", "home-decoration": "home", "kitchen-accessories": "home",
  "groceries": "food",
  "sports-accessories": "sports", "motorcycle": "sports", "vehicle": "sports",
};

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// ── fetch products from dummyjson ─────────────────────────────────────────────

console.log("🌱 Seeding database...");

// Truncate all tables so seed is re-runnable
console.log("Truncating tables...");
await db.execute(sql`TRUNCATE users, products, orders, order_items, order_status_history, reviews, wishlists, categories, coupons, notifications RESTART IDENTITY CASCADE`);
console.log("✓ Tables truncated");

// Hash password once for all users (password: password123)
const passwordHash = await Bun.password.hash("password123", { algorithm: "bcrypt", cost: 10 });

console.log("Fetching products from dummyjson.com...");
const res = await fetch("https://dummyjson.com/products?limit=194&select=title,description,price,stock,category,thumbnail");
const { products: raw } = await res.json() as { products: any[] };
console.log(`✓ Fetched ${raw.length} products`);

// ── seed users (200) ──────────────────────────────────────────────────────────

console.log("Creating 200 users...");
const userInserts = Array.from({ length: 200 }, (_, i) => {
  const first = pick(firstNames);
  const last = pick(lastNames);
  const username = `user_${String(i + 1).padStart(3, "0")}`;
  const email = `${username}@example.com`;
  return {
    name: `${first} ${last}`,
    email,
    username,
    passwordHash,
    role: i === 0 ? "admin" as const : i < 5 ? "moderator" as const : "user" as const,
    status: i % 20 === 0 ? "inactive" as const : "active" as const,
    bio: `Halo, saya ${first} ${last}. Senang berbelanja di sini!`,
    avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`,
  };
});

const insertedUsers = await db.insert(users).values(userInserts).returning({ id: users.id });
console.log(`✓ ${insertedUsers.length} users created`);

// ── seed products (194 from dummyjson) ────────────────────────────────────────

console.log("Creating products...");
const slugCount = new Map<string, number>();
const productInserts = raw.map((p: any) => {
  const base = slugify(p.title);
  const count = slugCount.get(base) ?? 0;
  slugCount.set(base, count + 1);
  const slug = count === 0 ? base : `${base}-${count}`;
  return {
  name: p.title,
  slug,
  description: p.description,
  price: String(Math.round(p.price * 15000)),
  stock: p.stock,
  category: (catMap[p.category] ?? "home") as any,
  imageUrl: p.thumbnail,
  };
});

const insertedProducts = await db.insert(products).values(productInserts).returning({ id: products.id });
console.log(`✓ ${insertedProducts.length} products created`);

// ── seed orders (500) ─────────────────────────────────────────────────────────

console.log("Creating 500 orders...");
const orderInserts = Array.from({ length: 500 }, (_, i) => ({
  userId: pick(insertedUsers).id,
  status: orderStatuses[i % orderStatuses.length],
  totalAmount: String(rand(50000, 10000000)),
  shippingAddress: pick(addresses),
  notes: i % 7 === 0 ? "Tolong dibungkus rapi ya kak" : null,
}));

const insertedOrders = await db.insert(orders).values(orderInserts).returning({ id: orders.id });
console.log(`✓ ${insertedOrders.length} orders created`);

// ── seed order items (1-5 per order) ─────────────────────────────────────────

console.log("Creating order items...");
const orderItemInserts = insertedOrders.flatMap((order) => {
  const count = rand(1, 5);
  const used = new Set<number>();
  return Array.from({ length: count }, () => {
    let p = pick(insertedProducts);
    while (used.has(p.id)) p = pick(insertedProducts);
    used.add(p.id);
    return {
      orderId: order.id,
      productId: p.id,
      quantity: rand(1, 5),
      unitPrice: String(rand(10000, 3000000)),
    };
  });
});

await db.insert(orderItems).values(orderItemInserts);
console.log(`✓ ${orderItemInserts.length} order items created`);

// ── seed reviews (1000) ───────────────────────────────────────────────────────

console.log("Creating 1000 reviews...");
const reviewInserts = Array.from({ length: 1000 }, () => ({
  userId: pick(insertedUsers).id,
  productId: pick(insertedProducts).id,
  rating: rand(1, 5),
  comment: pick(comments),
}));

await db.insert(reviews).values(reviewInserts);
console.log(`✓ 1000 reviews created`);

console.log("\n✅ Seeding complete!");
console.log(`   Users    : ${insertedUsers.length}`);
console.log(`   Products : ${insertedProducts.length}`);
console.log(`   Orders   : ${insertedOrders.length}`);
console.log(`   Items    : ${orderItemInserts.length}`);
console.log(`   Reviews  : 1000`);
console.log(`\n🔑 All users password: password123`);
console.log(`   Admin login: user_001@example.com / password123`);
process.exit(0);
