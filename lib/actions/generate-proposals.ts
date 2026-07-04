"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { chunk } from "@/lib/supabase/chunk";
import { paginateAll } from "@/lib/supabase/paginate";
import { CLASSIFIABLE_SLUGS } from "@/lib/suggestions/proposal-ranking";
import {
  buildTrainingProposals,
  excludeCommitted,
  type ProposalRow,
  type TrainingRow,
  type UnclassifiedRow,
} from "@/lib/suggestions/generate-proposals";

export type GenerateProposalsResult = {
  generated: number;
  skippedCommitted: number;
  byEntity: { slug: string; generated: number }[];
};

/**
 * #4 — regenerate deterministic (training-based) proposals in-app for one entity or all classifiable
 * entities. Service-role (privileged read of qb_training_expenses + write to the staging table). All
 * writes go to classification_proposals — the ledger is never touched until the operator clicks Commit.
 */
export async function generateProposals(
  entitySlug?: string,
): Promise<GenerateProposalsResult | { error: string }> {
  const { error: authError } = await requireUser();
  if (authError) return { error: authError };

  try {
    const admin = createServiceRoleClient();

    // Active category map (id -> full_path); inactive excluded so we never propose a hidden category.
    const { data: cats, error: catErr } = await admin
      .from("categories")
      .select("id, full_path, is_active");
    if (catErr) return { error: catErr.message };
    const activePathById = new Map<string, string>();
    for (const c of (cats ?? []) as { id: string; full_path: string; is_active: boolean }[]) {
      if (c.is_active) activePathById.set(c.id, c.full_path);
    }

    const { data: ents, error: entErr } = await admin.from("entities").select("id, slug");
    if (entErr) return { error: entErr.message };
    const entityIdBySlug = new Map<string, string>(
      ((ents ?? []) as { id: string; slug: string }[]).map((e) => [e.slug, e.id]),
    );

    const targetSlugs =
      entitySlug && CLASSIFIABLE_SLUGS.includes(entitySlug as (typeof CLASSIFIABLE_SLUGS)[number])
        ? [entitySlug]
        : [...CLASSIFIABLE_SLUGS];

    const allProposals: ProposalRow[] = [];
    const byEntity: { slug: string; generated: number }[] = [];

    for (const slug of targetSlugs) {
      const entityId = entityIdBySlug.get(slug);
      if (!entityId) {
        byEntity.push({ slug, generated: 0 });
        continue;
      }

      const training = await paginateAll<TrainingRow & { id: string }>(
        async (from, size) => {
          const { data, error } = await admin
            .from("qb_training_expenses")
            .select("id, category_id, vendor_name, description")
            .eq("entity_id", entityId)
            .not("category_id", "is", null)
            .order("id", { ascending: true })
            .range(from, from + size - 1);
          return { data: data as (TrainingRow & { id: string })[] | null, error };
        },
        1000,
        (r) => r.id,
      );

      type RawUnclassified = {
        transaction_id: string;
        transactions: { description: string | null; vendor: string | null } | { description: string | null; vendor: string | null }[] | null;
      };
      const unclassifiedRaw = await paginateAll<RawUnclassified>(
        async (from, size) => {
          const { data, error } = await admin
            .from("classifications")
            .select("transaction_id, transactions!inner(description, vendor)")
            .eq("entity_id", entityId)
            .is("category_id", null)
            .order("transaction_id", { ascending: true })
            .range(from, from + size - 1);
          return { data: data as RawUnclassified[] | null, error };
        },
        1000,
        (r) => r.transaction_id,
      );
      const unclassified: UnclassifiedRow[] = unclassifiedRaw.map((r) => {
        const tx = Array.isArray(r.transactions) ? r.transactions[0] : r.transactions;
        return {
          transaction_id: r.transaction_id,
          description: tx?.description ?? null,
          vendor: tx?.vendor ?? null,
        };
      });

      const proposals = buildTrainingProposals({
        entityId,
        entitySlug: slug,
        activePathById,
        training,
        unclassified,
      });
      byEntity.push({ slug, generated: proposals.length });
      allProposals.push(...proposals);
    }

    // 🔴 CRITICAL guard: never un-commit. Drop proposals whose txn already has a committed proposal.
    const committed = new Set<string>();
    for (const ids of chunk(allProposals.map((p) => p.transaction_id), 200)) {
      const { data, error } = await admin
        .from("classification_proposals")
        .select("transaction_id")
        .in("transaction_id", ids)
        .eq("status", "committed");
      if (error) return { error: error.message };
      for (const r of (data ?? []) as { transaction_id: string }[]) committed.add(r.transaction_id);
    }
    const toWrite = excludeCommitted(allProposals, committed);

    let written = 0;
    for (const rows of chunk(toWrite, 200)) {
      const { error } = await admin
        .from("classification_proposals")
        .upsert(rows, { onConflict: "transaction_id" });
      if (error) return { error: error.message };
      written += rows.length;
    }

    revalidatePath("/review/proposals");

    return {
      generated: written,
      skippedCommitted: allProposals.length - toWrite.length,
      byEntity,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Generate failed" };
  }
}
