# Plaid connection state snapshot — 2026-07-02

Read-only snapshot of `bank_connections` on live project `ihciuqpiavxhbulfkwod`, taken **before** any C2 cursor-reset remediation (per the 2026-07-01 review / [PLAN-2026-07-02-highpri-remediation.md](PLAN-2026-07-02-highpri-remediation.md)). Keep this until the cursors are intentionally updated — the `sync_cursor` values below let us restore the exact pre-remediation state.

**`sync_cursor` is an opaque per-Item Plaid pagination token** (safe to store — it is NOT the access token, which lives encrypted in `access_token_cipher`). Each connection has its own; they are not shared even though all banks were synced together.

## Findings

- **All 7 connections have `sync_from_date = 2026-06-01`** (created `2026-06-27`). The cutover was set correctly to the CSV→Plaid boundary, **not** the link-date default → the **C3 gap-window drop did NOT occur; no C3 remediation needed.**
- All 7 are `status = healthy`, last synced `2026-06-29 ~07:13–07:14 UTC`.
- Every connection has ≥1 mapped account. Whether **C2** (cursor-null) remediation is needed depends only on whether any Plaid account was left *unmapped at first sync* (dropped rows leave no ledger trace). If every account was mapped before the first sync, no rows were dropped and no reset is needed.
- Note: there are **2 Citibank Online** and **2 Wells Fargo** connections (7 total) — expected only if you linked each bank's logins separately; flag if any is an accidental duplicate.

## Snapshot

| Institution | connection id | sync_from_date | last_synced_at (UTC) | mapped | cursor len |
|---|---|---|---|---|---|
| American Express | `80011836-4fa7-4fb3-a783-b478fbc44a38` | 2026-06-01 | 2026-06-29 07:13:49 | 1 | 112 |
| Capital One | `2f00ee4a-c6fc-41a4-9d18-bdc02899b7ba` | 2026-06-01 | 2026-06-29 07:13:47 | 3 | 112 |
| Chase | `abab8a62-be20-4502-98a3-2461d57e6109` | 2026-06-01 | 2026-06-29 07:13:56 | 1 | 112 |
| Citibank Online | `58c9de33-01f3-42fb-bed4-e094c0fca3d1` | 2026-06-01 | 2026-06-29 07:13:57 | 1 | 112 |
| Citibank Online | `10a4fc23-fd47-4232-b629-486520e60cbc` | 2026-06-01 | 2026-06-29 07:13:59 | 1 | 112 |
| Wells Fargo | `0ce0c0b2-8449-4f99-bf49-3b906e6129aa` | 2026-06-01 | 2026-06-29 07:13:55 | 6 | 108 |
| Wells Fargo | `a49c4bac-502a-46fc-82fd-ffaa3f6751f0` | 2026-06-01 | 2026-06-29 07:14:02 | 4 | 112 |

## Raw cursors (for restore)

```
American Express  80011836-4fa7-4fb3-a783-b478fbc44a38
  CAESJWdvMEU3ODBaUU11cDFQWTdieXpZSGswSmFqWTdFNGk2ME1ES20aDAjqhf/RBhDglpvoAiIMCOqF/9EGEOCWm+gCKgwI6oX/0QYQ4Jab6AI=

Capital One       2f00ee4a-c6fc-41a4-9d18-bdc02899b7ba
  CAESJWIzMXJ6NThiWlFGMWtNYktKOE96Q29Zb3JNUGFqakNEVlZtN0UaDAjAmYjSBhCw9KyzASIMCMCZiNIGELD0rLMBKgwIwJmI0gYQsPSsswE=

Chase             abab8a62-be20-4502-98a3-2461d57e6109
  CAESJjYzcDR3UTU2SzB1cjd5ZHJkZUFaRjZlSm9CRHhZS0NaZzR3T0JxGgwIsqaI0gYQmKDvkwMiDAiypojSBhCYoO+TAyoMCLKmiNIGEJig75MD

Citibank Online   58c9de33-01f3-42fb-bed4-e094c0fca3d1
  CAESJks3MEp6VjBQNkJDcXlQclFydmdqU1BrTVJSTzd3ZUNLNG5SeGsxGgwIgfmE0gYQmPf8iAIiDAiB+YTSBhCY9/yIAioMCIH5hNIGEJj3/IgC

Citibank Online   10a4fc23-fd47-4232-b629-486520e60cbc
  CAESJWtlcDZqN0U4NVpDOHo3b0xKeXp3Y0JrWjlweTFxNmZvRWJxMVYaDAir8P3RBhDIjaTcASIMCKvw/dEGEMiNpNwBKgwIq/D90QYQyI2k3AE=

Wells Fargo       0ce0c0b2-8449-4f99-bf49-3b906e6129aa
  CAESJTE2WUI1TU1Bb3FIRFJ5ZGFBYUtNdXY0ZzZZWTNlNlVuWTg0eG0aCwi08IHSBhDww49MIgsItPCB0gYQ8MOPTCoLCLTwgdIGEPDDj0w=

Wells Fargo       a49c4bac-502a-46fc-82fd-ffaa3f6751f0
  CAESJU55RGFWdlJMMzVJWjRZbjU4VkxtSDRMUVFwZHcwMUlveTExYmUaDAis8P3RBhDg/KWDAyIMCKzw/dEGEOD8pYMDKgwIrPD90QYQ4PylgwM=
```

