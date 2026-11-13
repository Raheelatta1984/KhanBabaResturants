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
            /track /login /login?mode=signup /t/demo-kb-demo01-token /api/orders/KB-DEMO01 \
            /sitemap.xml /robots.txt /staff/login /api/health; do
  check "$path"
done

echo "Unknown tracking token is a 404, not a crash"
EXPECT=404 check "/t/definitely-not-a-real-token"

echo "Order intake"
check "/api/quote" -X POST -H 'content-type: application/json' \
  -d '{"channel":"pickup","items":[{"variantId":1,"qty":1}]}'

# Place a real order through the public API, then walk it through the state the
# pages read (tracking page + counter + kitchen) — this is the end-to-end flow a
# customer exercises, on whatever database the server was started with.
ORDER_JSON=$(curl -s -X POST "$BASE/api/orders" -H 'content-type: application/json' \
  -d '{"channel":"pickup","customerName":"Smoke Test","phone":"0400000000","email":"smoke@example.com","paymentMethod":"counter","items":[{"itemId":1,"variantId":1,"qty":1}]}')
CODE=$(printf '%s' "$ORDER_JSON" | sed -n 's/.*"code":"\([^"]*\)".*/\1/p')
TOKEN=$(printf '%s' "$ORDER_JSON" | sed -n 's/.*"trackingToken":"\([^"]*\)".*/\1/p')
if [ -n "$CODE" ]; then
  echo "  ok   created order $CODE"
  check "/order/$CODE"
  check "/api/orders/$CODE"
else
  echo "  FAIL could not create an order"
  fail=1
fi
if [ -n "$TOKEN" ]; then
  echo "  ok   order has tracking token"
  check "/t/$TOKEN"
  check "/api/orders/$TOKEN"
else
  echo "  FAIL order JSON had no trackingToken"
  fail=1
fi

echo "Customer accounts"
CUSTJAR="$(mktemp)"
SIGNUP=$(curl -s -c "$CUSTJAR" -X POST "$BASE/api/customer/auth" -H 'content-type: application/json' \
  -d '{"mode":"signup","name":"Smoke Customer","email":"smoke-customer@example.com","password":"smoke-password-1"}')
if printf '%s' "$SIGNUP" | grep -q '"ok":true'; then
  echo "  ok   customer signup"
else
  echo "  FAIL customer signup: $SIGNUP"
  fail=1
fi
if curl -s -b "$CUSTJAR" "$BASE/account" | grep -q "Smoke Customer"; then
  echo "  ok   signed-in customer sees /account"
else
  echo "  FAIL /account did not render for the signed-in customer"
  fail=1
fi
code=$(curl -s -b "$CUSTJAR" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/customer/profile" \
  -H 'content-type: application/json' -d '{"name":"Smoke Customer","address":"1 Test Street","suburb":"Sydney","postcode":"2000"}')
if [ "$code" = "200" ]; then echo "  ok   200 POST /api/customer/profile"; else echo "  FAIL $code POST /api/customer/profile"; fail=1; fi
# Signing in again must work with the stored scrypt hash.
code=$(curl -s -c "$CUSTJAR" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/customer/auth" -H 'content-type: application/json' \
  -d '{"mode":"signin","email":"smoke-customer@example.com","password":"smoke-password-1"}')
if [ "$code" = "200" ]; then echo "  ok   200 customer signin"; else echo "  FAIL $code customer signin"; fail=1; fi
# A signed-in customer's new order lands in their history.
curl -s -b "$CUSTJAR" -X POST "$BASE/api/orders" -H 'content-type: application/json' \
  -d '{"channel":"pickup","customerName":"Smoke Customer","phone":"0400000000","paymentMethod":"counter","items":[{"itemId":1,"variantId":1,"qty":1}]}' > /dev/null
if curl -s -b "$CUSTJAR" "$BASE/account" | grep -q "KB-"; then
  echo "  ok   the order appears in the account history"
else
  echo "  FAIL the order did not appear in the account history"
  fail=1
fi
if curl -s "$BASE/account" -o /dev/null -w "%{http_code}" | grep -q 307; then
  echo "  ok   /account redirects when signed out"
else
  code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/account")
  if [ "$code" = "307" ] || [ "$code" = "302" ] || [ "$code" = "303" ]; then
    echo "  ok   /account redirects when signed out ($code)"
  else
    echo "  FAIL /account is reachable signed out ($code)"
    fail=1
  fi
fi

echo "Staff login"
code=$(curl -s -c "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/staff/login" \
  -H 'content-type: application/json' \
  -d '{"email":"admin@khanbaba.com.au","password":"KhanBaba2026!"}')
if [ "$code" = "200" ]; then echo "  ok   200 POST /api/staff/login"; else echo "  FAIL $code POST /api/staff/login"; fail=1; fi

echo "Portals + admin console"
for path in /counter /counter/customers /kitchen /delivery /admin /admin/orders /admin/menu /admin/menu/new /admin/reviews \
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
