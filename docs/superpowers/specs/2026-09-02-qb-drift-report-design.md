# GBSL QuickBooks drift report - design

**Date:** 2026-09-02
**Status:** approved in conversation (AC), building

## Goal

A one-command, standalone HTML report that shows how far Alex's GBSL classification in
Hundie drifts from what the accountant has in QuickBooks Online (QBO), so the monthly
sync with the accounting team has an agenda: which months QBO has closed, which
categories disagree and why, which categories are dead and can be retired, and which
rows QBO parked in "Ask My Accountant".

Outside the Hundie app by design. Reruns monthly with one command. Publishable as a
private artifact link.

Decision of record: **QBO wins on Meals.** Hundie's `Meals (50%)` / `Meals (100%)`
count as drift against QBO's `Meals & Entertainment`, surfaced as pattern lines.

## Inputs

1. **QBO export** - Reports > "Transaction Detail by Account", custom period, CSV.
   Layout: title rows, header on the row whose col 1 is `Transaction date`, then
   account *sections* (col 0 set, col 1 blank), transaction rows, and `Total for ...`
   rows. Every transaction appears twice: under its payment account (Split = category)
   and under its category account (Split = payment account). Only the payment-account
   copies are used.
2. **Hundie ledger** - Supabase, service role, read only: `transactions` +
   `classifications` (entity = gbsl) + `transaction_splits` legs (entity = gbsl) +
   `categories` + `accounts`.

## QBO row model

Rows are taken only from sections in the account map below. Everything else in the file
is a mirror copy or a liability account (BHG Loan, Ford, Sales Tax Payable) and is
dropped.

| QBO section | Hundie account slug |
|---|---|
| `Navigate Business Checking℠ (3196) - 1` | `wf-gbsl-checking` |
| `Visa 0577` | `wf-gbsl-cc` |
| `Claudia's WF Business 1576 (was 8363)` | `wf-gbsl-claudia-cc` |
| `Capital One` | `cap-one-quicksilver-claudia` |
| `Line of Credit 4670` | `wf-gbsl-business-line` |

Unknown sections that look like payment accounts (parser heuristics) are reported in
the page header as "unmapped QBO accounts" so a new card never disappears silently.

**Sign normalization.** Hundie: positive = money out, negative = money in. QBO signs
depend on the section: asset sections (name contains Checking/Savings) show expenses
negative and deposits positive; liability sections (cards, LOC) show charges positive
and credits negative. Normalized QBO amount = `-amount` for asset sections, `amount`
for liability sections. Matching uses the **signed** normalized amount, so a refund
never pairs with a charge.

**Types kept:** `Expense`, `Credit Card Expense`, `Check`, `Credit Card Credit`,
`Deposit`. Other types (Journal Entry, Bill Payment) are counted and skipped.

**Own-account movements** (type `Credit Card Payment` / `Transfer`, or a Split naming
another mapped account) are listed by QBO under both accounts. The copy on the asset
(bank) side is kept as a `transfer`-kind row, the liability-side mirror is dropped and
counted. Hundie keeps its `Credit card payment` / `Internal transfer` rows too, so the
two sides pair and count as agree. Nothing is excluded from either ledger.

**Multi-line entries.** QBO shows a blank Split for a split transaction under the bank
section. Its lines are recovered from the category sections (same date, payee, memo,
and account; amounts must sum to the parent) and emitted one row per line. Unresolvable
blanks stay as `unclassified` rows and are counted.

**Category and kind.** `category = Split` verbatim. Kind via `categoryKind(fullPath)`
from `scripts/lib/category-kind.mjs`, with a QBO override layer: case-insensitive match
against Hundie GBSL paths, then name rules (`Owner` -> funding, `... Income` ->
income, `Cash Back Credit` -> transfer, `Ask My Accountant` -> review).

## Hundie row model

- Unsplit rows: `transactions` where `split_at IS NULL`, classification entity = gbsl.
- Split legs: `transaction_splits` where leg entity = gbsl; amount = leg amount,
  category = leg category, parent's date/description/account. Parent rows with
  `split_at` set are never counted whole.
