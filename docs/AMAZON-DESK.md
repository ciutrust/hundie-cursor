# Amazon desk

Link ledger Amazon card charges to real order shipments from a personal **Your Orders** export, then confirm entity/category (or split by item). Classification notes get a short item summary plus the Amazon order URL.

## Data access (personal)

There is **no** consumer Orders API or login token for personal Amazon accounts.

1. Amazon → Account → **Request Your Information** → choose **Your Orders**
2. Download the zip when ready
3. In Hundie → **Amazon** (sidebar, with the rest of the app chrome) → Upload export (`.zip` or `Order History.csv`)

The parser reads `Your Amazon Orders/Order History.csv` (also accepts older `Retail.OrderHistory.*.csv` names). Digital orders from `Digital Content Orders.csv` are included when present. Returns/cart/wishlist CSVs are ignored.

**Do not commit** Order History dumps or zip files to git (PII).

## Queue

Default period is the **calendar year** (picker at the top). Tabs:

| Tab | Meaning |
|-----|---------|
| Uncategorized | Amazon purchase, not linked, still needs a category (or Ask My Accountant) |
| Unmatched | Categorized, not yet linked to a shipment |
| Done | Categorized **and** matched — archived. Edit unlocks the form; bulk fixes go through code. |
| All | Everything in the period except card-pay transfers |

Checking-side **Credit card payment** rows (paying the Amazon card, not buying from Amazon) are hidden.

## Matching

Card charges are per **shipment** (`Order ID` + `Ship Date`), not per order. Matching uses amount (integer cents), a ±5 day window, and descriptor hints (`DIGI` vs marketplace). Store-card (PLCC) shipments are skipped — they never hit Hundie cards.

| Tier | Meaning |
|------|---------|
| A | Unique charge↔shipment pair |
| B | Ambiguous — pick in the desk |
| C | No candidate |

Suggestions never write the books. **Confirm & link** (or split) does.

## Splits

**Split by item** prefills legs from line totals and a tax/shipping remainder. Legs must sum to the charge exactly (same rules as `/review` splits). Order URL + item summary go on the parent classification notes (split legs have no notes column).

## Amazon Business (phase 2)

Same `amazon_*` tables with `source = business_api`. Adapter stub: `lib/amazon/source.ts` (`businessApiSource`). Not wired in v1 — use personal export until Business OAuth/sync is configured.

## Schema

- `amazon_import_batches`
- `amazon_shipments` / `amazon_shipment_items`
- `amazon_charge_links` (one row per ledger transaction)

Migration: `supabase/migrations/20260907000000_amazon_desk.sql`.

## One-time backfill (hundie-amazon-match)

The 2026 review in the sibling `hundie-amazon-match` repo already decided entity/category (and splits). Those ledger writes often landed via SQL; the desk still needs shipment links + order-URL notes.

Live `ihciuqpiavxhbulfkwod` already has **251 confirmed** `amazon_charge_links` from that review (2026-09-05). Reload `/amazon` — they should sit in **Done**. Upload a fresh Your Orders zip so shipment rows attach (confirmed links store `shipment_key` in `match_hypothesis` until import).

```bash
npm run import:amazon-decisions          # dry-run
npm run import:amazon-decisions:apply     # write links / notes / missing categories
```

Reads `../hundie-amazon-match/data/import_ready.json` and `matches.json` (not committed here). Override with `--file` / `--matches`.
