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
# A real address inside a published zone. This used the Sydney CBD (2000) because
# the kitchen was assumed to be on Pitt Street; it is in Whalan 2770, and the CBD
# is now correctly refused — so a CBD fixture would fail for the right reason.
DELIVERY_QUOTE=$(curl -s -X POST "$BASE/api/quote" -H 'content-type: application/json' \
  -d '{"channel":"delivery","address":"7 Bulolo Drive","suburb":"Whalan","postcode":"2770","deliveryLat":-33.7595,"deliveryLng":150.8105,"items":[{"variantId":1,"qty":3}]}')
QUOTE_TOKEN=$(printf '%s' "$DELIVERY_QUOTE" | grep -o '"quoteToken":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -n "$QUOTE_TOKEN" ]; then
  echo "  ok   delivery quote carries a signed token"
else
  echo "  FAIL delivery quote token: $DELIVERY_QUOTE"
  fail=1
fi
PROMO_ORDER_JSON=$(curl -s -X POST "$BASE/api/orders" -H 'content-type: application/json' \
  -d "{\"channel\":\"delivery\",\"customerName\":\"Promo Smoke\",\"phone\":\"0400000001\",\"email\":\"promo@example.com\",\"address\":\"7 Bulolo Drive\",\"suburb\":\"Whalan\",\"postcode\":\"2770\",\"deliveryLat\":-33.7595,\"deliveryLng\":150.8105,\"paymentMethod\":\"online\",\"paymentOption\":\"card_visa\",\"paymentLast4\":\"4242\",\"promoCode\":\"WELCOME10\",\"quoteToken\":\"$QUOTE_TOKEN\",\"items\":[{\"itemId\":1,\"variantId\":1,\"qty\":3}]}")
PROMO_ORDER_CODE=$(printf '%s' "$PROMO_ORDER_JSON" | sed -n 's/.*"code":"\([^"]*\)".*/\1/p')
if [ -n "$PROMO_ORDER_CODE" ] && \
   curl -s "$BASE/api/orders/$PROMO_ORDER_CODE" | grep -q '"promotionCode":"WELCOME10"' && \
   curl -s "$BASE/api/orders/$PROMO_ORDER_CODE" | grep -q '"paymentOptionLabel":"Visa"' && \
   curl -s "$BASE/api/orders/$PROMO_ORDER_CODE" | grep -q '"deliveryLat":-33.7595'; then
  echo "  ok   promo, option and latitude/longitude persisted on the order"
  check "/order/$PROMO_ORDER_CODE"
else
  echo "  FAIL promo/options/coordinates order: $PROMO_ORDER_JSON"
  fail=1
fi

echo "Driver onboarding"
DRIVER_APPLY=$(curl -s -X POST "$BASE/api/driver/apply" -H 'content-type: application/json' \
  -d '{"firstName":"Smoke","lastName":"Driver","email":"smoke.driver@example.com","phone":"0400000002","vehicleType":"car","licenceNumber":"NSW-SMOKE-1","abn":"12345678901","rightToWorkCountry":"Australia","payId":"smoke.driver@example.com","address":"9 Bulolo Drive","suburb":"Whalan","postcode":"2770","baseLat":-33.7585,"baseLng":150.8065,"termsAccepted":true,"privacyAccepted":true,"documents":{"photo_id":"SMOKE-ID","licence":"NSW-SMOKE-1"}}')
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
  -H 'content-type: application/json' -d '{"name":"Smoke Customer","address":"7 Bulolo Drive","suburb":"Whalan","postcode":"2770"}')
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
            /admin/integrations /admin/delivery /admin/tables /admin/staff /admin/whats-new \
            /admin/marketing /admin/logs; do
  check "$path" -b "$JAR"
done

