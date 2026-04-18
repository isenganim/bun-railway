# Bun + Hono API

REST API built with Bun, Hono, PostgreSQL (Drizzle ORM), and Neo4j — ready to deploy on Railway.

## Stack

- **Runtime**: Bun
- **Framework**: Hono
- **Database**: PostgreSQL via Railway + Neo4j (graph recommendations)
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
- **Real-time Neo4j sync** — graph updated automatically on every order/review
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
# Edit DATABASE_URL, JWT_SECRET, NEO4J_* in .env

# Generate & run migrations
bunx drizzle-kit generate
bun run migrate

# Seed data
bun run seed
bun run seed:extra

# Sync existing data to Neo4j (first-time or recovery)
bun run neo4j:sync

# Dev server
bun run dev
```

## Deploy to Railway

1. Push to GitHub
2. Create a new project on [Railway](https://railway.app)
3. Add **PostgreSQL** and **Neo4j** services from Railway
4. Deploy repo — Railway auto-detects Bun via Railpack
5. Set environment variables: `DATABASE_URL`, `JWT_SECRET`, `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`
6. Run migrations on first deploy:
   ```bash
   bun run migrate && bun run src/index.ts
   ```

## Neo4j Sync

The API keeps the Neo4j graph in sync automatically:

| Event | Action |
| --- | --- |
| `POST /orders` | Creates `(User)-[:PURCHASED]->(Product)` for each item |
| `POST /reviews` | Creates `(User)-[:REVIEWED]->(Product)` |
| `DELETE /reviews/:id` | Removes the `[:REVIEWED]` relationship |

> Neo4j sync is **fire-and-forget** — if Neo4j is unreachable, orders and reviews still succeed. Errors are logged to the server console.

### End-to-End Sync Example

```bash
BASE="http://localhost:3000/api/v1"

# 1. Login
TOKEN=$(curl -s -X POST $BASE/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"john@example.com","password":"password123"}' | jq -r '.data.token')

# 2. Place order → auto-creates (User)-[:PURCHASED]->(Product) in Neo4j
curl -s -X POST $BASE/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "shippingAddress": "Jl. Sudirman No. 123, Jakarta",
    "items": [
      { "productId": 1, "quantity": 2 },
      { "productId": 3, "quantity": 1 }
    ]
  }' | jq

# 3. Submit review → auto-creates (User)-[:REVIEWED]->(Product) in Neo4j
REVIEW_ID=$(curl -s -X POST $BASE/reviews \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"productId": 1, "rating": 5, "comment": "Amazing!"}' | jq '.data.id')

# 4. Verify the graph was updated
curl -s http://localhost:3000/recommendations/graph-stats | jq

# 5. See recommendations powered by the new data
curl -s "$BASE/recommendations/products/1" | jq   # also-bought
curl -s "$BASE/recommendations/users/1" | jq       # personalized
curl -s "$BASE/recommendations/trending" | jq       # trending

# 6. Delete review → auto-removes [:REVIEWED] edge from Neo4j
curl -s -X DELETE $BASE/reviews/$REVIEW_ID \
  -H "Authorization: Bearer $TOKEN" | jq
```

### Manual Full Sync (first-time or recovery)

```bash
bun run neo4j:sync
```

This wipes the graph and rebuilds from PostgreSQL. Use after initial setup or if Neo4j was offline for a period.

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

| Method | Endpoint                      | Auth        | Description                               |
| ------ | ----------------------------- | ----------- | ----------------------------------------- |
| GET    | `/api/v1/orders`              | Admin/Mod   | List orders + user info                   |
| GET    | `/api/v1/orders/:id`          | Owner/Staff | Order detail + items                      |
| GET    | `/api/v1/orders/:id/tracking` | Owner/Staff | Tracking info + status history            |
| POST   | `/api/v1/orders`              | JWT         | Place order (coupon support) → syncs Neo4j |
| PATCH  | `/api/v1/orders/:id/status`   | Admin/Mod   | Update status + tracking + notification   |

### Reviews

| Method | Endpoint                             | Auth      | Description                              |
| ------ | ------------------------------------ | --------- | ---------------------------------------- |
| GET    | `/api/v1/reviews/product/:productId` | -         | Reviews per product + stats              |
| POST   | `/api/v1/reviews`                    | JWT       | Submit review (Zod validated) → syncs Neo4j |
| DELETE | `/api/v1/reviews/:id`                | Admin/Mod | Delete review → removes from Neo4j      |

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

### Recommendations (Neo4j)

| Method | Endpoint                                    | Description                        |
| ------ | ------------------------------------------- | ---------------------------------- |
| GET    | `/api/v1/recommendations/products/:id`      | "Users who bought this also bought..." |
| GET    | `/api/v1/recommendations/users/:id`         | Personalized recommendations       |
| GET    | `/api/v1/recommendations/trending`          | Trending products                  |
| GET    | `/api/v1/recommendations/similar-users/:id` | Similar users by purchase pattern  |
| GET    | `/api/v1/recommendations/graph-stats`       | Neo4j graph overview               |

### Health & Meta

| Endpoint        | Description                         |
| --------------- | ----------------------------------- |
| `GET /`         | API info + route index              |
| `GET /health`   | Server health                       |
| `GET /health/db`| PostgreSQL + Neo4j connectivity     |
| `GET /stats`    | Row counts across all tables        |
| `GET /docs`     | Interactive API docs (Scalar UI)    |
| `GET /openapi.json` | OpenAPI 3.1 spec               |

## Query Parameters

```http
GET /api/v1/products?page=1&limit=20&search=iphone&category=electronics&minPrice=100&maxPrice=1000&sort=price_asc
GET /api/v1/users?page=1&limit=20&search=budi
GET /api/v1/orders?page=1&limit=20
GET /api/v1/notifications/users/1?unread=true
```

Product sort values: `price_asc`, `price_desc` (default: newest first)  
Product categories: `electronics`, `clothing`, `food`, `books`, `sports`, `home`, `beauty`, `toys`

## Example Requests

```bash
# Register
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"John","email":"john@example.com","username":"john","password":"password123"}'

# Login — save token
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"john@example.com","password":"password123"}' | jq -r '.data.token')

# Create product (admin)
curl -X POST http://localhost:3000/api/v1/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"iPhone 15","price":999,"stock":50,"category":"electronics"}'

# Create order with coupon (syncs Neo4j automatically)
curl -X POST http://localhost:3000/api/v1/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "shippingAddress": "Jl. Sudirman No. 123, Jakarta",
    "couponCode": "SAVE10",
    "items": [
      { "productId": 1, "quantity": 2 }
    ]
  }'

# Get personalized recommendations
curl http://localhost:3000/api/v1/recommendations/users/1

# Add to wishlist
curl -X POST http://localhost:3000/api/v1/wishlists/users/1 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"productId": 5}'
```
