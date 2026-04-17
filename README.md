# Bun + Hono API

REST API dengan Bun, Hono, PostgreSQL (Drizzle ORM) — siap deploy ke Railway.

## Stack

- **Runtime**: Bun
- **Framework**: Hono
- **Database**: PostgreSQL via Railway
- **ORM**: Drizzle ORM

## Setup Lokal

```bash
# Install dependencies
bun install

# Copy env
cp .env.example .env
# Edit DATABASE_URL di .env

# Generate & run migrations
bunx drizzle-kit generate
bun run migrate

# Seed data (200 users, 194 products dari dummyjson, 500 orders, 1000 reviews)
bun run seed

# Seed data tambahan (300 users, ~500 produk sintetis, 700 orders, 2000 reviews)
bun run seed:extra

# Dev server
bun run dev
```

## Deploy ke Railway

1. Push ke GitHub
2. Buat project baru di [Railway](https://railway.app)
3. Add **PostgreSQL** service dari Railway
4. Deploy repo — Railway auto-detect Bun via Railpack
5. Set environment variable `DATABASE_URL` dari Railway PostgreSQL
6. Jalankan migrations via Railway CLI atau tambahkan ke start command:
   ```
   bun run migrate && bun run src/index.ts
   ```

## API Endpoints

### Users
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/users` | List users (pagination, search) |
| GET | `/users/:id` | Detail user |
| POST | `/users` | Buat user baru |
| PATCH | `/users/:id` | Update user |
| DELETE | `/users/:id` | Hapus user |

### Products
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/products` | List products (pagination, search, filter category) |
| GET | `/products/:id` | Detail product + reviews |
| POST | `/products` | Buat product |
| PATCH | `/products/:id` | Update product |
| DELETE | `/products/:id` | Hapus product |

### Orders
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/orders` | List orders + user info |
| GET | `/orders/:id` | Detail order + items |
| POST | `/orders` | Buat order (auto kurangi stock) |
| PATCH | `/orders/:id/status` | Update status order |

### Reviews
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/reviews/product/:productId` | Reviews per product + rating stats |
| POST | `/reviews` | Buat review |
| DELETE | `/reviews/:id` | Hapus review |

## Query Params

```
GET /products?page=1&limit=20&search=iphone&category=electronics
GET /users?page=1&limit=20&search=budi
GET /orders?page=1&limit=20
```

## Contoh Request

```bash
# Buat order
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{
    "userId": 1,
    "shippingAddress": "Jl. Sudirman No. 123, Jakarta",
    "items": [
      { "productId": 1, "quantity": 2 },
      { "productId": 5, "quantity": 1 }
    ]
  }'
```
