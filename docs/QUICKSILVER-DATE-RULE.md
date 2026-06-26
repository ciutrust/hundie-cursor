# Quicksilver entity date rule — confirmed

**Account:** `cap-one-quicksilver-claudia` (Cap One Claudia Quicksilver)

**Rule (operator confirmed 2026-06-26):** GBSL through **2026-06-30**, Personal from **2026-07-01**.

```json
[
  { "until": "2026-06-30", "entity_slug": "gbsl" },
  { "from": "2026-07-01", "entity_slug": "personal" }
]
```

## What was wrong

The original seed used **2025** boundaries, so every charge from July 2025 onward resolved to Personal — including all of Jan–Jun 2026 that should have stayed GBSL.

## Fixes applied

| Layer | Change |
|-------|--------|
| Migration `20260627120000` | Account `date_rules` updated to 2026 |
| Migration `20260630140000` | Re-resolve classifications Jul 2025–Jun 2026 from Personal → GBSL; clear Personal-only categories (**applied remote**) |
| `scripts/lib/seed-accounts.mjs` | Local import dry-runs use 2026 boundaries |
| `tests/entity-resolver.test.ts` | Boundary tests pinned |

## After migration (applied 2026-06-26)

Re-classify any Quicksilver rows in the GBSL review backlog (category cleared when they had a Personal chart tag).

See [REVIEW-2026-06-26.md](./REVIEW-2026-06-26.md) §C1.
