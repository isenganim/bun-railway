import { db } from "./index";
import { users, products, orders, orderItems, reviews } from "./schema";

// ── product generators ────────────────────────────────────────────────────────

const electronics = {
  brands: ["Samsung","Apple","Sony","LG","Xiaomi","ASUS","Lenovo","HP","Acer","Huawei","Oppo","Vivo","Realme","OnePlus","Panasonic"],
  types: ["Smartphone","Laptop","Tablet","Smartwatch","Earbuds","Speaker","Monitor","Keyboard","Mouse","Webcam","Router","SSD","RAM","GPU","Headphone"],
  variants: ["Pro","Ultra","Max","Plus","Lite","SE","X","S","Air","Mini"],
};

const clothing = {
  brands: ["Nike","Adidas","Puma","Uniqlo","H&M","Zara","Levi's","Calvin Klein","Polo","Gucci","Versace","Fila","New Balance","Converse","Vans"],
  types: ["T-Shirt","Hoodie","Jacket","Jeans","Chinos","Dress","Skirt","Blazer","Polo Shirt","Shorts","Sneakers","Boots","Sandals","Cap","Bag"],
  variants: ["Classic","Slim Fit","Regular","Oversized","Vintage","Sport","Casual","Formal","Limited Edition","Premium"],
};

const home = {
  brands: ["IKEA","Philips","Panasonic","Sharp","Electrolux","Dyson","Tefal","Oxone","Miyako","Cosmos","Modena","Rinnai","Wika","Sanken","Polytron"],
  types: ["Blender","Rice Cooker","Air Fryer","Vacuum Cleaner","Coffee Maker","Toaster","Microwave","Desk Lamp","Fan","Air Purifier","Sofa","Bed Frame","Wardrobe","Bookshelf","Curtain"],
  variants: ["2L","3L","5L","Digital","Smart","Automatic","Manual","Portable","Compact","Deluxe"],
};

const food = {
  brands: ["Indomie","Nestle","Unilever","Indofood","Wings","ABC","Kapal Api","Teh Botol","Aqua","Pocari","Milo","Ovaltine","Khong Guan","Roma","Oreo"],
  types: ["Mie Instan","Kopi","Teh","Susu","Snack","Biskuit","Coklat","Minuman Energi","Jus","Air Mineral","Bumbu","Saus","Minyak Goreng","Gula","Tepung"],
  variants: ["Original","Goreng","Kuah","Pedas","Manis","Asin","Rasa Ayam","Rasa Sapi","Rasa Seafood","Jumbo Pack"],
};

const sports = {
  brands: ["Nike","Adidas","Speedo","Wilson","Yonex","Li-Ning","Mikasa","Spalding","Decathlon","Kettler","Total","Diadora","Umbro","Hummel","Asics"],
  types: ["Sepatu Lari","Raket","Bola","Jersey","Celana Olahraga","Tas Gym","Matras","Dumbbell","Resistance Band","Helm","Pelindung","Sarung Tangan","Kaos Kaki","Topi","Jaket Olahraga"],
  variants: ["Pro","Tournament","Training","Junior","Senior","Lightweight","Heavy Duty","Waterproof","Breathable","Competition"],
};

const beauty = {
  brands: ["Wardah","Emina","Scarlett","Somethinc","Skintific","The Ordinary","Cetaphil","Nivea","Garnier","L'Oreal","Maybelline","NYX","Revlon","MAC","Innisfree"],
  types: ["Moisturizer","Serum","Sunscreen","Toner","Cleanser","Lipstick","Foundation","Mascara","Eyeshadow","Blush On","Parfum","Body Lotion","Shampoo","Conditioner","Face Mask"],
  variants: ["Normal Skin","Oily Skin","Dry Skin","Sensitive","Brightening","Anti-Aging","Hydrating","Matte","Glowing","SPF 50"],
};

const catData: Record<string, typeof electronics> = {
  electronics, clothing, home, food, sports, beauty,
};

const priceRange: Record<string, [number, number]> = {
  electronics: [500000, 25000000],
  clothing: [100000, 3000000],
  home: [150000, 8000000],
  food: [5000, 500000],
  sports: [50000, 5000000],
  beauty: [30000, 2000000],
};

function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Generate 500 synthetic products
function generateProducts() {
  const result = [];
  const slugSet = new Set<string>();

  for (const [cat, data] of Object.entries(catData)) {
    const [minPrice, maxPrice] = priceRange[cat];
    // ~83 products per category = ~500 total
    for (let i = 0; i < 83; i++) {
      const brand = pick(data.brands);
      const type = pick(data.types);
      const variant = pick(data.variants);
      const name = `${brand} ${type} ${variant}`;
      let slug = slugify(name);
      // ensure unique slug
      let n = 1;
      while (slugSet.has(slug)) slug = `${slugify(name)}-${n++}`;
      slugSet.add(slug);

      result.push({
        name,
        slug,
        description: `${name} adalah produk ${cat} berkualitas tinggi dari ${brand}. Cocok untuk kebutuhan sehari-hari dengan performa terbaik di kelasnya.`,
        price: String(rand(minPrice, maxPrice)),
        stock: rand(0, 200),
        category: cat as any,
        imageUrl: `https://picsum.photos/seed/${slug}/400/400`,
      });
    }
  }
  return result;
}

