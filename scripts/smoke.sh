#!/usr/bin/env bash
# Route smoke test: boots nothing, assumes a server is already listening on $BASE.
# Logs in as the demo admin and checks that every page renders (HTTP 200) and the
# key JSON endpoints answer — including promotions, driver onboarding, live maps,
# ATO CSV, community claims, the detached Square bridge and the new admin pages.
# Run by CI after `npm run build && npm run start`.
# It ends by retiring the demo credentials, so run it once against a fresh database.
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
            /order/KB-DEMO07 /track /login /login?mode=signup /t/demo-kb-demo01-token \
            /api/orders/KB-DEMO01 /api/orders/KB-DEMO07 /community \
            /community/demo-community-offer /community/demo-community-claimed \
            /driver/apply /api/community/offers \
            /sitemap.xml /robots.txt /staff/login /api/health; do
  check "$path"
done

echo "Unknown tracking token is a 404, not a crash"
EXPECT=404 check "/t/definitely-not-a-real-token"

echo "Order intake"
check "/api/quote" -X POST -H 'content-type: application/json' \
  -d '{"channel":"pickup","items":[{"variantId":1,"qty":1}]}'

echo "Promotion preview, delivery coordinates and payment options"
PROMO_QUOTE=$(curl -s -X POST "$BASE/api/quote" -H 'content-type: application/json' \
  -d '{"channel":"pickup","items":[{"variantId":1,"qty":2}],"promoCode":"WELCOME10"}')
if printf '%s' "$PROMO_QUOTE" | grep -q '"code":"WELCOME10"'; then
  echo "  ok   WELCOME10 previewed and re-validated on the server"
else
  echo "  FAIL promotion preview: $PROMO_QUOTE"
  fail=1
fi
DELIVERY_QUOTE=$(curl -s -X POST "$BASE/api/quote" -H 'content-type: application/json' \
  -d '{"channel":"delivery","address":"1 Test Street","suburb":"Sydney","postcode":"2000","deliveryLat":-33.8711,"deliveryLng":151.2063,"items":[{"variantId":1,"qty":3}]}')
