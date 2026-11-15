# What's New entries for the releases that shipped without one

Every PR is supposed to ship with a release note. PRs **20, 21 and 22** merged
without one, so the feed on the site stopped at PR #19 — which is why the newest
thing listed was several releases old even though the code was live.

This file records what those three releases actually changed, so the entry can be
regenerated from the repository rather than from memory.

---

## PR 20 — "The kitchen is in Whalan 2770, not the Sydney CBD"

**Category:** `fix` · **version:** `3.3.0`

The stored address said Pitt Street in the CBD. Every consequence of that was
wrong: delivery was quoted from a point 39 km from the actual kitchen, postcodes
40 km away were treated as nearby, and every caption promised delivery across
Sydney. Corrected to 1/53 Bulolo Dr, Whalan NSW 2770, with the delivery zones
redrawn around it, and estimated pins are no longer trusted for pricing.

## PR 21 — "Answer which WhatsApp token works, and create the catalogue for you"

**Category:** `feature` · **version:** `3.4.0`

A stale Vercel variable silently beat a good token saved in the portal, so the
portal showed a green tick and Meta answered error 190. The diagnostics screen
now tests every token the app can see — the portal value and both Vercel
aliases — and prints a verdict per token. Rotation became a toggle instead of a
deploy: `WHATSAPP_ACCESS_TOKEN_NEW` is a second alias, so trying a new token and
falling back are one click each. Any single credential can be pinned to Vercel or
the portal, so "token from the portal, catalogue id from Vercel" works. The
catalogue itself can now be created from the portal instead of hunting a Content
ID out of a Commerce Manager URL.

## PR 22 — "A 7-day content calendar that cannot go stale"

**Category:** `feature` · **version:** `3.5.0`

A calendar written once keeps saying "across Sydney" for a year after the kitchen
moves. This one is generated from the live menu and the delivery zones, so it
cannot drift: seven days, each with a different job, every day carrying a
caption, hook, CTA, hashtags, posting time and channels. Regenerate with
`npm run marketing:calendar`.

Also fixed two bugs the calendar work surfaced: the "proven token" tick
fingerprinted the resolved token rather than the one that actually won, so it
could show a green tick on a token that did not work; and "Create catalogue"
required `whatsapp_business_id`, which had no input field anywhere and so could
never have been set.

---

## How these were applied

Through `scripts/whats-new.mjs --publish` against Supabase, which is the same
path the admin console uses. Not by editing the site HTML.

## Why PR 24's note did not appear, and how notes are published now

From PR 23 a note is a file, `whats-new/pr-<number>.json`, published when the
application starts. That worked in CI and on a laptop and did nothing on the
live site: the publisher read the folder at runtime, and on Vercel only files
reached by an `import` are packaged with a function. The folder was not there,
the read failed quietly, and the feed stayed at 3.5.0 while 3.6.0 was running.
CI did not catch it because CI started the server from the checkout, where the
folder exists.

Since PR 25:

- `scripts/generate-release-notes.mjs` compiles the folder into
  `lib/whats-new-notes.ts`, which the publisher imports. It runs before every
  build and dev start (`prebuild`, `predev`), and by hand with
  `npm run notes:build`. The generated file is committed; CI fails if it is out
  of date.
- `lib/whats-new.ts` reads no files. A test asserts that.
- CI removes the `whats-new/` folder before it starts the built server, so the
  smoke test runs under the same condition as production.
- `/api/health` reports `release.notesMissing`, and the operational log raises
  `REL_NOTES_UNPUBLISHED`, if a note in the build is not in the feed.

To add a note for a PR: create `whats-new/pr-<number>.json`, run
`npm run notes:build`, and commit both files.