// ── helpers ───────────────────────────────────────────────────────────────────

const firstNames = ["Budi","Siti","Ahmad","Dewi","Rizky","Putri","Andi","Nurul","Fajar","Indah",
  "Hendra","Maya","Dian","Reza","Fitri","Bagas","Ayu","Wahyu","Lina","Agus",
  "Taufik","Rina","Doni","Sari","Yusuf","Nadia","Arif","Wulan","Eko","Citra",
  "Irfan","Laila","Hasan","Vina","Gilang","Tiara","Fauzi","Rini","Dimas","Sinta"];

const lastNames = ["Santoso","Wijaya","Kusuma","Pratama","Rahayu","Hidayat","Susanto","Wibowo",
  "Nugroho","Saputra","Permata","Lestari","Utama","Purnama","Setiawan","Hartono",
  "Gunawan","Firmansyah","Kurniawan","Andriani","Prasetyo","Wahyudi","Suryadi","Halim"];

const addresses = [
  "Jl. Sudirman No. 123, Jakarta Pusat","Jl. Gatot Subroto Kav. 45, Jakarta Selatan",
  "Jl. Raya Bogor Km. 30, Depok","Jl. Pemuda No. 78, Surabaya",
  "Jl. Malioboro No. 56, Yogyakarta","Jl. Asia Afrika No. 12, Bandung",
  "Jl. Diponegoro No. 34, Semarang","Jl. Ahmad Yani No. 89, Medan",
  "Jl. Imam Bonjol No. 67, Makassar","Jl. Gajah Mada No. 45, Denpasar",
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

// ── main ──────────────────────────────────────────────────────────────────────

console.log("🌱 Seeding extra data...");

// Hash password once for all users (password: password123)
const passwordHash = await Bun.password.hash("password123", { algorithm: "bcrypt", cost: 10 });

// Get existing user count to offset new user indices
const existingUsers = await db.query.users.findMany({ columns: { id: true } });
const startIdx = existingUsers.length;

// Seed 300 more users
console.log("Creating 300 more users...");
const userInserts = Array.from({ length: 300 }, (_, i) => {
  const first = pick(firstNames);
  const last = pick(lastNames);
  const idx = startIdx + i + 1;
  const username = `user_${String(idx).padStart(4, "0")}`;
  return {
    name: `${first} ${last}`,
    email: `${username}@example.com`,
    username,
    passwordHash,
    role: "user" as const,
    status: i % 15 === 0 ? "inactive" as const : "active" as const,
    bio: `Halo, saya ${first} ${last}. Senang berbelanja di sini!`,
    avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`,
  };
});

const insertedUsers = await db.insert(users).values(userInserts).returning({ id: users.id });
console.log(`✓ ${insertedUsers.length} users created`);

// Seed 500 synthetic products
console.log("Generating 500 synthetic products...");
const productInserts = generateProducts();
const insertedProducts = await db.insert(products).values(productInserts).returning({ id: products.id });
console.log(`✓ ${insertedProducts.length} products created`);

// All users (existing + new) for orders/reviews
const allUsers = [...existingUsers, ...insertedUsers];

// Seed 700 more orders
console.log("Creating 700 more orders...");
const orderInserts = Array.from({ length: 700 }, (_, i) => ({
  userId: pick(allUsers).id,
  status: orderStatuses[i % orderStatuses.length],
  totalAmount: String(rand(50000, 15000000)),
  shippingAddress: pick(addresses),
  notes: i % 8 === 0 ? "Tolong dibungkus rapi ya kak" : null,
}));

const insertedOrders = await db.insert(orders).values(orderInserts).returning({ id: orders.id });
console.log(`✓ ${insertedOrders.length} orders created`);

// Seed order items
console.log("Creating order items...");
const allProducts = [...insertedProducts];
const orderItemInserts = insertedOrders.flatMap((order) => {
  const count = rand(1, 5);
  const used = new Set<number>();
  return Array.from({ length: count }, () => {
    let p = pick(allProducts);
    while (used.has(p.id)) p = pick(allProducts);
    used.add(p.id);
    return {
      orderId: order.id,
      productId: p.id,
      quantity: rand(1, 5),
      unitPrice: String(rand(10000, 5000000)),
    };
  });
});

await db.insert(orderItems).values(orderItemInserts);
console.log(`✓ ${orderItemInserts.length} order items created`);

// Seed 2000 more reviews
console.log("Creating 2000 more reviews...");
const reviewInserts = Array.from({ length: 2000 }, () => ({
  userId: pick(allUsers).id,
  productId: pick(allProducts).id,
  rating: rand(1, 5),
  comment: pick(comments),
}));

await db.insert(reviews).values(reviewInserts);
console.log(`✓ 2000 reviews created`);

console.log("\n✅ Extra seeding complete!");
console.log(`   Users    : +${insertedUsers.length}`);
console.log(`   Products : +${insertedProducts.length}`);
console.log(`   Orders   : +${insertedOrders.length}`);
console.log(`   Items    : +${orderItemInserts.length}`);
console.log(`   Reviews  : +2000`);
process.exit(0);
