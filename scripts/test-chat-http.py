import urllib.request, urllib.error, http.cookiejar, json, sys

base = 'http://localhost:3000'
expect_ai = '--ai-enabled' in sys.argv

def client():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

def req(c, path, data=None, origin='http://localhost:3000'):
    h = {'Origin': origin}
    raw = None
    if data is not None:
        h['Content-Type'] = 'application/json'
        raw = json.dumps(data).encode()
    try:
        with c.open(urllib.request.Request(base + path, data=raw, headers=h), timeout=100) as r:
            return r.status, json.load(r), {k.lower(): v for k, v in r.info().items()}
    except urllib.error.HTTPError as e:
        return e.code, json.load(e), {k.lower(): v for k, v in e.headers.items()}

guest = client()
staff = client()
manager = client()
admin = client()
alice = client()
bob = client()

# 1. Origin & consent validation
assert req(guest, '/api/chat', {'action': 'start', 'consent': True}, 'http://evil.test')[0] == 403
assert req(guest, '/api/chat/suggestions', {'cart': []}, 'http://evil.test')[0] == 403
assert req(guest, '/api/chat', {'action': 'start', 'consent': False})[0] == 400

# 2. Check aiEnabled flag matches server OpenAI env state
status, initial, headers = req(guest, '/api/chat')
assert status == 200 and initial['aiEnabled'] is expect_ai, (status, initial)
assert 'no-store' in headers.get('cache-control', '').lower(), headers

# 3. Signed-out suggestions: daily specials present, no personal history, spoofed customerId ignored
status, guest_sug, sug_headers = req(guest, '/api/chat/suggestions?customerId=1&email=ayesha@example.com')
assert status == 200, (status, guest_sug)
assert 'no-store' in sug_headers.get('cache-control', '').lower(), sug_headers
assert guest_sug['signedIn'] is False and guest_sug['recentOrderCount'] == 0, guest_sug
assert guest_sug['dessertOfTheDay'] is not None and guest_sug['dessertOfTheDay']['categorySlug'] == 'desserts', guest_sug
assert guest_sug['drinkOfTheDay'] is not None and guest_sug['drinkOfTheDay']['categorySlug'] == 'drinks', guest_sug
assert len(guest_sug['menuSuggestions']) > 0 and len(guest_sug['cartSuggestions']) > 0, guest_sug

# 4. Staff login & role checks
assert req(client(), '/api/ops/chat')[0] == 401
for c, who in [(staff, 'counter'), (manager, 'manager'), (admin, 'admin')]:
    status, data, _ = req(c, '/api/staff/login', {'email': who + '@khanbaba.com.au', 'password': 'KhanBaba2026!'})
    assert status == 200, (who, status, data)
assert req(staff, '/api/ops/chat?archive=1')[0] == 403
assert req(manager, '/api/ops/chat?archive=1')[0] == 403

if not expect_ai:
    # 5A. Staff-only scenario (OpenAI variables empty):
    # Starting chat connects directly to counter staff without 503!
    status, started, _ = req(guest, '/api/chat', {'action': 'start', 'consent': True})
    assert status == 200 and started['status'] == 'waiting' and started['aiEnabled'] is False, (status, started)
    status, sent, _ = req(guest, '/api/chat', {'action': 'message', 'text': 'Hello counter team, can I ask about spice levels?'})
    assert status == 200 and sent['status'] == 'waiting', (status, sent)

    status, data, _ = req(staff, '/api/ops/chat')
    assert status == 200 and len(data['chats']) >= 1, (status, data)
    chat_id = data['chats'][0]['id']
    assert 'customer_id' not in data['chats'][0], data['chats'][0]
    status, detail, _ = req(staff, '/api/ops/chat?id=' + chat_id)
    assert status == 200 and any(m['text'] == 'Hello counter team, can I ask about spice levels?' for m in detail['messages']), (status, detail)
    assert req(staff, '/api/ops/chat', {'id': chat_id, 'action': 'reply', 'text': 'We can make any curry mild or hot!'})[0] == 200
    status, guest_view, _ = req(guest, '/api/chat')
    assert any(m['text'] == 'We can make any curry mild or hot!' for m in guest_view['messages']), (status, guest_view)
    assert req(staff, '/api/ops/chat', {'id': chat_id, 'action': 'close'})[0] == 200
    assert req(staff, '/api/ops/chat?id=' + chat_id)[0] == 404
    status, archived, _ = req(admin, '/api/ops/chat?archive=1&id=' + chat_id)
    assert status == 200 and len(archived['messages']) == 2, (status, archived)
else:
    # 5B. AI-enabled scenario (OpenAI variables configured):
    # Default start opens in AI mode; explicit mode='staff' still opens counter chat directly;
    # handoff transitions AI -> waiting cleanly.
    status, started, _ = req(guest, '/api/chat', {'action': 'start', 'consent': True})
    assert status == 200 and started['status'] == 'ai' and started['aiEnabled'] is True, (status, started)
    assert req(guest, '/api/chat', {'action': 'handoff'})[0] == 200
    status, sent, _ = req(guest, '/api/chat', {'action': 'message', 'text': 'Speaking to staff after handoff'})
    assert status == 200 and sent['status'] == 'waiting', (status, sent)
    assert req(guest, '/api/chat', {'action': 'close'})[0] == 200

    # Direct counter mode also works when AI is enabled
    direct_guest = client()
    status, direct_start, _ = req(direct_guest, '/api/chat', {'action': 'start', 'consent': True, 'mode': 'staff'})
    assert status == 200 and direct_start['status'] == 'waiting', (status, direct_start)
    assert req(direct_guest, '/api/chat', {'action': 'message', 'text': 'Direct counter message while AI enabled'})[0] == 200
    assert req(direct_guest, '/api/chat', {'action': 'close'})[0] == 200

