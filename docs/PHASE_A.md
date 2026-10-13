# Phase A — Liabilities, assets, and net worth

Additive only. Classification is untouched.

## What shipped

- Migrations: `liabilities`, `assets`, `asset_value_history` (authenticated-only RLS)
- Seed: `20261013010000_seed_liabilities_assets.sql` (estimates labeled in notes)
- Routes: `/liabilities`, `/assets`, `/net-worth`
- Sidebar links under Balance sheet
- Auth protection for the three routes (login required, no extra MFA step-up)

## Seeded data (estimates unless noted)

### Liabilities

| Name | Entity (debt) | Balance | APR | Notes |
|---|---|---|---|---|
| Chase Mortgage — Winding Ridge | Personal | $470,000 | 2.625% | Estimate |
| First Financial HELOC — Winding Ridge | Personal | $100,000 | 7.5% | Estimate |
| M&T Bank Mortgage — Joshua Tree | Personal | $225,000 | 3% | Investment property |
| SPS Servicing — Anita | Personal | $220,000 | 7% | Property owned by ACAA; debt Personal |
| Shellpoint — Fair Meadows | Personal | $225,000 | 7% | Property owned by ACAA; debt Personal |
| Ford Loan — F150 Lightning | GBSL | $34,284.31 | 3.6% | Exact |
| CNB Business Loan — GB Southlake | GBSL | $0 | TBD | Placeholder |

### Assets — Properties

| Name | Entity | Est. value | Notes |
|---|---|---|---|
| 512 Winding Ridge, Southlake | Personal | $0 | Primary; value TBD |
| 124 Joshua Tree, Pflugerville | Personal | $0 | Investment; value TBD |
| 136 Anita, Keller | Austin ACAA House LLC | $365,000 | Zestimate |
| 6649 Fair Meadows Dr, Watauga | Austin ACAA House LLC | $295,000 | Closed 7/31/2026 |

### Assets — Vehicles

| Name | Entity | Est. value | Notes |
|---|---|---|---|
| 2015 Honda Odyssey Touring | Personal | $13,000 | Paid |
| 2023 Ford F150 Lightning Platinum | GBSL | $54,000 | Loan $34,284.31 |
| 2011 Ford Focus | GBSL | $3,500 | Paid |

### Assets — Investments (all Personal)

| Name | Balance |
|---|---|
| Fidelity 401k | $300,000 |
| E*TRADE | $900,000 |
| xmoney | $80,000 |
| Alignea | $12,000 |
| Agatha's 529 (Wells Fargo) | $140,000 |
| Anthony's 529 (Wells Fargo) | $125,000 |

## Still later

- Live Zillow refresh
- Plaid Liabilities sync
- Claudia's different view
- Exact CNB amortization
- Regenerate `lib/types/database.ts` after the migration is applied

## How to review

1. Apply both migrations on the project.
2. Sign in and open `/liabilities`, `/assets`, and `/net-worth`.
3. Override any estimate in a follow-up. Do not merge until the numbers look right.
