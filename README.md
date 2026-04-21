# Bun + Hono API

REST API built with Bun, Hono, PostgreSQL (Drizzle ORM), and ArcadeDB — ready to deploy on Railway/Coolify.

## Stack

- **Runtime**: Bun
- **Framework**: Hono
- **Database**: PostgreSQL + ArcadeDB (graph recommendations)
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
- ArcadeDB-powered recommendations (collaborative filtering, trending)
- **Real-time ArcadeDB sync** — graph updated automatically on every order/review
- Rate limiting (100 req/min)
- API versioning (`/api/v1/`)
- Zod input validation on write endpoints
- Interactive API docs at `/docs` (Scalar UI) and `/openapi.json`

## Setup

```bash
# Install dependencies
bun install

# Copy env
cp .env.example .env
# Edit DATABASE_URL, JWT_SECRET, ARCADEDB_* in .env

# Generate & run migrations
bunx drizzle-kit generate
bun run migrate

# Seed data
bun run seed
bun run seed:extra

# Sync existing data to ArcadeDB (first-time or recovery)
bun run arcadedb:sync

# Dev server
bun run dev
```

## Deploy

1. Push to GitHub
2. Deploy **PostgreSQL** and **ArcadeDB** (via Dockerfile in `arcadedb/`)
3. Deploy the app
4. Set environment variables:
   - `DATABASE_URL` — PostgreSQL connection string
   - `JWT_SECRET` — random secret for JWT
   - `ARCADEDB_URL` — ArcadeDB HTTP URL (e.g. `http://arcadedb:2480`)
   - `ARCADEDB_DATABASE` — database name (default: `bun_railway`)
   - `ARCADEDB_USER` — ArcadeDB user (default: `root`)
   - `ARCADEDB_PASSWORD` — ArcadeDB password
5. Run migrations on first deploy:
   ```bash
   bun run migrate && bun run src/index.ts
   ```

## ArcadeDB Graph Sync

The API keeps the ArcadeDB graph in sync automatically:

| Event | Action |
| --- | --- |
| `POST /orders` | Creates `(User)-[:PURCHASED]->(Product)` for each item |
| `POST /reviews` | Creates `(User)-[:REVIEWED]->(Product)` |
| `DELETE /reviews/:id` | Removes the `[:REVIEWED]` relationship |

> Graph sync is **fire-and-forget** with a **serialized queue** — writes are processed one at a time to avoid ArcadeDB page conflicts. If ArcadeDB is unreachable, orders and reviews still succeed. Errors are logged to the server console.

### How it works

- Real-time sync uses **SQL** (`UPDATE ... UPSERT` + `CREATE EDGE`) via ArcadeDB's native `sqlscript` language
- All items in a single order are batched into **one `sqlscript` transaction** (1 HTTP request per order, not per item)
- A **promise queue** serializes all ArcadeDB writes to prevent `ConcurrentModificationException`
- Server-side `retry: 5` is set on all commands for additional resilience

### Manual Full Sync (first-time or recovery)

```bash
bun run arcadedb:sync
```

This wipes the graph and rebuilds from PostgreSQL using batched `sqlscript` inserts (200 records per request). Use after initial setup or if ArcadeDB was offline for a period.

## API Endpoints

Base URL: `/api/v1`

Auth legend: `-` = public · `JWT` = any valid token · `Owner` = resource owner · `Mod` = moderator · `Admin` = admin only

### Auth

| Method | Endpoint                | Auth  | Description              |
| ------ | ----------------------- | ----- | ------------------------ |
| POST   | `/api/v1/auth/register` | -     | Register new user        |
| POST   | `/api/v1/auth/login`    | -     | Login, returns JWT token |
| GET    | `/api/v1/auth/me`       | JWT   | Get current user profile |

### Users

| Method | Endpoint                    | Auth         | Description                         |
| ------ | --------------------------- | ------------ | ----------------------------------- |
| GET    | `/api/v1/users`             | Admin/Mod    | List users (pagination, search)     |
| GET    | `/api/v1/users/:id`         | JWT          | User profile (no email/password)    |
| GET    | `/api/v1/users/:id/orders`  | Owner/Admin  | Order history                       |
| GET    | `/api/v1/users/:id/reviews` | JWT          | Review history                      |
| POST   | `/api/v1/users`             | Admin        | Create user without password (seed) |
| PATCH  | `/api/v1/users/:id`         | Owner/Admin  | Update profile (Zod validated)      |
| DELETE | `/api/v1/users/:id`         | Admin        | Delete user                         |

### Products

| Method | Endpoint                        | Auth      | Description                                          |
| ------ | ------------------------------- | --------- | ---------------------------------------------------- |
| GET    | `/api/v1/products`              | -         | List (pagination, search, filter, sort, price range) |
| GET    | `/api/v1/products/top-rated`    | -         | Products by highest rating                           |
| GET    | `/api/v1/products/best-sellers` | -         | Products by most sold                                |
| GET    | `/api/v1/products/:id`          | -         | Product detail + last 10 reviews                     |
| POST   | `/api/v1/products`              | Admin/Mod | Create product (Zod validated)                       |
| PATCH  | `/api/v1/products/:id`          | Admin/Mod | Update product                                       |
| DELETE | `/api/v1/products/:id`          | Admin     | Delete product                                       |