# A page that renders but that nothing links to is, for the person using the
# portal, a page that does not exist. That was the fault: Marketing and the
# Operational log were built, returned 200 here, and could not be found.
echo "Navigation: every menu reaches Marketing and the log"
has() { # has <label> <haystack-file> <fixed string>
  if grep -qF -- "$3" "$2"; then echo "  ok   $1"; else echo "  FAIL $1 (no: $3)"; fail=1; fi
}
NAV_PAGE="$(mktemp)"; HUB_PAGE="$(mktemp)"; MKT_PAGE="$(mktemp)"; COUNTER_PAGE="$(mktemp)"
curl -s -b "$JAR" "$BASE/admin" -o "$NAV_PAGE"
curl -s -b "$JAR" "$BASE/admin/hub" -o "$HUB_PAGE"
curl -s -b "$JAR" "$BASE/admin/marketing" -o "$MKT_PAGE"
curl -s -b "$JAR" "$BASE/counter" -o "$COUNTER_PAGE"
for href in /admin/marketing /admin/logs /admin/whats-new /admin/hub \
            '/admin/marketing#content-calendar' '/admin/marketing#integration-diagnostics'; do
  has "the admin sidebar links to $href" "$NAV_PAGE" "href=\"$href\""
done
for href in /counter /kitchen /delivery /admin /admin/marketing /admin/logs; do
  has "the staff top bar on /counter links to $href" "$COUNTER_PAGE" "href=\"$href\""
done
for href in /admin/marketing /admin/logs /admin/whats-new /admin/menu /admin/staff /admin/delivery; do
  has "the Command centre has a tile for $href" "$HUB_PAGE" "href=\"$href\""
done
for id in platform-status todays-menu content content-calendar publish credentials integration-diagnostics; do
  has "the Marketing page has the section #$id" "$MKT_PAGE" "id=\"$id\""
done
has "the Marketing page shows the seven-day calendar" "$MKT_PAGE" "Content calendar — the next seven days"

# Which build is this? Before, no screen said — so "I still can't see the
# changes" could not be told apart from "the changes are not deployed".
echo "Build stamp"
HEALTH=$(curl -s "$BASE/api/health")
BUILD_LABEL=$(printf '%s' "$HEALTH" | sed -n 's/.*"build":"\([^"]*\)".*/\1/p')
RELEASE_VERSION=$(printf '%s' "$HEALTH" | sed -n 's/.*"release":{"version":"\([^"]*\)".*/\1/p')
if [ -n "$RELEASE_VERSION" ] && [ "${BUILD_LABEL#v$RELEASE_VERSION}" != "$BUILD_LABEL" ]; then
  echo "  ok   /api/health names the build: $BUILD_LABEL"
else
  echo "  FAIL /api/health build is '$BUILD_LABEL' for release '$RELEASE_VERSION': $HEALTH"
  fail=1
fi
# The check that would have caught the live fault: the newest entry on the
# public feed must be the version this build says it is.
if printf '%s' "$HEALTH" | grep -qF "\"latestPublished\":{\"version\":\"$RELEASE_VERSION\""; then
  echo "  ok   the newest published release is this build's: $RELEASE_VERSION"
else
  echo "  FAIL the feed's newest release is not $RELEASE_VERSION: $HEALTH"
  fail=1
fi
if printf '%s' "$HEALTH" | grep -q '"notesMissing":\[\]'; then
  echo "  ok   /api/health reports every release note published"
else
  echo "  FAIL /api/health reports unpublished notes: $HEALTH"
  fail=1
fi
curl -s "$BASE/" -o "$MKT_PAGE"
has "the public footer shows the build" "$MKT_PAGE" "$BUILD_LABEL"
has "the admin sidebar shows the build" "$NAV_PAGE" "$BUILD_LABEL"
has "the staff top bar shows the build" "$COUNTER_PAGE" "$BUILD_LABEL"
has "the Command centre shows the build" "$HUB_PAGE" "$BUILD_LABEL"
rm -f "$NAV_PAGE" "$HUB_PAGE" "$MKT_PAGE" "$COUNTER_PAGE"

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
# Order matters here. Resume/replay/next refuse with 400 "Nothing queued —
# start a collection first" on a fresh database, and that is correct behaviour,
# not a fault: there is no track to resume. So this queues something first and
# only then asserts the transport controls work.
MUSIC_TRACK=$(curl -s -b "$JAR" -X POST "$BASE/api/ops/music" -H 'content-type: application/json' \
  -d '{"action":"create-track","title":"Smoke track","url":"https://example.com/smoke.mp3","kind":"music","category":"ghazal"}')
if printf '%s' "$MUSIC_TRACK" | grep -q '"ok":true'; then
  echo "  ok   a track can be loaded from the counter/admin console"
else
  echo "  FAIL create track: $MUSIC_TRACK"
  fail=1