### Restore statement (if a reset needs undoing)

```sql
update bank_connections set sync_cursor = case id
  when '80011836-4fa7-4fb3-a783-b478fbc44a38' then 'CAESJWdvMEU3ODBaUU11cDFQWTdieXpZSGswSmFqWTdFNGk2ME1ES20aDAjqhf/RBhDglpvoAiIMCOqF/9EGEOCWm+gCKgwI6oX/0QYQ4Jab6AI='
  when '2f00ee4a-c6fc-41a4-9d18-bdc02899b7ba' then 'CAESJWIzMXJ6NThiWlFGMWtNYktKOE96Q29Zb3JNUGFqakNEVlZtN0UaDAjAmYjSBhCw9KyzASIMCMCZiNIGELD0rLMBKgwIwJmI0gYQsPSsswE='
  when 'abab8a62-be20-4502-98a3-2461d57e6109' then 'CAESJjYzcDR3UTU2SzB1cjd5ZHJkZUFaRjZlSm9CRHhZS0NaZzR3T0JxGgwIsqaI0gYQmKDvkwMiDAiypojSBhCYoO+TAyoMCLKmiNIGEJig75MD'
  when '58c9de33-01f3-42fb-bed4-e094c0fca3d1' then 'CAESJks3MEp6VjBQNkJDcXlQclFydmdqU1BrTVJSTzd3ZUNLNG5SeGsxGgwIgfmE0gYQmPf8iAIiDAiB+YTSBhCY9/yIAioMCIH5hNIGEJj3/IgC'
  when '10a4fc23-fd47-4232-b629-486520e60cbc' then 'CAESJWtlcDZqN0U4NVpDOHo3b0xKeXp3Y0JrWjlweTFxNmZvRWJxMVYaDAir8P3RBhDIjaTcASIMCKvw/dEGEMiNpNwBKgwIq/D90QYQyI2k3AE='
  when '0ce0c0b2-8449-4f99-bf49-3b906e6129aa' then 'CAESJTE2WUI1TU1Bb3FIRFJ5ZGFBYUtNdXY0ZzZZWTNlNlVuWTg0eG0aCwi08IHSBhDww49MIgsItPCB0gYQ8MOPTCoLCLTwgdIGEPDDj0w='
  when 'a49c4bac-502a-46fc-82fd-ffaa3f6751f0' then 'CAESJU55RGFWdlJMMzVJWjRZbjU4VkxtSDRMUVFwZHcwMUlveTExYmUaDAis8P3RBhDg/KWDAyIMCKzw/dEGEOD8pYMDKgwIrPD90QYQ4PylgwM='
end
where id in (
  '80011836-4fa7-4fb3-a783-b478fbc44a38','2f00ee4a-c6fc-41a4-9d18-bdc02899b7ba',
  'abab8a62-be20-4502-98a3-2461d57e6109','58c9de33-01f3-42fb-bed4-e094c0fca3d1',
  '10a4fc23-fd47-4232-b629-486520e60cbc','0ce0c0b2-8449-4f99-bf49-3b906e6129aa',
  'a49c4bac-502a-46fc-82fd-ffaa3f6751f0'
);
```
