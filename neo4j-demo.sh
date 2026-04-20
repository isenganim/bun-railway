#!/usr/bin/env bash
# =============================================================================
# neo4j-demo.sh — Simulate purchases & reviews, then explore Neo4j graph
# =============================================================================
# What this script does:
#   1. Login as 5 regular users → each places 2-3 orders with multiple items
#   2. Each user submits reviews on the products they bought
#   3. Login as moderator → update order statuses
#   4. Query Neo4j-powered recommendations to see the graph in action
#
# Usage:
#   chmod +x neo4j-demo.sh
#   ./neo4j-demo.sh                                  # defaults to localhost:3000
#   BASE_URL=https://your-railway-url.railway.app ./neo4j-demo.sh
# =============================================================================

BASE_URL="${BASE_URL:-http://flpxteaiw1rsjdfka4cjh0pu.16.78.105.220.sslip.io}"
API="$BASE_URL/api/v1"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

# ── helpers ───────────────────────────────────────────────────────────────────

info()    { echo -e "${CYAN}[info]${RESET} $*"; }
success() { echo -e "${GREEN}[ok]${RESET}   $*"; }
warn()    { echo -e "${YELLOW}[warn]${RESET} $*"; }
header()  { echo -e "\n${BOLD}${YELLOW}══════════════════════════════════════════════${RESET}"; echo -e "${BOLD}${YELLOW}  $*${RESET}"; echo -e "${BOLD}${YELLOW}══════════════════════════════════════════════${RESET}"; }
divider() { echo -e "${CYAN}──────────────────────────────────────────────${RESET}"; }

# Login and return JWT token
login() {
  local email="$1" password="$2"
  local token
  token=$(curl -s -X POST "$API/auth/login" \
    -H "content-type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$password\"}" \
    | jq -r '.data.token // empty')

  if [ -z "$token" ]; then
    warn "Login failed for $email"
    echo ""
  else
    echo "$token"
  fi
}

# Place an order and return order id
place_order() {
  local token="$1" address="$2" items_json="$3"
  curl -s -X POST "$API/orders" \
    -H "content-type: application/json" \
    -H "Authorization: Bearer $token" \
    -d "{\"shippingAddress\":\"$address\",\"items\":$items_json}" \
    | jq -r '.data.id // empty'
}

# Submit a review and return review id
submit_review() {
  local token="$1" product_id="$2" rating="$3" comment="$4"
  curl -s -X POST "$API/reviews" \
    -H "content-type: application/json" \
    -H "Authorization: Bearer $token" \
    -d "{\"productId\":$product_id,\"rating\":$rating,\"comment\":\"$comment\"}" \
    | jq -r '.data.id // empty'
}

# Update order status as moderator
update_status() {
  local token="$1" order_id="$2" status="$3" note="$4"
  local result
  result=$(curl -s -X PATCH "$API/orders/$order_id/status" \
    -H "content-type: application/json" \
    -H "Authorization: Bearer $token" \
    -d "{\"status\":\"$status\",\"note\":\"$note\"}")
  echo "$result" | jq -r '.data.status // .error // "failed"'
}

# Check if jq is available
if ! command -v jq &>/dev/null; then
  echo -e "${RED}Error: jq is required. Install it with: sudo apt install jq${RESET}"
  exit 1
fi

# =============================================================================
# STEP 0 — Graph stats BEFORE
# =============================================================================
header "STEP 0 — Neo4j Graph Stats BEFORE"
info "Checking current graph state..."
STATS_BEFORE=$(curl -s "$API/recommendations/graph-stats")
echo "$STATS_BEFORE" | jq
divider

# =============================================================================
# STEP 1 — Login users
# =============================================================================
header "STEP 1 — Logging in users"

# Seed: user_001=admin(inactive), user_002-005=moderator, user_006+=user
# Active regular users start at user_006

info "Logging in moderator (user_002)..."
MOD_TOKEN=$(login "user_002@example.com" "password123")
[ -n "$MOD_TOKEN" ] && success "Moderator logged in" || { warn "Moderator login failed. Exiting."; exit 1; }

info "Logging in 5 regular users..."
U1=$(login "user_006@example.com" "password123")
U2=$(login "user_007@example.com" "password123")
U3=$(login "user_008@example.com" "password123")
U4=$(login "user_009@example.com" "password123")
U5=$(login "user_010@example.com" "password123")

