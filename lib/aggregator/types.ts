/**
 * Aggregator seam.
 *
 * Hundie talks to THIS interface, never to a vendor SDK directly — so Plaid can be swapped for
 * Teller / SimpleFIN later without touching the rest of the app. Ported from the multi-tenant
 * Hundie build, with one deliberate difference: AggregatorTransaction carries THIS repo's ledger
 * shape (dollars, positive = charge) so it feeds buildImportPlanFromTransactions directly.
 */

export type AggregatorResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; notConfigured?: boolean };

export interface AggregatorAccount {
  externalId: string; // vendor account id
  name: string;
  last4: string | null;
  type: "credit" | "depository" | "other";
  institution: string;
}

/**
 * A normalized transaction in THIS repo's ledger shape (the same fields the CSV parsers emit),
 * so the sync runner can hand it straight to buildImportPlanFromTransactions.
 *
 * SIGN: amount is dollars, positive = charge, negative = refund — the existing ledger
 * convention, which already matches Plaid's raw sign (positive = money out). No flip.
 */
export interface AggregatorTransaction {
  externalId: string; // vendor txn id — stable; passed as issuerReference for idempotent dedupe
  accountExternalId: string; // vendor account id — resolved to a Hundie account via plaid_account_links
  transactionDate: string; // YYYY-MM-DD
  postedDate: string | null;
  amount: number; // dollars, 2dp, positive = charge
  description: string;
  vendor: string | null;
  rawCategory: string | null;
  pending: boolean;
}

/**
 * Result of an incremental sync. Caller should: ingest `added` (+ later `modified`),
 * delete `removedExternalIds`, then persist `cursor` for the next sync.
 */
export interface AggregatorSyncResult {
  added: AggregatorTransaction[];
  modified: AggregatorTransaction[];
  removedExternalIds: string[];
  cursor: string | null; // null if the vendor is date-based rather than cursor-based
}

export interface Aggregator {
  readonly name: string;
  isConfigured(): boolean;
  /** Token/identifier used to open the vendor's link widget in the browser. */
  linkToken(userId: string): Promise<AggregatorResult<string>>;
  /** Link token to re-authenticate an EXISTING connection (update mode) — keeps the access token. */
  linkTokenForUpdate(accessToken: string): Promise<AggregatorResult<string>>;
  /** Revoke the access token at the vendor (called on disconnect). */
  removeItem(accessToken: string): Promise<AggregatorResult<void>>;
  /** Exchange the public token from the widget for an access token + item id. */
  exchange(
    publicToken: string,
  ): Promise<AggregatorResult<{ accessToken: string; itemId: string }>>;
  listAccounts(accessToken: string): Promise<AggregatorResult<AggregatorAccount[]>>;
  /** Incremental sync from a saved cursor (null/undefined = full initial sync). */
  syncTransactions(
    accessToken: string,
    cursor?: string | null,
  ): Promise<AggregatorResult<AggregatorSyncResult>>;
  verifyWebhook(rawBody: string, signature: string): boolean;
}
