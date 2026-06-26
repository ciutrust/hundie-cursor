# Quicksilver entity date rule — operator decision needed

The Cap One Quicksilver card (`cap-one-quicksilver-alex`) has seed `date_rules`:

```json
[
  { "until": "2025-06-30", "entity_slug": "gbsl" },
  { "from": "2025-07-01", "entity_slug": "personal" }
]
```

**Question:** Did the GBSL → Personal switch happen **July 1, 2025** or **July 1, 2026**?

| If switch was… | Effect on 2026 charges |
|----------------|------------------------|
| **July 1, 2025** | Rule is correct — 2026 charges go to Personal |
| **July 1, 2026** | **Bug** — Jan–Jun 2026 charges are mis-booked to Personal instead of GBSL |

## If 2026 is correct

1. New migration: change boundaries to `2026-06-30` / `2026-07-01`
2. Re-resolve classifications for Quicksilver txns in the affected window
3. Run `npm test` — update `tests/entity-resolver.test.ts` with the new boundary

See [REVIEW-2026-06-26.md](./REVIEW-2026-06-26.md) §C1.
