import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { paginateAll } from "@/lib/supabase/paginate";

// classification_proposals is a Stage-2 staging table not yet in the generated DB types
// (no supabase CLI to regen). Access it through an untyped client view; shapes are asserted here.
function proposalsTable() {
  return createClient().then((c) => c as unknown as SupabaseClient);
}

export type ProposalConfidence = "high" | "medium" | "low";
export type ProposalSource = "training" | "claude";
export type ProposalStatus = "pending" | "approved" | "rejected" | "committed";

export type Proposal = {
  id: string;
  transaction_id: string;
  entity_id: string;
  entity_slug: string;
  vendor_key: string;
  proposed_category_id: string | null;
  proposed_category_path: string | null;
  chosen_category_id: string | null;
  chosen_entity_id: string | null;
  confidence: ProposalConfidence;
  source: ProposalSource;
  rationale: string | null;
  status: ProposalStatus;
  description: string;
  vendor: string | null;
  amount: number;
  transaction_date: string;
  account_display_name: string;
};

type RawRow = Omit<Proposal, "description" | "vendor" | "amount" | "transaction_date" | "account_display_name"> & {
  transactions: {
    description: string;
    vendor: string | null;
    amount: number | string;
    transaction_date: string;
    accounts: { display_name: string } | null;
  } | null;
};

const PAGE = 1000;
const CLASSIFIABLE_SLUGS = ["gbsl", "keller", "personal", "acaa-austin", "pflugerville"];

/** Pending/approved proposal counts per entity, for the entity tabs. Uses server-side head counts
 *  (count:exact, head:true) so there is no 1000-row PostgREST cap. */
export const getProposalEntityCounts = cache(async (): Promise<
  Record<string, { pending: number; approved: number }>
> => {
  const db = await proposalsTable();
  const out: Record<string, { pending: number; approved: number }> = {};
  await Promise.all(
    CLASSIFIABLE_SLUGS.map(async (slug) => {
      const [pendingRes, approvedRes] = await Promise.all([
        db
          .from("classification_proposals")
          .select("*", { count: "exact", head: true })
          .eq("entity_slug", slug)
          .eq("status", "pending"),
        db
          .from("classification_proposals")
          .select("*", { count: "exact", head: true })
          .eq("entity_slug", slug)
          .eq("status", "approved"),
      ]);
      out[slug] = { pending: pendingRes.count ?? 0, approved: approvedRes.count ?? 0 };
    }),
  );
  return out;
});

/** All actionable (pending+approved) proposals for one entity, with transaction details. */
export async function getProposalsForEntity(entitySlug: string): Promise<Proposal[]> {
  const db = await proposalsTable();
  // Order by vendor_key (groups vendors together for the UI) THEN by the unique `id` tiebreaker so
  // offset pagination stays stable past 1000 rows — a non-unique sort alone silently skips/dups rows
  // across page boundaries (BUG-05 / C10). paginateAll's `key` guard throws if that ever recurs.
  const rows = await paginateAll<RawRow>(
    (from, pageSize) =>
      db
        .from("classification_proposals")
        .select(
          `id, transaction_id, entity_id, entity_slug, vendor_key,
           proposed_category_id, proposed_category_path, chosen_category_id, chosen_entity_id,
           confidence, source, rationale, status,
           transactions!inner ( description, vendor, amount, transaction_date, accounts!inner ( display_name ) )`,
        )
        .eq("entity_slug", entitySlug)
        .in("status", ["pending", "approved"])
        .order("vendor_key", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1) as unknown as PromiseLike<{
        data: RawRow[] | null;
        error: { message: string } | null;
      }>,
    PAGE,
    (r) => r.id,
  );

  return rows.map((r) => ({
    id: r.id,
    transaction_id: r.transaction_id,
    entity_id: r.entity_id,
    entity_slug: r.entity_slug,
    vendor_key: r.vendor_key,
    proposed_category_id: r.proposed_category_id,
    proposed_category_path: r.proposed_category_path,
    chosen_category_id: r.chosen_category_id,
    chosen_entity_id: r.chosen_entity_id,
    confidence: r.confidence,
    source: r.source,
    rationale: r.rationale,
    status: r.status,
    description: r.transactions?.description ?? "",
    vendor: r.transactions?.vendor ?? null,
    amount: Number(r.transactions?.amount ?? 0),
    transaction_date: r.transactions?.transaction_date ?? "",
    account_display_name: r.transactions?.accounts?.display_name ?? "",
  }));
}