[ -n "$U1" ] && success "user_006 logged in" || warn "user_006 login failed"
[ -n "$U2" ] && success "user_007 logged in" || warn "user_007 login failed"
[ -n "$U3" ] && success "user_008 logged in" || warn "user_008 login failed"
[ -n "$U4" ] && success "user_009 logged in" || warn "user_009 login failed"
[ -n "$U5" ] && success "user_010 logged in" || warn "user_010 login failed"
divider

# =============================================================================
# STEP 2 — Users place orders (products 1-30 from seed)
# =============================================================================
header "STEP 2 — Users Place Orders"
info "Each user places 2-3 orders. Neo4j PURCHASED edges will be created automatically."
echo ""

ORDER_IDS=()

# user_006 — buys electronics cluster (products 1,2,3 and 4,5)
info "user_006 buying electronics (products 1,2,3)..."
OID=$(place_order "$U1" "Jl. Sudirman No. 10, Jakarta" '[{"productId":1,"quantity":2},{"productId":2,"quantity":1},{"productId":3,"quantity":1}]')
[ -n "$OID" ] && { success "Order #$OID created"; ORDER_IDS+=("$OID:$MOD_TOKEN"); } || warn "Order failed"

info "user_006 buying more electronics (products 4,5)..."
OID=$(place_order "$U1" "Jl. Sudirman No. 10, Jakarta" '[{"productId":4,"quantity":1},{"productId":5,"quantity":2}]')
[ -n "$OID" ] && { success "Order #$OID created"; ORDER_IDS+=("$OID:$MOD_TOKEN"); } || warn "Order failed"

# user_007 — buys overlapping products with user_006 (products 1,2) + new ones (6,7)
info "user_007 buying products 1,2,6,7 (overlap with user_006)..."
OID=$(place_order "$U2" "Jl. Gatot Subroto No. 45, Jakarta" '[{"productId":1,"quantity":1},{"productId":2,"quantity":1},{"productId":6,"quantity":1},{"productId":7,"quantity":1}]')
[ -n "$OID" ] && { success "Order #$OID created"; ORDER_IDS+=("$OID:$MOD_TOKEN"); } || warn "Order failed"

info "user_007 buying products 8,9,10..."
OID=$(place_order "$U2" "Jl. Gatot Subroto No. 45, Jakarta" '[{"productId":8,"quantity":2},{"productId":9,"quantity":1},{"productId":10,"quantity":3}]')
[ -n "$OID" ] && { success "Order #$OID created"; ORDER_IDS+=("$OID:$MOD_TOKEN"); } || warn "Order failed"

# user_008 — buys products 1,3,11,12 (shares 1,3 with user_006)
info "user_008 buying products 1,3,11,12 (shares with user_006)..."
OID=$(place_order "$U3" "Jl. Pemuda No. 78, Surabaya" '[{"productId":1,"quantity":1},{"productId":3,"quantity":1},{"productId":11,"quantity":1},{"productId":12,"quantity":2}]')
[ -n "$OID" ] && { success "Order #$OID created"; ORDER_IDS+=("$OID:$MOD_TOKEN"); } || warn "Order failed"

info "user_008 buying products 13,14,15..."
OID=$(place_order "$U3" "Jl. Pemuda No. 78, Surabaya" '[{"productId":13,"quantity":1},{"productId":14,"quantity":1},{"productId":15,"quantity":1}]')
[ -n "$OID" ] && { success "Order #$OID created"; ORDER_IDS+=("$OID:$MOD_TOKEN"); } || warn "Order failed"

# user_009 — buys products 2,6,16,17 (shares 2,6 with user_007)
info "user_009 buying products 2,6,16,17 (shares 2,6 with user_007)..."
OID=$(place_order "$U4" "Jl. Malioboro No. 56, Yogyakarta" '[{"productId":2,"quantity":1},{"productId":6,"quantity":2},{"productId":16,"quantity":1},{"productId":17,"quantity":1}]')
[ -n "$OID" ] && { success "Order #$OID created"; ORDER_IDS+=("$OID:$MOD_TOKEN"); } || warn "Order failed"

