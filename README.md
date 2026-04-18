# Bun + Hono API

REST API dengan Bun, Hono, PostgreSQL (Drizzle ORM), Neo4j — siap deploy ke Railway.

## Stack

- **Runtime**: Bun
- **Framework**: Hono
- **Database**: PostgreSQL via Railway + Neo4j
- **ORM**: Drizzle ORM
- **Validation**: Zod + @hono/zod-validator
- **Auth**: JWT (hono/jwt) + Bun.password (bcrypt)

## Features

- JWT Authentication (register, login, role-based access)
- CRUD Users, Products, Orders, Reviews
- Wishlist / Favorites
- Coupons & Discounts (percentage/fixed, expiry, usage limits)
- Categories (hierarchical, parent/child)
- Notifications system
- Order tracking & status history
- Product search with price range, sorting, top-rated, best-sellers
- User activity (order history, review history)
- Neo4j-powered recommendations (collaborative filtering, trending)
- Rate limiting
- API versioning (`/api/v1/`)
- Zod input validation on write endpoints

## Setup Lokal

```bash
# Install dependencies
bun install

# Copy env
cp .env.example .env
# Edit DATABASE_URL, JWT_SECRET, NEO4J_* di .env

# Generate & run migrations
bunx drizzle-kit generate
bun run migrate

# Seed data
bun run seed
bun run seed:extra

# Dev server
bun run dev
```

## Deploy ke Railway