QUOTE_TOKEN=$(printf '%s' "$DELIVERY_QUOTE" | grep -o '"quoteToken":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -n "$QUOTE_TOKEN" ]; then
  echo "  ok   delivery quote carries a signed token"
else
  echo "  FAIL delivery quote token: $DELIVERY_QUOTE"
  fail=1
fi
PROMO_ORDER_JSON=$(curl -s -X POST "$BASE/api/orders" -H 'content-type: application/json' \
  -d "{\"channel\":\"delivery\",\"customerName\":\"Promo Smoke\",\"phone\":\"0400000001\",\"email\":\"promo@example.com\",\"address\":\"1 Test Street\",\"suburb\":\"Sydney\",\"postcode\":\"2000\",\"deliveryLat\":-33.8711,\"deliveryLng\":151.2063,\"paymentMethod\":\"online\",\"paymentOption\":\"card_visa\",\"paymentLast4\":\"4242\",\"promoCode\":\"WELCOME10\",\"quoteToken\":\"$QUOTE_TOKEN\",\"items\":[{\"itemId\":1,\"variantId\":1,\"qty\":3}]}")
PROMO_ORDER_CODE=$(printf '%s' "$PROMO_ORDER_JSON" | sed -n 's/.*"code":"\([^"]*\)".*/\1/p')
if [ -n "$PROMO_ORDER_CODE" ] && \
   curl -s "$BASE/api/orders/$PROMO_ORDER_CODE" | grep -q '"promotionCode":"WELCOME10"' && \
   curl -s "$BASE/api/orders/$PROMO_ORDER_CODE" | grep -q '"paymentOptionLabel":"Visa"' && \
   curl -s "$BASE/api/orders/$PROMO_ORDER_CODE" | grep -q '"deliveryLat":-33.8711'; then
  echo "  ok   promo, option and latitude/longitude persisted on the order"
  check "/order/$PROMO_ORDER_CODE"
else
  echo "  FAIL promo/options/coordinates order: $PROMO_ORDER_JSON"
  fail=1
fi

echo "Driver onboarding"
DRIVER_APPLY=$(curl -s -X POST "$BASE/api/driver/apply" -H 'content-type: application/json' \
  -d '{"firstName":"Smoke","lastName":"Driver","email":"smoke.driver@example.com","phone":"0400000002","vehicleType":"car","licenceNumber":"NSW-SMOKE-1","abn":"12345678901","rightToWorkCountry":"Australia","payId":"smoke.driver@example.com","address":"2 Test Street","suburb":"Sydney","postcode":"2000","baseLat":-33.8701,"baseLng":151.2071,"termsAccepted":true,"privacyAccepted":true,"documents":{"photo_id":"SMOKE-ID","licence":"NSW-SMOKE-1"}}')
if printf '%s' "$DRIVER_APPLY" | grep -q '"ok":true'; then
  echo "  ok   driver application created with verification records"
else
  echo "  FAIL driver application: $DRIVER_APPLY"
  fail=1
fi

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
            /admin/production /admin/pricing /admin/promotions /admin/drivers /admin/community \
            /admin/integrations /admin/delivery /admin/tables /admin/staff /admin/whats-new; do
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
check "/api/ops/square" -b "$JAR"
check "/api/ops/tracking" -b "$JAR"
check "/api/ops/drivers/ato-report?driver=1&fy=2026-27" -b "$JAR"
EXPECT=201 check "/api/ops/promotions" -b "$JAR" -X POST -H 'content-type: application/json' \
  -d '{"action":"create","code":"SMOKE5","name":"Smoke test offer","audience":"customer","kind":"flat","value":500}'
EXPECT=503 check "/api/ops/square/cron"

echo "Returns → community in need"
RETURN_JSON=$(curl -s -b "$JAR" -X POST "$BASE/api/ops/community" -H 'content-type: application/json' \
  -d '{"action":"create_return","orderCode":"KB-DEMO02","resolution":"community","reason":"Smoke test community redirect"}')
if printf '%s' "$RETURN_JSON" | grep -q '"ok":true'; then
  echo "  ok   return logged and community post published"
else
  echo "  FAIL community return: $RETURN_JSON"
  fail=1
fi
OFFERS_JSON=$(curl -s "$BASE/api/community/offers")
COMMUNITY_TOKEN=$(printf '%s' "$OFFERS_JSON" | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -n "$COMMUNITY_TOKEN" ]; then
  CLAIM_JSON=$(curl -s -X POST "$BASE/api/community/offers/$COMMUNITY_TOKEN/claim" \
    -H 'content-type: application/json' -d '{"name":"Smoke Neighbour","keyword":"MINE"}')
  CLAIM_ORDER_CODE=$(printf '%s' "$CLAIM_JSON" | grep -o '"claimOrderCode":"[^"]*"' | head -1 | cut -d'"' -f4)
  if printf '%s' "$CLAIM_JSON" | grep -q '"autoReply":"thank you we have got it booked"' && \
     [ -n "$CLAIM_ORDER_CODE" ]; then
    echo "  ok   first comment wins with the exact auto-reply"
    check "/order/$CLAIM_ORDER_CODE"
  else
    echo "  FAIL community claim: $CLAIM_JSON"
    fail=1
  fi
  EXPECT=409 check "/api/community/offers/$COMMUNITY_TOKEN/claim" -X POST \
    -H 'content-type: application/json' -d '{"name":"Too Late","keyword":"MINE"}'
else
  echo "  FAIL no community offer token: $OFFERS_JSON"
  fail=1
fi

# Users & access over real HTTP: the cookie has to stop working the moment an
# account is reset or disabled, and going live has to retire the demo logins.
echo "Users & access"
post() { # post <jar-flag> <jar> <path> <json>  → prints the status code
  curl -s "$1" "$2" -o /dev/null -w "%{http_code}" -X POST "$BASE$3" -H 'content-type: application/json' -d "$4"
}
expect() { # expect <label> <want> <got>
  if [ "$2" = "$3" ]; then echo "  ok   $1"; else echo "  FAIL $1 (wanted $2, got $3)"; fail=1; fi
}
check "/staff/password" -b "$JAR"
if curl -s "$BASE/staff/login" | grep -q "Demo accounts"; then echo "  ok   demo logins listed before go-live"; else echo "  FAIL demo logins not listed before go-live"; fail=1; fi

expect "create a kitchen login" 201 "$(post -b "$JAR" /api/ops/staff '{"action":"create","name":"Smoke Cook","email":"smoke-cook@khanbaba.com.au","role":"kitchen","password":"smoke-cook-pass-1"}')"
expect "demo password refused for a new login" 400 "$(post -b "$JAR" /api/ops/staff '{"action":"create","name":"Lazy","email":"lazy@khanbaba.com.au","role":"kitchen","password":"KhanBaba2026!"}')"
COOKJAR="$(mktemp)"
expect "new login signs in" 200 "$(post -c "$COOKJAR" /api/staff/login '{"email":"smoke-cook@khanbaba.com.au","password":"smoke-cook-pass-1"}')"
check "/kitchen" -b "$COOKJAR"
expect "kitchen role cannot administer users" 401 "$(post -b "$COOKJAR" /api/ops/staff '{"action":"create","name":"X Y","email":"x@khanbaba.com.au","role":"admin","password":"whatever-pass-1"}')"
COOK_ID=$(curl -s -b "$JAR" "$BASE/admin/staff" | grep -o 'smoke-cook@khanbaba.com.au' | head -1)
expect "new login appears on Users & access" "smoke-cook@khanbaba.com.au" "$COOK_ID"

expect "wrong current password refused" 403 "$(post -b "$COOKJAR" /api/staff/password '{"currentPassword":"nope","newPassword":"smoke-cook-pass-2"}')"
OLDCOOK="$(mktemp)"; cp "$COOKJAR" "$OLDCOOK"
code=$(curl -s -b "$COOKJAR" -c "$COOKJAR" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/staff/password" -H 'content-type: application/json' \
  -d '{"currentPassword":"smoke-cook-pass-1","newPassword":"smoke-cook-pass-2"}')
expect "change own password" 200 "$code"
check "/kitchen" -b "$COOKJAR"
expect "the session from before the change is signed out" 401 "$(post -b "$OLDCOOK" /api/staff/password '{"currentPassword":"smoke-cook-pass-2","newPassword":"smoke-cook-pass-3"}')"
code=$(curl -s -b "$OLDCOOK" -o /dev/null -w "%{http_code}" "$BASE/kitchen")
expect "…and its pages redirect to sign-in" 307 "$code"

expect "go-live needs a new admin password" 400 "$(post -b "$JAR" /api/ops/staff '{"action":"go_live"}')"
code=$(curl -s -b "$JAR" -c "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/ops/staff" -H 'content-type: application/json' \
  -d '{"action":"go_live","password":"smoke-owner-pass-1"}')
expect "go-live" 200 "$code"
check "/admin/staff" -b "$JAR"
if curl -s "$BASE/staff/login" | grep -q "KhanBaba2026"; then echo "  FAIL sign-in page still prints the demo password"; fail=1; else echo "  ok   sign-in page no longer prints the demo password"; fi
expect "demo admin password no longer works" 401 "$(post -c /dev/null /api/staff/login '{"email":"admin@khanbaba.com.au","password":"KhanBaba2026!"}')"
expect "demo counter login is disabled" 401 "$(post -c /dev/null /api/staff/login '{"email":"counter@khanbaba.com.au","password":"KhanBaba2026!"}')"
expect "demo customer login is gone" 401 "$(post -c /dev/null /api/customer/auth '{"mode":"signin","email":"ayesha@example.com","password":"KhanBaba2026!"}')"
expect "admin signs in with the new password" 200 "$(post -c /dev/null /api/staff/login '{"email":"admin@khanbaba.com.au","password":"smoke-owner-pass-1"}')"
check "/kitchen" -b "$COOKJAR"
rm -f "$COOKJAR" "$OLDCOOK"

rm -f "$JAR"
if [ "$fail" = "1" ]; then
  echo "Smoke test failed"
  exit 1
fi
echo "Smoke test passed"