### Orders

| Method | Endpoint                      | Auth        | Description                                    |
| ------ | ----------------------------- | ----------- | ---------------------------------------------- |
| GET    | `/api/v1/orders`              | Admin/Mod   | List orders + user info                        |
| GET    | `/api/v1/orders/:id`          | Owner/Staff | Order detail + items                           |
| GET    | `/api/v1/orders/:id/tracking` | Owner/Staff | Tracking info + status history                 |
| POST   | `/api/v1/orders`              | JWT         | Place order (coupon support) → syncs ArcadeDB  |
| PATCH  | `/api/v1/orders/:id/status`   | Admin/Mod   | Update status + tracking + notification        |

### Reviews

| Method | Endpoint                             | Auth      | Description                                  |
| ------ | ------------------------------------ | --------- | -------------------------------------------- |
| GET    | `/api/v1/reviews/product/:productId` | -         | Reviews per product + stats                  |
| POST   | `/api/v1/reviews`                    | JWT       | Submit review (Zod validated) → syncs ArcadeDB |
| DELETE | `/api/v1/reviews/:id`                | Admin/Mod | Delete review → removes from ArcadeDB        |

### Wishlists

| Method | Endpoint                                              | Auth        | Description              |
| ------ | ----------------------------------------------------- | ----------- | ------------------------ |
| GET    | `/api/v1/wishlists/users/:userId`                     | Owner/Admin | Get user wishlist        |
| POST   | `/api/v1/wishlists/users/:userId`                     | Owner/Admin | Add to wishlist          |
| DELETE | `/api/v1/wishlists/users/:userId/products/:productId` | Owner/Admin | Remove from wishlist     |
| GET    | `/api/v1/wishlists/products/:productId/count`         | -           | Wishlist count           |

### Coupons

| Method | Endpoint                         | Auth      | Description                            |
| ------ | -------------------------------- | --------- | -------------------------------------- |
| GET    | `/api/v1/coupons`                | Admin/Mod | List all coupons (codes + usage stats) |
| GET    | `/api/v1/coupons/validate/:code` | -         | Validate a coupon (for checkout)       |
| POST   | `/api/v1/coupons`                | Admin     | Create coupon                          |
| PATCH  | `/api/v1/coupons/:id`            | Admin     | Update coupon                          |
| DELETE | `/api/v1/coupons/:id`            | Admin     | Delete coupon                          |

### Categories

| Method | Endpoint                  | Auth  | Description               |
| ------ | ------------------------- | ----- | ------------------------- |
| GET    | `/api/v1/categories`      | -     | Tree structure categories |
| GET    | `/api/v1/categories/flat` | -     | Flat list categories      |
| GET    | `/api/v1/categories/:id`  | -     | Detail + children         |
| POST   | `/api/v1/categories`      | Admin | Create category           |
| PATCH  | `/api/v1/categories/:id`  | Admin | Update category           |
| DELETE | `/api/v1/categories/:id`  | Admin | Delete category           |

### Notifications

| Method | Endpoint                                           | Auth        | Description         |
| ------ | -------------------------------------------------- | ----------- | ------------------- |
| GET    | `/api/v1/notifications/users/:userId`              | Owner/Admin | List notifications  |
| GET    | `/api/v1/notifications/users/:userId/unread-count` | Owner/Admin | Unread count        |
| PATCH  | `/api/v1/notifications/:id/read`                   | Owner/Admin | Mark as read        |
| PATCH  | `/api/v1/notifications/users/:userId/read-all`     | Owner/Admin | Mark all as read    |
| POST   | `/api/v1/notifications`                            | Admin       | Create notification |
| DELETE | `/api/v1/notifications/:id`                        | Owner/Admin | Delete notification |

### Recommendations (ArcadeDB)

| Method | Endpoint                                    | Description                              |
| ------ | ------------------------------------------- | ---------------------------------------- |
| GET    | `/api/v1/recommendations/products/:id`      | "Users who bought this also bought..."   |
| GET    | `/api/v1/recommendations/users/:id`         | Personalized recommendations             |
| GET    | `/api/v1/recommendations/trending`          | Trending products                        |
| GET    | `/api/v1/recommendations/similar-users/:id` | Similar users by purchase pattern        |
| GET    | `/api/v1/recommendations/graph-stats`       | ArcadeDB graph overview                  |

### Health & Meta

| Endpoint           | Description                            |
| ------------------ | -------------------------------------- |
| `GET /`            | API info + route index                 |
| `GET /health`      | Server health                          |
| `GET /health/db`   | PostgreSQL + ArcadeDB connectivity     |
| `GET /stats`       | Row counts across all tables           |
| `GET /docs`        | Interactive API docs (Scalar UI)       |
| `GET /openapi.json`| OpenAPI 3.1 spec                       |

## Query Parameters

```http
GET /api/v1/products?page=1&limit=20&search=iphone&category=electronics&minPrice=100&maxPrice=1000&sort=price_asc
GET /api/v1/users?page=1&limit=20&search=budi
GET /api/v1/orders?page=1&limit=20
GET /api/v1/notifications/users/1?unread=true
```

Product sort values: `price_asc`, `price_desc` (default: newest first)
Product categories: `electronics`, `clothing`, `food`, `books`, `sports`, `home`, `beauty`, `toys`