1. Push ke GitHub
2. Buat project baru di [Railway](https://railway.app)
3. Add **PostgreSQL** service dari Railway
4. Deploy repo — Railway auto-detect Bun via Railpack
5. Set environment variables: `DATABASE_URL`, `JWT_SECRET`, `NEO4J_*`
6. Jalankan migrations:
   ```bash
   bun run migrate && bun run src/index.ts
   ```

## API Endpoints

Base URL: `/api/v1` (backward-compatible routes juga tersedia tanpa prefix)

### Auth

| Method | Endpoint                | Auth | Deskripsi                |
| ------ | ----------------------- | ---- | ------------------------ |
| POST   | `/api/v1/auth/register` | -    | Register user baru       |
| POST   | `/api/v1/auth/login`    | -    | Login, dapat JWT token   |
| GET    | `/api/v1/auth/me`       | JWT  | Get current user profile |

### Users

| Method | Endpoint                    | Auth        | Deskripsi                       |
| ------ | --------------------------- | ----------- | ------------------------------- |
| GET    | `/api/v1/users`             | -           | List users (pagination, search) |
| GET    | `/api/v1/users/:id`         | -           | Detail user                     |
| GET    | `/api/v1/users/:id/orders`  | Owner/Admin | Order history user              |
| GET    | `/api/v1/users/:id/reviews` | -           | Review history user             |
| POST   | `/api/v1/users`             | -           | Buat user baru                  |
| PATCH  | `/api/v1/users/:id`         | Owner/Admin | Update user (Zod validated)     |
| DELETE | `/api/v1/users/:id`         | Admin       | Hapus user                      |

### Products

| Method | Endpoint                        | Auth      | Deskripsi                                            |
| ------ | ------------------------------- | --------- | ---------------------------------------------------- |
| GET    | `/api/v1/products`              | -         | List (pagination, search, filter, sort, price range) |
| GET    | `/api/v1/products/top-rated`    | -         | Products by highest rating                           |
| GET    | `/api/v1/products/best-sellers` | -         | Products by most sold                                |
| GET    | `/api/v1/products/:id`          | -         | Detail product + reviews                             |
| POST   | `/api/v1/products`              | Admin/Mod | Buat product (Zod validated)                         |
| PATCH  | `/api/v1/products/:id`          | Admin/Mod | Update product                                       |
| DELETE | `/api/v1/products/:id`          | Admin     | Hapus product                                        |

### Orders

| Method | Endpoint                      | Auth        | Deskripsi                      |
| ------ | ----------------------------- | ----------- | ------------------------------ |
| GET    | `/api/v1/orders`              | Admin/Mod   | List orders + user info        |
| GET    | `/api/v1/orders/:id`          | Owner/Staff | Detail order + items           |
| GET    | `/api/v1/orders/:id/tracking` | Owner/Staff | Tracking info + status history |
| POST   | `/api/v1/orders`              | JWT         | Buat order (coupon support)    |
| PATCH  | `/api/v1/orders/:id/status`   | Admin/Mod   | Update status + tracking       |

### Reviews

| Method | Endpoint                             | Auth      | Deskripsi                   |
| ------ | ------------------------------------ | --------- | --------------------------- |
| GET    | `/api/v1/reviews/product/:productId` | -         | Reviews per product + stats |
| POST   | `/api/v1/reviews`                    | JWT       | Buat review (Zod validated) |
| DELETE | `/api/v1/reviews/:id`                | Admin/Mod | Hapus review                |

### Wishlists

| Method | Endpoint                                              | Auth        | Deskripsi                   |
| ------ | ----------------------------------------------------- | ----------- | --------------------------- |
| GET    | `/api/v1/wishlists/users/:userId`                     | Owner/Admin | Wishlist user               |
| POST   | `/api/v1/wishlists/users/:userId`                     | Owner/Admin | Tambah ke wishlist          |
| DELETE | `/api/v1/wishlists/users/:userId/products/:productId` | Owner/Admin | Hapus dari wishlist         |
| GET    | `/api/v1/wishlists/products/:productId/count`         | -           | Jumlah wishlist per product |

### Coupons

| Method | Endpoint                         | Auth  | Deskripsi            |
| ------ | -------------------------------- | ----- | -------------------- |
| GET    | `/api/v1/coupons`                | -     | List coupons         |
| GET    | `/api/v1/coupons/validate/:code` | -     | Validate coupon code |
| POST   | `/api/v1/coupons`                | Admin | Buat coupon          |
| PATCH  | `/api/v1/coupons/:id`            | Admin | Update coupon        |
| DELETE | `/api/v1/coupons/:id`            | Admin | Hapus coupon         |

### Categories

| Method | Endpoint                  | Auth  | Deskripsi                 |
| ------ | ------------------------- | ----- | ------------------------- |
| GET    | `/api/v1/categories`      | -     | Tree structure categories |
| GET    | `/api/v1/categories/flat` | -     | Flat list categories      |
| GET    | `/api/v1/categories/:id`  | -     | Detail + children         |
| POST   | `/api/v1/categories`      | Admin | Buat category             |
| PATCH  | `/api/v1/categories/:id`  | Admin | Update category           |
| DELETE | `/api/v1/categories/:id`  | Admin | Hapus category            |

### Notifications

| Method | Endpoint                                           | Auth        | Deskripsi           |
| ------ | -------------------------------------------------- | ----------- | ------------------- |
| GET    | `/api/v1/notifications/users/:userId`              | Owner/Admin | List notifications  |
| GET    | `/api/v1/notifications/users/:userId/unread-count` | Owner/Admin | Unread count        |
| PATCH  | `/api/v1/notifications/:id/read`                   | Owner/Admin | Mark as read        |
| PATCH  | `/api/v1/notifications/users/:userId/read-all`     | Owner/Admin | Mark all as read    |
| POST   | `/api/v1/notifications`                            | Admin       | Create notification |
| DELETE | `/api/v1/notifications/:id`                        | Owner/Admin | Delete notification |

### Recommendations (Neo4j)

| Method | Endpoint                                    | Deskripsi                          |
| ------ | ------------------------------------------- | ---------------------------------- |
| GET    | `/api/v1/recommendations/products/:id`      | "Users yang beli ini juga beli..." |
| GET    | `/api/v1/recommendations/users/:id`         | Personalized recommendations       |
| GET    | `/api/v1/recommendations/trending`          | Trending products                  |
| GET    | `/api/v1/recommendations/similar-users/:id` | Similar users                      |
| GET    | `/api/v1/recommendations/graph-stats`       | Neo4j graph overview               |

## Query Params

```http
GET /api/v1/products?page=1&limit=20&search=iphone&category=electronics&minPrice=100&maxPrice=1000&sort=price_asc
GET /api/v1/users?page=1&limit=20&search=budi
GET /api/v1/orders?page=1&limit=20
GET /api/v1/notifications/users/1?unread=true
```

## Contoh Request

```bash
# Register
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"John","email":"[email]","username":"john","password":"password123"}'

# Login
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"[email]","password":"password123"}'

# Create product (admin)
curl -X POST http://localhost:3000/api/v1/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"name":"iPhone 15","price":999,"category":"electronics"}'

# Create order with coupon
curl -X POST http://localhost:3000/api/v1/orders \
  -H "Content-Type: application/json" \
  -d '{
    "userId": 1,
    "shippingAddress": "Jl. Sudirman No. 123, Jakarta",
    "couponCode": "SAVE10",
    "items": [
      { "productId": 1, "quantity": 2 }
    ]
  }'

# Add to wishlist
curl -X POST http://localhost:3000/api/v1/wishlists/users/1 \
  -H "Content-Type: application/json" \
  -d '{"productId": 5}'
```
