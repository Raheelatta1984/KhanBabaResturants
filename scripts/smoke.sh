#!/usr/bin/env bash
# Route smoke test: boots nothing, assumes a server is already listening on $BASE.
# Logs in as the demo admin and checks that every page renders (HTTP 200) and the
# key JSON endpoints answer. Run by CI after `npm run build && npm run start`.
set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
JAR="$(mktemp)"
fail=0

check() {
  local path="$1"; shift
  local expected="${EXPECT:-200}"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" "$@" "$BASE$path")
  if [ "$code" = "$expected" ]; then
    echo "  ok   $code $path"
  else
    echo "  FAIL $code $path"
    fail=1
  fi
}

echo "Public pages"
for path in / /menu /menu/chicken-biryani /whats-new /checkout /table/T04 /order/KB-DEMO01 \
            /sitemap.xml /robots.txt /staff/login /api/health; do
  check "$path"
done

echo "Order intake"
check "/api/quote" -X POST -H 'content-type: application/json' \
  -d '{"channel":"pickup","items":[{"variantId":1,"qty":1}]}'

# Place a real order through the public API, then walk it through the state the
# pages read (tracking page + counter + kitchen) — this is the end-to-end flow a
# customer exercises, on whatever database the server was started with.
CODE=$(curl -s -X POST "$BASE/api/orders" -H 'content-type: application/json' \
  -d '{"channel":"pickup","customerName":"Smoke Test","phone":"0400000000","paymentMethod":"counter","items":[{"itemId":1,"variantId":1,"qty":1}]}' \
  | sed -n 's/.*"code":"\([^"]*\)".*/\1/p')
if [ -n "$CODE" ]; then
  echo "  ok   created order $CODE"
  check "/order/$CODE"
  check "/api/orders/$CODE"
else
  echo "  FAIL could not create an order"
  fail=1
fi

echo "Staff login"
code=$(curl -s -c "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/staff/login" \
  -H 'content-type: application/json' \
  -d '{"email":"admin@khanbaba.com.au","password":"KhanBaba2026!"}')
if [ "$code" = "200" ]; then echo "  ok   200 POST /api/staff/login"; else echo "  FAIL $code POST /api/staff/login"; fail=1; fi

echo "Portals + admin console"
for path in /counter /kitchen /delivery /admin /admin/orders /admin/menu /admin/menu/new /admin/reviews \
            /admin/production /admin/pricing /admin/delivery /admin/tables /admin/staff /admin/whats-new; do
  check "$path" -b "$JAR"
done

# Walk the order the counter/kitchen staff would: accept → take payment → bump →
# hand over, then run a production batch that posts material costs. This proves
# the write path (transactions, RETURNING id, cost postings) over real HTTP.
if [ -n "${CODE:-}" ]; then
  OID=$(curl -s -b "$JAR" "$BASE/counter" | grep -o 'data-order-id="[0-9]*"' | head -1 | grep -o '[0-9]*')
  if [ -n "$OID" ]; then
    echo "Staff workflow (order $OID)"
    for action in '{"action":"confirm"}' '{"action":"paid","method":"card"}' '{"action":"ready"}' '{"action":"collected"}'; do
      check "/api/ops/orders/$OID" -b "$JAR" -X POST -H 'content-type: application/json' -d "$action"
    done
  else
    echo "  FAIL no live order on the counter board"
    fail=1
  fi
fi

echo "Production + catalogue writes"
BATCH=$(curl -s -b "$JAR" -X POST "$BASE/api/ops/production" -H 'content-type: application/json' \
  -d '{"action":"start","recipeId":1,"plannedQty":10}' | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
if [ -n "$BATCH" ]; then
  echo "  ok   started batch $BATCH"
  check "/api/ops/production" -b "$JAR" -X POST -H 'content-type: application/json' \
    -d "{\"action\":\"complete\",\"batchId\":$BATCH}"
else
  echo "  FAIL could not start a production batch"
  fail=1
fi

echo "Admin JSON endpoints"
check "/api/ops/upload" -b "$JAR"
check "/api/ops/settings" -b "$JAR" -X POST -H 'content-type: application/json' \
  -d '{"values":{"restaurant_phone":"02 9000 1234"}}' 

rm -f "$JAR"
if [ "$fail" = "1" ]; then
  echo "Smoke test failed"
  exit 1
fi
echo "Smoke test passed"
