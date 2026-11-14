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
            /driver/apply /api/community/offers /music /pay/demo-pay-kb-demo10 \
            /feedback/demo-feedback-kb-demo08 /api/music/now \
            "/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=&hub.challenge=smoke" \
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
for path in /counter /counter/customers /counter/music /kitchen /delivery /admin /admin/hub /admin/whatsapp \
            /admin/music /admin/feedback /admin/orders /admin/menu /admin/menu/new /admin/reviews \
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

echo "Lahore music system"
NOW_JSON=$(curl -s "$BASE/api/music/now")
if printf '%s' "$NOW_JSON" | grep -q '"enabled"'; then
  echo "  ok   the shared player reports a snapshot"
else
  echo "  FAIL music snapshot: $NOW_JSON"
  fail=1
fi
for action in pause resume replay next; do
  code=$(curl -s -b "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/ops/music" \
    -H 'content-type: application/json' -d "{\"action\":\"$action\"}")
  if [ "$code" = "200" ]; then echo "  ok   200 music $action"; else echo "  FAIL $code music $action"; fail=1; fi
done
MUSIC_TRACK=$(curl -s -b "$JAR" -X POST "$BASE/api/ops/music" -H 'content-type: application/json' \
  -d '{"action":"create-track","title":"Smoke track","url":"https://example.com/smoke.mp3","kind":"music","category":"ghazal"}')
if printf '%s' "$MUSIC_TRACK" | grep -q '"ok":true'; then
  echo "  ok   a track can be loaded from the counter/admin console"
else
  echo "  FAIL create track: $MUSIC_TRACK"
  fail=1
fi
if curl -s -X POST "$BASE/api/music/request" -H 'content-type: application/json' \
   -d '{"customerName":"Smoke Guest","title":"No link","url":"nope"}' | grep -q 'link to the song is required'; then
  echo "  ok   a guest song request needs a URL"
else
  echo "  FAIL song request without a URL was accepted"
  fail=1
fi
REQUEST_JSON=$(curl -s -X POST "$BASE/api/music/request" -H 'content-type: application/json' \
  -d '{"customerName":"Smoke Guest","title":"Smoke request","url":"https://example.com/song.mp3","tableCode":"T04"}')
if printf '%s' "$REQUEST_JSON" | grep -q '"ok":true'; then
  echo "  ok   a guest song request lands pending for staff"
else
  echo "  FAIL guest song request: $REQUEST_JSON"
  fail=1
fi

echo "WhatsApp Business (sandbox)"
WA_TEST=$(curl -s -b "$JAR" -X POST "$BASE/api/ops/whatsapp" -H 'content-type: application/json' -d '{"action":"test","to":"+61400000000"}')
if printf '%s' "$WA_TEST" | grep -q '"ok":true'; then
  echo "  ok   sandbox test message logged"
else
  echo "  FAIL WhatsApp test message: $WA_TEST"
  fail=1
fi
WA_SYNC=$(curl -s -b "$JAR" -X POST "$BASE/api/ops/whatsapp" -H 'content-type: application/json' -d '{"action":"sync"}')
if printf '%s' "$WA_SYNC" | grep -q '"published"'; then
  echo "  ok   the menu publishes to the WhatsApp catalogue (sandbox)"
else
  echo "  FAIL WhatsApp catalogue sync: $WA_SYNC"
  fail=1
fi
WA_INBOUND=$(curl -s -X POST "$BASE/api/webhooks/whatsapp" -H 'content-type: application/json' \
  -d '{"object":"whatsapp_business_account","entry":[{"changes":[{"field":"messages","value":{"contacts":[{"profile":{"name":"Smoke Wa"},"wa_id":"61400000999"}],"messages":[{"id":"wamid.smoke-1","from":"61400000999","type":"text","text":{"body":"1 chicken biryani table 4"}}]}}]}]}')
WA_ORDER=$(printf '%s' "$WA_INBOUND" | grep -o '"orderCode":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -n "$WA_ORDER" ]; then
  echo "  ok   an inbound WhatsApp message created $WA_ORDER"
  check "/order/$WA_ORDER"
  PAY_CODE=$(curl -s -b "$JAR" -X POST "$BASE/api/ops/orders/$WA_ORDER" -H 'content-type: application/json' \
    -d '{"action":"payment-link"}' | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [ -n "$PAY_CODE" ]; then
    echo "  ok   a secure payment link was minted"
    check "/pay/$PAY_CODE"
    if curl -s -X POST "$BASE/api/pay/$PAY_CODE" -H 'content-type: application/json' \
       -d '{"option":"card_visa"}' | grep -q '"paid":true'; then
      echo "  ok   the guest pays through the link (sandbox gateway)"
    else
      echo "  FAIL payment through the link"
      fail=1
    fi
    code=$(curl -s -b "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/ops/orders/$WA_ORDER" \
      -H 'content-type: application/json' -d '{"action":"confirm"}')
    if [ "$code" = "200" ]; then echo "  ok   the counter accepts the paid WhatsApp order"; else echo "  FAIL $code accept paid WhatsApp order"; fail=1; fi
  else
    echo "  FAIL no payment token: $WA_INBOUND"
    fail=1
  fi
else
  echo "  FAIL WhatsApp inbound did not create an order: $WA_INBOUND"
  fail=1
fi

echo "Dine-in parking and counter settlement"
code=$(curl -s -b "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/ops/orders/KB-DEMO09" \
  -H 'content-type: application/json' -d '{"action":"park","reason":"Smoke test"}')
if [ "$code" = "200" ]; then echo "  ok   a table bill can be parked"; else echo "  FAIL $code park table bill"; fail=1; fi
SETTLE=$(curl -s -b "$JAR" -X POST "$BASE/api/ops/orders/KB-DEMO09" -H 'content-type: application/json' \
  -d '{"action":"settle-table","method":"cash"}')
if printf '%s' "$SETTLE" | grep -q '"feedbackUrl"'; then
  echo "  ok   settling takes payment and prepares a feedback link"
  FEEDBACK_TOKEN=$(printf '%s' "$SETTLE" | grep -o '/feedback/[^"]*' | head -1 | cut -d'/' -f3)
  if [ -n "$FEEDBACK_TOKEN" ]; then
    check "/feedback/$FEEDBACK_TOKEN"
    if curl -s -X POST "$BASE/api/feedback/$FEEDBACK_TOKEN" -H 'content-type: application/json' \
       -d '{"rating":5,"partySize":3,"highlights":["Chicken Biryani"],"comment":"Smoke test"}' | grep -q '"ok":true'; then
      echo "  ok   guest feedback becomes a Google review draft"
      check "/admin/feedback" -b "$JAR"
    else
      echo "  FAIL feedback submission"
      fail=1
    fi
  fi
else
  echo "  FAIL settle table: $SETTLE"
  fail=1
fi
WA_ACK=$(curl -s -b "$JAR" -X POST "$BASE/api/ops/feedback" -H 'content-type: application/json' \
  -d '{"action":"invite","orderId":1,"channel":"link"}')
if printf '%s' "$WA_ACK" | grep -q '"url"'; then
  echo "  ok   a feedback link can be minted on demand"
else
  echo "  FAIL feedback invite: $WA_ACK"
  fail=1
fi

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
