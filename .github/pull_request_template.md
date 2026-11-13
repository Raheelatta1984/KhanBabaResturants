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
- [ ] `npm run build`
- [ ] Manually exercised the affected flow (checkout / counter / kitchen / delivery / admin)

## What's New entry

Every PR should add a customer-facing note. Either publish it from **Admin → What's new**, or attach the output of:

```bash
node scripts/whats-new.mjs --pr <number> --title "…" --summary "…" --category feature
```

- [ ] Release note added / not customer-facing (explain)