# 6. End-to-end customer sign-up -> chat suggestions -> cart -> checkout -> payment -> personalized suggestions -> privacy isolation
suffix = 'ai' if expect_ai else 'staff'
alice_email = f'chat-alice-{suffix}@example.com'
bob_email = f'chat-bob-{suffix}@example.com'

status, a_auth, _ = req(alice, '/api/customer/auth', {
    'mode': 'signup',
    'name': 'Alice Chat',
    'email': alice_email,
    'password': 'ChatPassword123!',
    'phone': '0411 111 111',
})
assert status == 200, (status, a_auth)

status, b_auth, _ = req(bob, '/api/customer/auth', {
    'mode': 'signup',
    'name': 'Bob Chat',
    'email': bob_email,
    'password': 'ChatPassword123!',
    'phone': '0422 222 222',
})
assert status == 200, (status, b_auth)

# Alice picks suggested menu item + Dessert of the Day + Drink of the Day, quotes & checks out through existing flow
status, a_sug0, _ = req(alice, '/api/chat/suggestions', {'cart': []})
assert status == 200 and a_sug0['signedIn'] is True and a_sug0['recentOrderCount'] == 0, (status, a_sug0)
picked = [a_sug0['menuSuggestions'][0], a_sug0['dessertOfTheDay'], a_sug0['drinkOfTheDay']]

status, quote, _ = req(alice, '/api/quote', {
    'channel': 'pickup',
    'items': [{'variantId': p['variantId'], 'qty': 1} for p in picked],
})
assert status == 200 and quote['pricing']['totalCents'] > 0, (status, quote)

status, order_res, _ = req(alice, '/api/orders', {
    'channel': 'pickup',
    'customerName': 'Alice Chat',
    'email': alice_email,
    'phone': '0411 111 111',
    'paymentMethod': 'online',
    'paymentOption': 'card_visa',
    'paymentLast4': '4242',
    'items': [{
        'itemId': p['itemId'],
        'variantId': p['variantId'],
        'qty': 1,
        'spiceLevel': p['spice'],
    } for p in picked],
})
assert status == 201 and order_res['paymentStatus'] == 'paid', (status, order_res)

# Alice's chat suggestions now reflect her purchase and adapt to cart contents
status, a_sug1, _ = req(alice, '/api/chat/suggestions', {'cart': [{'itemId': picked[0]['itemId'], 'qty': 1}]})
assert status == 200 and a_sug1['signedIn'] is True and a_sug1['recentOrderCount'] == 1, (status, a_sug1)
assert any(item['itemId'] == picked[0]['itemId'] and item.get('orderedCount') == 1 for item in a_sug1['menuSuggestions']), a_sug1['menuSuggestions']
assert all(item['itemId'] != picked[0]['itemId'] for item in a_sug1['cartSuggestions']), a_sug1['cartSuggestions']
# No PII in suggestions response
raw_a_sug = json.dumps(a_sug1)
for secret in ['Alice Chat', alice_email, '0411 111 111', order_res['code']]:
    assert secret not in raw_a_sug, f'PII leaked in suggestions: {secret}'

# Bob cannot access Alice's purchase history even by spoofing customerId/email
status, b_sug, _ = req(bob, '/api/chat/suggestions?customerId=1&email=' + alice_email, {'customerId': 1, 'email': alice_email, 'cart': []})
assert status == 200 and b_sug['signedIn'] is True and b_sug['recentOrderCount'] == 0, (status, b_sug)
assert all(item.get('orderedCount') is None for item in b_sug['menuSuggestions']), b_sug['menuSuggestions']

# 7. Shared-browser conversation isolation: Alice starts a chat, logs out, then Bob logs in on same browser
status, _, _ = req(alice, '/api/chat', {'action': 'start', 'consent': True, 'mode': 'staff'})
assert status == 200
status, _, _ = req(alice, '/api/chat', {'action': 'message', 'text': 'Alice private chat note'})
assert status == 200
status, a_chat, _ = req(alice, '/api/chat')
assert status == 200 and a_chat['chat'] is not None and len(a_chat['messages']) == 1, a_chat

# Alice signs out (kb_chat cookie still sits in jar!)
assert req(alice, '/api/customer/logout', {})[0] == 200
status, after_logout, _ = req(alice, '/api/chat')
assert status == 200 and after_logout['chat'] is None and after_logout['messages'] == [], after_logout

# Bob signs in on the SAME cookie jar
status, _, _ = req(alice, '/api/customer/auth', {'mode': 'signin', 'email': bob_email, 'password': 'ChatPassword123!'})
assert status == 200
status, bob_on_shared, _ = req(alice, '/api/chat')
assert status == 200 and bob_on_shared['chat'] is None and bob_on_shared['messages'] == [], bob_on_shared

print(f'Chat HTTP flow ({"AI-enabled" if expect_ai else "staff-only"}), recommendations, cart/checkout, origin, role and privacy isolation checks passed')