fi

# The demo seed already queues a track ("Sitar at the counter"), so the queue is
# never empty on a fresh database — an assertion that resume 400s here was
# simply wrong. What matters is that the transport controls answer with a
# defined status instead of crashing, which the loop below proves.

MUSIC_COLLECTION=$(curl -s -b "$JAR" -X POST "$BASE/api/ops/music" -H 'content-type: application/json' \
  -d '{"action":"create-collection","name":"Smoke collection","kind":"music"}' | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
if [ -n "$MUSIC_COLLECTION" ]; then
  echo "  ok   a collection can be created"
  TRACK_ID=$(printf '%s' "$MUSIC_TRACK" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
  code=$(curl -s -b "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/ops/music" \
    -H 'content-type: application/json' \
    -d "{\"action\":\"add-track\",\"collectionId\":$MUSIC_COLLECTION,\"trackId\":$TRACK_ID}")
  if [ "$code" = "200" ]; then echo "  ok   the track joins the collection"; else echo "  FAIL $code add track to collection"; fail=1; fi
  code=$(curl -s -b "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/ops/music" \
    -H 'content-type: application/json' -d "{\"action\":\"play\",\"collectionId\":$MUSIC_COLLECTION}")
  if [ "$code" = "200" ]; then echo "  ok   200 music play"; else echo "  FAIL $code music play-collection"; fail=1; fi
else
  echo "  FAIL could not create a music collection"
  fail=1
fi

for action in pause resume replay next; do
  code=$(curl -s -b "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/ops/music" \
    -H 'content-type: application/json' -d "{\"action\":\"$action\"}")
  if [ "$code" = "200" ]; then echo "  ok   200 music $action"; else echo "  FAIL $code music $action"; fail=1; fi
done
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

echo "What's new feed"
WN=$(curl -s "$BASE/whats-new")
for phrase in "Whalan 2770" "7-day content calendar" "which WhatsApp token works" \
              "A log that tells you what to do" "Changes now reach the screen"; do
  if printf '%s' "$WN" | grep -q "$phrase"; then
    echo "  ok   what's new lists: $phrase"
  else
    echo "  FAIL what's new is missing: $phrase"
    fail=1
  fi
done
# The newest note must be the first one on the page: two notes published by the
# same boot used to tie on their timestamp and come out in the wrong order.
FIRST_NOTE=$(printf '%s' "$WN" | grep -oE "Changes now reach the screen|A log that tells you what to do|which WhatsApp token works" | head -1)
if [ "$FIRST_NOTE" = "Changes now reach the screen" ]; then
  echo "  ok   the newest release is listed first"
else
  echo "  FAIL the first release listed is: $FIRST_NOTE"
  fail=1
fi
HOME_NEW=$(curl -s "$BASE/" | grep -oE "Customer chat and counter handoff|Cultural themes and a new menu guide|Changes now reach the screen" | head -2 | wc -l)
if [ "$HOME_NEW" -ge 1 ]; then
  echo "  ok   the homepage shows recent releases"
else
  echo "  FAIL the homepage shows no recent releases"
  fail=1
fi

echo "Seven-day content calendar"
CAL=$(curl -s -b "$JAR" "$BASE/api/ops/marketing/calendar")
if printf '%s' "$CAL" | grep -q '"days"'; then
  echo "  ok   the calendar endpoint answers"
else
  echo "  FAIL calendar endpoint: $CAL"
  fail=1
fi
DAYS=$(printf '%s' "$CAL" | grep -o '"weekday"' | wc -l)
if [ "$DAYS" = "7" ]; then
  echo "  ok   the calendar has seven days"
else
  echo "  FAIL the calendar has $DAYS days, expected 7"
  fail=1
fi
if printf '%s' "$CAL" | grep -q "across Western Sydney\|in our delivery area\|nearby suburbs"; then
  echo "  ok   the calendar names the real delivery area"
else
  echo "  FAIL the calendar has no delivery area"
  fail=1
fi
if printf '%s' "$CAL" | grep -qi "across Sydney"; then
  echo "  FAIL the calendar still promises delivery across Sydney"
  fail=1
else
  echo "  ok   the calendar does not promise delivery across Sydney"
fi
CAL_MD=$(curl -s -b "$JAR" "$BASE/api/ops/marketing/calendar?format=md")
if printf '%s' "$CAL_MD" | grep -q "Whalan NSW 2770"; then
  echo "  ok   the calendar markdown names the Whalan kitchen"
else
  echo "  FAIL calendar markdown has the wrong address"
  fail=1
fi
if printf '%s' "$CAL_MD" | grep -q "Content-Length: 0"; then
  echo "  FAIL calendar markdown is empty"
  fail=1
else
  echo "  ok   the calendar markdown renders"
fi

echo "WhatsApp credential control"
# Which token is read, and from where. These are the dials that used to be a
# silent Vercel variable beating the portal value and presenting as Meta 190.
DIAG=$(curl -s -b "$JAR" "$BASE/api/ops/diagnostics")
if printf '%s' "$DIAG" | grep -q '"tokenEnvKey"'; then
  echo "  ok   diagnostics names the token variable in use"
else
  echo "  FAIL diagnostics does not report the token variable: $DIAG"
  fail=1
fi
if printf '%s' "$DIAG" | grep -q '"tokenAlias"'; then
  echo "  ok   diagnostics reports the token alias"
else
  echo "  FAIL diagnostics does not report the token alias"
  fail=1
fi
if printf '%s' "$DIAG" | grep -q '"fieldSources"'; then
  echo "  ok   per-field credential sources are exposed"
else
  echo "  FAIL per-field credential sources missing"
  fail=1
fi
# The diagnostics never leak a whole token, whatever else it reports.
if curl -s -b "$JAR" "$BASE/api/ops/diagnostics" | grep -qE '"accessToken":"[^•"]{20,}"'; then
  echo "  FAIL diagnostics returned an unmasked token"
  fail=1
else
  echo "  ok   diagnostics masks the token"
fi

expect "switch the token to the spare variable" 200 "$(post -b "$JAR" /api/ops/diagnostics '{"action":"set-token-alias","alias":"new"}')"
expect "the app now reads WHATSAPP_ACCESS_TOKEN_NEW" 200 "$(curl -s -b "$JAR" "$BASE/api/ops/diagnostics" | grep -q 'WHATSAPP_ACCESS_TOKEN_NEW' && echo 200)"
expect "switch the token back to the primary variable" 200 "$(post -b "$JAR" /api/ops/diagnostics '{"action":"set-token-alias","alias":"primary"}')"
expect "an unknown alias is refused" 400 "$(post -b "$JAR" /api/ops/diagnostics '{"action":"set-token-alias","alias":"evil"}')"

expect "pin one field to Vercel" 200 "$(post -b "$JAR" /api/ops/diagnostics '{"action":"set-field-source","field":"catalogId","value":"env"}')"
expect "clear the field pin" 200 "$(post -b "$JAR" /api/ops/diagnostics '{"action":"set-field-source","field":"catalogId","value":"auto"}')"
expect "an unknown credential field is refused" 400 "$(post -b "$JAR" /api/ops/diagnostics '{"action":"set-field-source","field":"notAField","value":"env"}')"

# Probing every candidate token must answer with a verdict, never a crash.
PROBE=$(curl -s -b "$JAR" "$BASE/api/ops/diagnostics?tokens=1")
if printf '%s' "$PROBE" | grep -q '"attempts"'; then
  echo "  ok   the portal can answer which token Meta accepts"
else
  echo "  FAIL credential probe: $PROBE"
  fail=1
fi
if printf '%s' "$PROBE" | grep -qE '"nextStep"|"recommendation"'; then
  echo "  ok   the probe says what to change next"
else
  echo "  FAIL the probe gave no next step"
  fail=1
fi

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

echo "Operational log"
# The go-live step above rotated the admin password, so the jar from earlier in
# this script is stale and every request would redirect to the sign-in page.
# Re-authenticate with the post-go-live password before touching the log.
RELOGIN=$(curl -s -c "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/staff/login" \
  -H 'content-type: application/json' \
  -d '{"email":"admin@khanbaba.com.au","password":"smoke-owner-pass-1"}')
if [ "$RELOGIN" = "200" ]; then
  echo "  ok   re-signed in after the password rotation"
else
  echo "  FAIL could not re-sign in after go-live (got $RELOGIN)"
  fail=1
fi
LOGS_API="$BASE/api/ops/logs"
# Matched in the shell, not through a pipe: `printf … | grep -q` on a page of a
# few hundred kB fails under `pipefail` when grep exits at the first match.
contains() { # contains <label> <text> <fixed string>
  if [[ "$2" == *"$3"* ]]; then echo "  ok   $1"; else echo "  FAIL $1 (no: $3)"; fail=1; fi
}
lacks() { # lacks <label> <text> <fixed string>
  if [[ "$2" == *"$3"* ]]; then echo "  FAIL $1 (found: $3)"; fail=1; else echo "  ok   $1"; fi
}

# --- findings: what is wrong now
AUDIT=$(curl -s -b "$JAR" -X POST "$LOGS_API" -H 'content-type: application/json' -d '{"action":"audit"}')
contains "the audit runs against the live system" "$AUDIT" '"ok":true'
contains "the audit reports that every check ran" "$AUDIT" '"failedChecks":[]'
LOGS=$(curl -s -b "$JAR" "$LOGS_API")
contains "findings carry a quotable reference" "$LOGS" '"reference":"LOG-'
contains "findings carry a machine-readable code" "$LOGS" '"code":"WA_'
contains "every finding carries its course of action as steps" "$LOGS" '"steps":"[{'
lacks "after go-live no finding reports the demo password" "$LOGS" 'SEC_DEMO_PASSWORD'
LOG_PAGE_CODE=$(curl -s -o /tmp/logs-page.html -w "%{http_code}" -b "$JAR" "$BASE/admin/logs")
if grep -q "Operational log" /tmp/logs-page.html && grep -q "Course of action" /tmp/logs-page.html; then
  echo "  ok   the operational log page renders findings with a course of action"
else
  echo "  FAIL /admin/logs did not render (status $LOG_PAGE_CODE)"
  head -c 300 /tmp/logs-page.html
  fail=1
fi
# Closing without a note must be refused: a row closed to clear the screen is
# indistinguishable from one fixed.
LOG_ID=$(printf '%s' "$LOGS" | sed -n 's/.*"logs":\[{"id":\([0-9]*\).*/\1/p' | head -1)
LOG_REF=$(printf '%s' "$LOGS" | grep -o '"reference":"LOG-[^"]*"' | head -1 | cut -d'"' -f4)
if [ -n "$LOG_ID" ] && [ -n "$LOG_REF" ]; then
  NO_NOTE=$(curl -s -o /dev/null -w "%{http_code}" -b "$JAR" -X POST "$LOGS_API" \
    -H 'content-type: application/json' -d "{\"action\":\"set-status\",\"id\":$LOG_ID,\"status\":\"resolved\"}")
  expect "closing a finding without a note is refused" 400 "$NO_NOTE"
  WITH=$(curl -s -o /dev/null -w "%{http_code}" -b "$JAR" -X POST "$LOGS_API" \
    -H 'content-type: application/json' -d "{\"action\":\"set-status\",\"id\":$LOG_ID,\"status\":\"acknowledged\",\"note\":\"seen\"}")
  expect "a finding can be acknowledged" 200 "$WITH"

  # "Resolved" is a claim the audit checks. The fault is still there, so the
  # next audit must put it back — under the same reference, with the reason.
  curl -s -o /dev/null -b "$JAR" -X POST "$LOGS_API" -H 'content-type: application/json' \
    -d "{\"action\":\"set-status\",\"id\":$LOG_ID,\"status\":\"resolved\",\"note\":\"closed by the smoke test without fixing it\"}"
  lacks "a finding marked resolved leaves the open list" "$(curl -s -b "$JAR" "$LOGS_API")" "\"reference\":\"$LOG_REF\""
  REAUDIT=$(curl -s -b "$JAR" -X POST "$LOGS_API" -H 'content-type: application/json' -d '{"action":"audit"}')
  contains "the audit reopens a finding that was closed but is still true" "$REAUDIT" '"reopened":1'
  ONE=$(curl -s -b "$JAR" "$LOGS_API?ref=$LOG_REF")
  contains "…it is open again under the same reference" "$ONE" '"status":"open"'
  contains "…with the reason recorded" "$ONE" 'Reopened by the audit'

  # "Ignored" is the deliberate mute and must survive an audit.
  curl -s -o /dev/null -b "$JAR" -X POST "$LOGS_API" -H 'content-type: application/json' \
    -d "{\"action\":\"set-status\",\"id\":$LOG_ID,\"status\":\"ignored\",\"note\":\"accepted for the smoke test\"}"
  MUTED=$(curl -s -b "$JAR" -X POST "$LOGS_API" -H 'content-type: application/json' -d '{"action":"audit"}')
  contains "the audit leaves an ignored finding alone" "$MUTED" '"reopened":0'
  contains "…and counts it as skipped" "$MUTED" '"skipped":1'
  contains "…and it is in the history" "$(curl -s -b "$JAR" "$LOGS_API?view=history")" "\"reference\":\"$LOG_REF\""
  curl -s -o /dev/null -b "$JAR" -X POST "$LOGS_API" -H 'content-type: application/json' \
    -d "{\"action\":\"set-status\",\"id\":$LOG_ID,\"status\":\"open\",\"note\":\"reopened by smoke\"}"

  FINDING_TEXT=$(curl -s -b "$JAR" "$LOGS_API?ref=$LOG_REF&format=text")
  contains "one finding exports as text by its reference" "$FINDING_TEXT" "$LOG_REF"
  contains "…with its numbered course of action" "$FINDING_TEXT" 'course_of_action:'
else
  echo "  FAIL no finding to work with: $LOGS"
  fail=1
fi

# --- actions: what was done. Everything this script did above went through the
# same routes the screens use, so the log should already hold the story of it.
echo "Action log"
ACTIONS=$(curl -s -b "$JAR" "$LOGS_API?view=actions&limit=500")
contains "actions carry a quotable reference" "$ACTIONS" '"reference":"ACT-'
for action in auth.login orders.place orders.confirm orders.paid production.start staff.go-live logs.audit logs.set-status; do
  contains "the log recorded $action" "$ACTIONS" "\"action\":\"$action\""
done
contains "a successful sign-in names the account and the role granted" "$ACTIONS" '"actor":"admin@khanbaba.com.au","actor_role":"admin"'
contains "a customer's order is attributed to the customer, not to staff" "$ACTIONS" '"actor":"customer"'
contains "every row stores its course of action" "$ACTIONS" '"course":"{\"code\":'
contains "every row names the build that handled it" "$ACTIONS" "\"build\":\"$BUILD_LABEL\""

PROBLEMS=$(curl -s -b "$JAR" "$LOGS_API?view=actions&problems=1&limit=500")
contains "refused sign-ins are recorded as denied" "$PROBLEMS" '"outcome":"denied"'
contains "…classified as bad credentials" "$PROBLEMS" '"error_code":"BAD_CREDENTIALS"'
contains "…against the account that was tried" "$PROBLEMS" '"actor":"counter@khanbaba.com.au"'
contains "a refused request is recorded with its class" "$PROBLEMS" '"error_code":"INVALID_INPUT"'
lacks "the problems filter returns no successes" "$PROBLEMS" '"outcome":"ok"'

# Nothing secret may be stored: this script has sent two staff passwords, a
# customer password and a card's last four through logged routes.
EVERYTHING=$(curl -s -b "$JAR" "$LOGS_API?view=actions&format=ndjson")
for secret in 'KhanBaba2026!' 'smoke-owner-pass-1' 'smoke-cook-pass' 'whatever-pass-1' '"paymentLast4":"4242"'; do
  lacks "the action log does not contain $secret" "$EVERYTHING" "$secret"
done
contains "a card's last four digits are stored as [redacted]" "$EVERYTHING" '"paymentLast4":"[redacted]"'
lacks "the action log does not contain a customer's email" "$EVERYTHING" 'promo@example.com'
lacks "the action log does not contain a customer's phone" "$EVERYTHING" '0400000001'
lacks "the action log does not contain a customer's name" "$EVERYTHING" 'Promo Smoke'
lacks "the action log does not contain a customer's address" "$EVERYTHING" 'Bulolo Drive'

# A wrong password in the email box must not be written down as an "actor".
curl -s -o /dev/null -X POST "$BASE/api/staff/login" -H 'content-type: application/json' \
  -d '{"email":"Sm0ke@Typed.Password","password":"x"}'
MISTYPED=$(curl -s -b "$JAR" "$LOGS_API?view=actions&component=auth&limit=3&format=ndjson")
contains "a sign-in naming no account is recorded as an unknown account" "$MISTYPED" '"actor":"unknown account"'
lacks "…and what was typed is stored nowhere" "$MISTYPED" 'yped.Password'
lacks "…in any case" "$(printf '%s' "$MISTYPED" | tr 'A-Z' 'a-z')" 'yped.password'

# One format, three exports.
TEXT=$(curl -s -b "$JAR" "$LOGS_API?view=actions&format=text&limit=20")
contains "the text export opens with what produced it" "$TEXT" '# khanbaba operational log · view=actions'
contains "…names the build" "$TEXT" "build=$BUILD_LABEL"
contains "…has key=value fields a search can match" "$TEXT" 'outcome=ok'
contains "…and the course of action under each entry" "$TEXT" 'course_of_action:'
CSV_HEAD=$(curl -s -b "$JAR" "$LOGS_API?view=actions&format=csv&limit=5" | head -1)
contains "the CSV export has a header row" "$CSV_HEAD" 'occurred_at,level,reference,component,action,outcome'
CSV_TYPE=$(curl -s -o /dev/null -D - -b "$JAR" "$LOGS_API?view=actions&format=csv&limit=5" | tr -d '\r' | grep -i '^content-disposition:')
contains "…and downloads as a file" "$CSV_TYPE" 'attachment; filename="khanbaba-actions-'
NDJSON_FIRST=$(curl -s -b "$JAR" "$LOGS_API?view=actions&format=ndjson&limit=5" | head -1)
if printf '%s' "$NDJSON_FIRST" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);process.exit(o.ref&&o.course_of_action&&Array.isArray(o.course_of_action.steps)&&o.course_of_action.steps.length>0?0:1)})'; then
  echo "  ok   the NDJSON export is one object per line, course of action included"