# user_010 — buys products 1,2,3,18,19,20 (heavy overlap → strong "also bought" signal)
info "user_010 buying products 1,2,3,18,19,20 (lots of overlap)..."
OID=$(place_order "$U5" "Jl. Asia Afrika No. 12, Bandung" '[{"productId":1,"quantity":1},{"productId":2,"quantity":1},{"productId":3,"quantity":1},{"productId":18,"quantity":2}]')
[ -n "$OID" ] && { success "Order #$OID created"; ORDER_IDS+=("$OID:$MOD_TOKEN"); } || warn "Order failed"

info "user_010 buying products 19,20..."
OID=$(place_order "$U5" "Jl. Asia Afrika No. 12, Bandung" '[{"productId":19,"quantity":1},{"productId":20,"quantity":1}]')
[ -n "$OID" ] && { success "Order #$OID created"; ORDER_IDS+=("$OID:$MOD_TOKEN"); } || warn "Order failed"

echo ""
info "Total orders placed: ${#ORDER_IDS[@]}"
divider

# =============================================================================
# STEP 3 — Users submit reviews
# =============================================================================
header "STEP 3 — Users Submit Reviews"
info "Reviews create (User)-[:REVIEWED]->(Product) edges in Neo4j."
echo ""

REVIEW_IDS=()

RID=$(submit_review "$U1" 1 5 "Produk sangat bagus, sesuai ekspektasi!"); [ -n "$RID" ] && { success "Review #$RID: user_006 rated product 1 ★★★★★"; REVIEW_IDS+=("$RID:$U1"); }
RID=$(submit_review "$U1" 2 4 "Kualitas oke, pengiriman cepat."); [ -n "$RID" ] && { success "Review #$RID: user_006 rated product 2 ★★★★"; REVIEW_IDS+=("$RID:$U1"); }
RID=$(submit_review "$U2" 1 5 "Recommended banget!"); [ -n "$RID" ] && success "Review #$RID: user_007 rated product 1 ★★★★★"
RID=$(submit_review "$U2" 6 3 "Lumayan, sesuai harga."); [ -n "$RID" ] && success "Review #$RID: user_007 rated product 6 ★★★"
RID=$(submit_review "$U3" 3 5 "Barang original, puas!"); [ -n "$RID" ] && success "Review #$RID: user_008 rated product 3 ★★★★★"
RID=$(submit_review "$U3" 11 4 "Mantap jiwa!"); [ -n "$RID" ] && success "Review #$RID: user_008 rated product 11 ★★★★"
RID=$(submit_review "$U4" 2 5 "Worth it banget!"); [ -n "$RID" ] && success "Review #$RID: user_009 rated product 2 ★★★★★"
RID=$(submit_review "$U5" 1 4 "Seller responsif, barang bagus."); [ -n "$RID" ] && success "Review #$RID: user_010 rated product 1 ★★★★"
RID=$(submit_review "$U5" 19 5 "Sangat puas, akan order lagi!"); [ -n "$RID" ] && success "Review #$RID: user_010 rated product 19 ★★★★★"

echo ""
info "Reviews submitted. Last review ID: $RID"
divider

# =============================================================================
# STEP 4 — Moderator updates order statuses
# =============================================================================
header "STEP 4 — Moderator Updates Order Statuses"
info "Simulating order fulfillment pipeline..."
echo ""

STATUSES=("processing" "shipped" "delivered")
STATUS_NOTES=("Order confirmed and being processed" "Shipped via JNE Express" "Package delivered successfully")

for entry in "${ORDER_IDS[@]}"; do
  OID="${entry%%:*}"
  # Walk through each status sequentially: pending → processing → shipped → delivered
  for IDX in 0 1 2; do
    STATUS="${STATUSES[$IDX]}"
    NOTE="${STATUS_NOTES[$IDX]}"
    NEW_STATUS=$(update_status "$MOD_TOKEN" "$OID" "$STATUS" "$NOTE")
    success "Order #$OID → $NEW_STATUS"
    sleep 0.3
  done
  echo ""
done

divider

# =============================================================================
# STEP 5 — Graph stats AFTER
# =============================================================================
header "STEP 5 — Neo4j Graph Stats AFTER"
info "Comparing graph before and after the simulation..."
echo ""

STATS_AFTER=$(curl -s "$API/recommendations/graph-stats")
echo "$STATS_AFTER" | jq

