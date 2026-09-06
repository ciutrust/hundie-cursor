# Amazon desk

Link ledger Amazon card charges to real order shipments from a personal **Your Orders** export, then confirm entity/category (or split by item). Classification notes get a short item summary plus the Amazon order URL.

## Data access (personal)

There is **no** consumer Orders API or login token for personal Amazon accounts.

1. Amazon → Account → **Request Your Information** → choose **Your Orders**
2. Download the zip when ready
3. In Hundie → **Amazon** → Upload export (`.zip` or `Order History.csv`)

The parser reads `Your Amazon Orders/Order History.csv` (also accepts older `Retail.OrderHistory.*.csv` names). Digital orders from `Digital Content Orders.csv` are included when present. Returns/cart/wishlist CSVs are ignored.

**Do not commit** Order History dumps or zip files to git (PII).

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
