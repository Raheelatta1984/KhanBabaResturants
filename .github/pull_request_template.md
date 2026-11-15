## What changed

<!-- One paragraph. What does this PR do and why? -->

## Type

- [ ] Feature
- [ ] Improvement
- [ ] Fix
- [ ] Staff portal
- [ ] Operations / infrastructure

## Tested

- [ ] `npm run typecheck`
- [ ] `npm run test:pg`
- [ ] `npm run build`
- [ ] Manually exercised the affected flow (checkout / counter / kitchen / delivery / admin)
- [ ] A new admin page is linked from `lib/nav.ts` (the test fails if it is not)
- [ ] A new staff route that changes something is wrapped in `withActionLog` (the test fails if it is not)

## What's New entry

Every PR ships its release note as a file, so the note reaches production with the code it describes:

1. Add `whats-new/pr-<number>.json` (`title`, `summary` ≤ 320 characters, `body`, `category`, `version`).
2. Run `npm run notes:build` and commit the regenerated `lib/whats-new-notes.ts`.

The highest `version` among the notes is the version the site reports in its footer and at `/api/health`.

- [ ] Release note added / not customer-facing (explain)