echo ""
BEFORE_PURCHASES=$(echo "$STATS_BEFORE" | jq '.data.totalPurchases')
AFTER_PURCHASES=$(echo "$STATS_AFTER" | jq '.data.totalPurchases')
BEFORE_REVIEWS=$(echo "$STATS_BEFORE" | jq '.data.totalReviews')
AFTER_REVIEWS=$(echo "$STATS_AFTER" | jq '.data.totalReviews')

echo -e "  PURCHASED edges: ${BEFORE_PURCHASES} → ${GREEN}${AFTER_PURCHASES}${RESET}  (+$((AFTER_PURCHASES - BEFORE_PURCHASES)))"
echo -e "  REVIEWED  edges: ${BEFORE_REVIEWS} → ${GREEN}${AFTER_REVIEWS}${RESET}  (+$((AFTER_REVIEWS - BEFORE_REVIEWS)))"
divider

# =============================================================================
# STEP 6 — Query Neo4j Recommendations
# =============================================================================
header "STEP 6 — Neo4j Recommendations in Action"

# 6a. "Also bought" for product 1
# Expected: products 2,3,4,5,6,... (all products bought by users who also bought product 1)
echo ""
info "📦 'Customers also bought' for Product 1:"
info "   (user_006, user_007, user_008, user_009, user_010 all bought product 1)"
curl -s "$API/recommendations/products/1?limit=8" | jq '.data[] | "  → [\(.score) buyers] \(.name)"'

# 6b. "Also bought" for product 2
echo ""
info "📦 'Customers also bought' for Product 2:"
info "   (user_006, user_007, user_009, user_010 bought product 2)"
curl -s "$API/recommendations/products/2?limit=8" | jq '.data[] | "  → [\(.score) buyers] \(.name)"'

# 6c. Personalized recommendations for user_006 (id=6)
echo ""
info "🎯 Personalized recommendations for user_006:"
info "   Finds products bought by similar users (user_007, user_008, user_010)"
info "   that user_006 hasn't bought yet..."
curl -s "$API/recommendations/users/6?limit=8" | jq '.data[] | "  → [\(.commonBuyers) common buyers | avg ★\(.avgRating)] \(.name)"'

# 6d. Similar users to user_006 (id=6)
echo ""
info "👥 Users similar to user_006 (by shared purchases):"
curl -s "$API/recommendations/similar-users/6?limit=5" | jq '.data[] | "  → \(.username) (\(.sharedProducts) shared products)"'

# 6e. Trending products
echo ""
info "🔥 Trending products across all users:"
curl -s "$API/recommendations/trending?limit=8" | jq '.data[] | "  → [\(.purchases) purchases | avg ★\(.avgRating)] \(.name)"'

divider

# =============================================================================
# STEP 7 — Cleanup demo: delete one review (removes Neo4j edge)
# =============================================================================
header "STEP 7 — Cleanup: Delete a Review (Neo4j edge removed)"

if [ "${#REVIEW_IDS[@]}" -gt 0 ]; then
  FIRST_REVIEW="${REVIEW_IDS[0]%%:*}"
  FIRST_TOKEN="${REVIEW_IDS[0]##*:}"
  info "Deleting review #$FIRST_REVIEW (as user_006)..."

  # Note: user can't delete own review — only admin/mod can. Use mod token.
  RESULT=$(curl -s -X DELETE "$API/reviews/$FIRST_REVIEW" \
    -H "Authorization: Bearer $MOD_TOKEN")
  echo "$RESULT" | jq '.data.message // .error'

  info "Graph stats after deleting review #$FIRST_REVIEW:"
  curl -s "$API/recommendations/graph-stats" | jq '.data.totalReviews'
else
  warn "No review IDs tracked, skipping cleanup step."
fi

divider

# =============================================================================
# DONE
# =============================================================================
echo ""
echo -e "${BOLD}${GREEN}✅  Demo complete!${RESET}"
echo ""
echo -e "  Orders created   : ${#ORDER_IDS[@]}"
echo -e "  Reviews submitted: ${#REVIEW_IDS[@]}"
echo ""
echo -e "  Try these manually:"
echo -e "  ${CYAN}curl -s $API/recommendations/products/1 | jq${RESET}"
echo -e "  ${CYAN}curl -s $API/recommendations/users/6 | jq${RESET}"
echo -e "  ${CYAN}curl -s $API/recommendations/trending | jq${RESET}"
echo -e "  ${CYAN}curl -s $API/recommendations/graph-stats | jq${RESET}"
echo ""