else
  echo "  FAIL NDJSON line: $NDJSON_FIRST"
  fail=1
fi
contains "findings export as CSV too" "$(curl -s -b "$JAR" "$LOGS_API?format=csv" | head -1)" 'last_seen_at,severity,reference,code'

ACT_REF=$(printf '%s' "$ACTIONS" | grep -o '"reference":"ACT-[^"]*"' | head -1 | cut -d'"' -f4)
ONE_ACTION=$(curl -s -b "$JAR" "$LOGS_API?ref=$ACT_REF&format=text")
contains "one action is found by the reference somebody quotes" "$ONE_ACTION" "$ACT_REF"
EXPECT=404 check "/api/ops/logs?ref=ACT-ZZ-000000-00000" -b "$JAR"

SUMMARY=$(curl -s -b "$JAR" "$LOGS_API?summary=1")
contains "the summary counts findings and actions" "$SUMMARY" '"last24h":'

ACTIONS_PAGE=$(curl -s -b "$JAR" "$BASE/admin/logs?view=actions")
contains "the action log has a screen" "$ACTIONS_PAGE" 'auth.login'
contains "…with a download for each format" "$ACTIONS_PAGE" 'format=ndjson'
check "/admin/logs?view=history" -b "$JAR"
check "/admin/logs?view=actions&problems=1&component=auth&q=login" -b "$JAR"

for path in "/api/ops/logs" "/api/ops/logs?view=actions" "/api/ops/logs?view=actions&format=csv" "/api/ops/logs?summary=1"; do
  expect "signed out, $path is refused" 401 "$(curl -s -o /dev/null -w "%{http_code}" "$BASE$path")"
done
# The kitchen can sign in, and the log is still not theirs to read.
KITCHEN_JAR="$(mktemp)"
expect "the kitchen login still signs in" 200 "$(post -c "$KITCHEN_JAR" /api/staff/login '{"email":"smoke-cook@khanbaba.com.au","password":"smoke-cook-pass-2"}')"
expect "…and cannot read the log" 401 "$(curl -s -o /dev/null -w "%{http_code}" -b "$KITCHEN_JAR" "$LOGS_API?view=actions")"
expect "…or run the audit" 401 "$(post -b "$KITCHEN_JAR" /api/ops/logs '{"action":"audit"}')"
rm -f "$KITCHEN_JAR"

rm -f "$JAR"
if [ "$fail" = "1" ]; then
  echo "Smoke test failed"
  exit 1
fi
echo "Smoke test passed"