- Period: `--from` (default `2026-01-01`) inclusive to `--to` (default = the QBO
  report's end date, parsed from row 3 of the file) inclusive.
- Kind via `categoryKind(full_path)`; `Ask My Accountant` and null category = review.

## Matching

Same-transaction test reuses the scorer shared with `apply-qb-categories-to-ledger.mjs`
(extracted to `scripts/lib/qb-match.mjs`, byte-identical behavior):
exact amount, date within slack, +4 per shared significant vendor word, +3 for a
10-char prefix overlap.

Drift-report assignment is **global greedy, one-to-one**: build every candidate pair
(same signed amount, |date diff| <= slack), score it, sort by score desc then day
diff asc, then assign in order skipping any row already taken. Same mapped account
scores +6; a cross-account pair is allowed but flagged `accountMismatch`. Default slack
5 days (`--date-slack`). Pairs must clear the same confidence floor the backfill uses
(single candidate: 10 exact-date / 12 slack; multiple: 13 / 15).

## Buckets (every row lands in exactly one)

| Bucket | Meaning |
|---|---|
| `agree` | matched, same category (case-insensitive path compare) |
| `differ` | matched, different category, both expense kind |
| `kindDiffer` | matched, kinds differ (e.g. you: expense, QBO: funding) |
| `qboAsks` | matched, QBO = Ask My Accountant, Hundie has a real category |
| `hundieReview` | matched, Hundie = unclassified / Ask My Accountant |
| `onlyHundie` | no QBO match (flagged `reachable` when the account exists in QBO) |
| `onlyQbo` | no Hundie match |

Two transfer-kind rows count as `agree` whatever they name as counter-account.

Invariants (asserted in code, tested): `agree + differ + kindDiffer + qboAsks +
hundieReview + onlyHundie = Hundie in-scope rows`; same sum with `onlyQbo` = QBO
in-scope rows; matched dollar totals equal on both sides.

## Aggregations in the page

1. **Month scoreboard** - per month, expense kind only: Hundie rows/$ on accounts QBO
   has ("reachable"), rows/$ on other cards ("unreachable", can never pair), QBO rows/$,
   matched and coverage (= matched / reachable), agree % of matched, not-booked-yet $,
   only-QBO $. Coverage below 50% is labeled "QBO behind".
2. **Only-in-Hundie by account** - rows and $ per Hundie account with no QBO
   counterpart. Personal cards carrying GBSL spend are the headline finding.
2b. **Not booked yet / missing from Hundie** - unmatched rows grouped by vendor and
   category with the months they occur in, so a recurring gap reads as one line.
3. **Disagreement patterns** - group `differ` by (Hundie category -> QBO category),
   then by vendor key inside each pattern; count and $; sorted by $ desc.
4. **QBO asks you** - the `qboAsks` rows with Hundie's category as the proposed answer;
   CSV-copyable block for the accountant.
5. **Chart audit** - every GBSL category (Hundie chart) plus every QBO category seen:
   Hundie 2026 rows/$, QBO 2026 rows/$, flags `hundieOnly`, `qboOnly`, `unusedBoth`
   (zero rows both sides in the period; kill candidates), `nameVariant`
   (case/spacing only).
6. **Drill-downs** - filterable tables for `differ`, `onlyHundie`, `onlyQbo`,
   `kindDiffer`, with month / account / category filters, client side. "Copy as CSV"
   for the current filter.

## Output

- `scripts/qb-drift-report.mjs --file <csv> [--from] [--to] [--date-slack 5]
  [--out <html>] [--json <path>]`
- Default HTML: `~/Downloads/GBSL-QB-drift-<to-date>.html` (full document, opens
  locally). `--fragment <path>` writes the body-only variant for artifact publishing.
- JSON sidecar with the full analysis for reruns and tests.
- Self-contained: no CDN, no external fonts, data embedded, dark-first with light
  fallback, mobile friendly.

## Files

- `scripts/lib/qb-match.mjs` - scorer extracted from the backfill script (+ tests, +
  the backfill script imports it; `--report-conflicts` output must be unchanged).
- `scripts/lib/qb-drift.mjs` - pure analysis: `parseQboDriftRows(csvText)`,
  `analyzeDrift({ qboRows, hundieRows, options })` -> report JSON.
- `scripts/lib/qb-drift-html.mjs` - `renderDriftFragment(report)`,
  `renderDriftDocument(report)`.
- `scripts/qb-drift-report.mjs` - CLI: load env, parse, fetch, analyze, render, write.
- `tests/qb-drift.test.ts` - matching, buckets, invariants, sign normalization,
  aggregations.
- `package.json` script: `report:qb-drift`.

## Out of scope (v1)

- Income / deposit reconciliation (counted as excluded, not compared).
- Writing anything to Supabase or QBO. Read only.
- Re-feeding `qb_training_expenses` from this file (separate, explicit step; it would
  add QBO-only categories to the chart and duplicate re-categorized rows).
- Keller QBO.
