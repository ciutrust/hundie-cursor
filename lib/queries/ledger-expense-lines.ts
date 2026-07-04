import type { SupabaseClient } from "@supabase/supabase-js";
import type { createClient } from "@/lib/supabase/server";
import { paginateAll } from "@/lib/supabase/paginate";
import { fetchPeriodTransactions } from "@/lib/queries/fetch-period-transactions";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * A single "expense line" for the rollup / report / CPA layer.
 *
 * The whole point of splits: a normal transaction is one line; a SPLIT transaction is replaced by
 * N leg lines, each carrying the LEG's entity/category/amount but the PARENT's date/description/
 * vendor/account. Because the shape is a superset of every expense consumer's row, each consumer
 * reads the subset it already read (amount, classification.entity_id, classification.category.full_path,
 * …) with no other change — the existing category-kind + signed-sum math applies to legs identically.
 *
 * Split PARENTS are dropped (fetchPeriodTransactions defaults `excludeSplitParents: true`); their legs
 * are added from transaction_splits. Plaid-removed rows are excluded on both sides.
 */
export type LedgerExpenseLine = {
  /** Parent transaction id (legs of one split share it). */
  id: string;
  /** transaction_splits.id when this line is a split leg; null for a whole (non-split) transaction. */
  legId: string | null;
  amount: number;
  transaction_date: string;
  description: string;
  vendor: string | null;
  account: { id: string; display_name: string; slug: string; account_type: string | null } | null;
  classification: {
    entity_id: string;
    category_id: string | null;
    notes: string | null;
    entity: { id: string; name: string; slug: string } | null;
    category: LedgerCategory | null;
  };
};

/** Category fields any expense/CPA consumer reads (full_path for kind math; tax_* for the tax rollup). */
type LedgerCategory = {
  id: string;
  full_path: string;
  tax_form: string | null;
  tax_line: string | null;
};

const LEDGER_SELECT = `
  id,
  transaction_date,
  amount,
  description,
  vendor,
  account:accounts!inner(id, display_name, slug, account_type),
  classification:classifications!inner(
    entity_id,
    category_id,
    notes,
    entity:entities!inner(id, name, slug),
    category:categories(id, full_path, tax_form, tax_line)
  )
`;

type WholeRow = {
  id: string;
  transaction_date: string;
  amount: number | string;
  description: string;
  vendor: string | null;
  account: { id: string; display_name: string; slug: string; account_type: string | null } | null;
  classification: {
    entity_id: string;
    category_id: string | null;
    notes: string | null;
    entity: { id: string; name: string; slug: string } | null;
    category: LedgerCategory | null;
  };
};

const LEG_SELECT = `
  id,
  entity_id,
  category_id,
  amount,
  transaction:transactions!inner(
    id, transaction_date, description, vendor, account_id, split_at, plaid_removed_at,
    account:accounts!inner(id, display_name, slug, account_type)
  ),
  entity:entities!inner(id, name, slug),
  category:categories(id, full_path, tax_form, tax_line)
`;

type LegRow = {
  id: string;
  entity_id: string;
  category_id: string | null;
  amount: number | string;
  transaction: {
    id: string;
    transaction_date: string;
    description: string;
    vendor: string | null;
    account: { id: string; display_name: string; slug: string; account_type: string | null } | null;
  } | null;
  entity: { id: string; name: string; slug: string } | null;
  category: LedgerCategory | null;
};

export type LedgerExpenseLinesOptions = {
  supabase: ServerClient;
  start: string;
  end: string;
  /** Scope to one entity (matches a whole tx's classification entity AND a leg's OWN entity). */
  entityId?: string;
  entitySlug?: string;
  /** Scope to a set of accounts (whole tx account_id AND a leg's parent account_id). */
  accountIds?: string[];
};

/**
 * The single source of expense lines with splits applied. Fetch A = non-split transactions (via the
 * shared fetcher, which drops split parents + Plaid-removed by default); Fetch B = split legs, filtered
 * by the LEG's own entity (so an Austin-ACAA leg of a Personal-card charge lands in Austin ACAA even
 * though the parent's classification entity is Personal). Merge, don't sum here — callers apply their
 * own category-kind + signed-sum reducers.
 */
export async function fetchLedgerExpenseLines(
  opts: LedgerExpenseLinesOptions,
): Promise<LedgerExpenseLine[]> {
  const { supabase, start, end, entityId, entitySlug, accountIds } = opts;

  const [wholeRows, legRows] = await Promise.all([
    // Fetch A — non-split transactions. excludeSplitParents defaults true → split parents excluded.
    fetchPeriodTransactions<WholeRow>({
      supabase,
      select: LEDGER_SELECT,
      start,
      end,
      entityId,
      entitySlug,
      accountIds,
    }),
    // Fetch B — split legs, embedding the parent for date/desc/vendor/account + the period filter.
    // transaction_splits is a Stage-2 table not in the generated DB types (like classification_proposals
    // in lib/queries/proposals.ts) — access it via an untyped client view.
    paginateAll<LegRow>(
      async (from, pageSize) => {
        let query = (supabase as unknown as SupabaseClient)
          .from("transaction_splits")
          .select(LEG_SELECT)
          .gte("transaction.transaction_date", start)
          .lt("transaction.transaction_date", end)
          .is("transaction.plaid_removed_at", null)
          .order("id")
          .range(from, from + pageSize - 1);
        // Filter on the LEG's own entity — the crux of cross-entity splits.
        if (entityId) query = query.eq("entity_id", entityId);
        if (entitySlug) query = query.eq("entity.slug", entitySlug);
        if (accountIds && accountIds.length > 0) query = query.in("transaction.account_id", accountIds);
        const { data, error } = await query;
        return { data: data as unknown as LegRow[] | null, error };
      },
      1000,
      (r) => r.id,
    ),
  ]);

  const wholeLines: LedgerExpenseLine[] = wholeRows.map((row) => ({
    id: row.id,
    legId: null,
    amount: Number(row.amount),
    transaction_date: row.transaction_date,
    description: row.description,
    vendor: row.vendor,
    account: row.account,
    classification: {
      entity_id: row.classification.entity_id,
      category_id: row.classification.category_id,
      notes: row.classification.notes,
      entity: row.classification.entity,
      category: row.classification.category,
    },
  }));

  const legLines: LedgerExpenseLine[] = legRows
    .filter((leg) => leg.transaction != null)
    .map((leg) => ({
      id: leg.transaction!.id,
      legId: leg.id,
      amount: Number(leg.amount),
      transaction_date: leg.transaction!.transaction_date,
      description: leg.transaction!.description,
      vendor: leg.transaction!.vendor,
      account: leg.transaction!.account,
      classification: {
        entity_id: leg.entity_id,
        category_id: leg.category_id,
        // Per-leg notes are not stored (transaction_splits has no notes column in v1).
        notes: null,
        entity: leg.entity,
        category: leg.category,
      },
    }));

  return [...wholeLines, ...legLines];
}
