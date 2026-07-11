import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { chunk } from "@/lib/supabase/chunk";
import { getClassifiableEntities } from "@/lib/queries/review";
import { fetchPeriodTransactions } from "@/lib/queries/fetch-period-transactions";
import { extractVendorSearchKey } from "@/lib/suggestions/category-suggestions";
import { parseIsoDate, toIsoDate, todayIso } from "@/lib/bills/cadence";
import { computeDueInstances, type BillDef, type DueInstanceRow } from "@/lib/bills/instances";
import {
  detectRecurringBills,
  scoreBillMatch,
  MIN_MATCH_SCORE,
  type RecurringCandidate,
} from "@/lib/bills/match";
import { dateWindowForCadence, numOrNull, type Bill, type BillInstance } from "@/lib/bills/types";
import {
  buildBillsDashboard,
  type BillWithCategory,
  type BillRow,
  type EntityBillsGroup,
  type BillsDashboard,
} from "@/lib/bills/dashboard";

export type { BillRow, EntityBillsGroup, BillsDashboard };

// bills / bill_instances aren't in the generated DB types (no supabase CLI to regen). Access them
// through an untyped client view; the row shapes are asserted here (mirrors lib/queries/proposals.ts).
function billsTable(): Promise<SupabaseClient> {
  return createClient().then((c) => c as unknown as SupabaseClient);
}

function isoShift(iso: string, days: number): string {
  const date = parseIsoDate(iso);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

// ---------------------------------------------------------------------------
// Lazy instance generation
// ---------------------------------------------------------------------------

type GeneratableBill = Pick<
  Bill,
  "id" | "entity_id" | "cadence" | "due_day" | "anchor_date" | "expected_amount" | "status"
>;

/**
 * Ensure every active bill has its current + next open instance. Reads the latest existing due_date
 * per bill, computes the missing rows, and upserts with onConflict:(bill_id,due_date)+ignoreDuplicates
 * so concurrent dashboard loads are race-safe (the unique constraint absorbs the collision).
 */
export async function ensureBillInstances(
  db: SupabaseClient,
  bills: GeneratableBill[],
  today: string,
): Promise<void> {
  if (bills.length === 0) return;
  const billIds = bills.map((b) => b.id);

  const latest = new Map<string, string>();
  for (const ids of chunk(billIds, 200)) {
    const { data, error } = await db
      .from("bill_instances")
      .select("bill_id, due_date")
      .in("bill_id", ids)
      .order("due_date", { ascending: false });
    if (error) throw error;
    for (const row of (data ?? []) as { bill_id: string; due_date: string }[]) {
      // desc order → the first row seen for a bill is its max due_date.
      if (!latest.has(row.bill_id)) latest.set(row.bill_id, row.due_date);
    }
  }

  const rows: DueInstanceRow[] = [];
  for (const bill of bills) {
    const def: BillDef = {
      id: bill.id,
      entity_id: bill.entity_id,
      cadence: bill.cadence,
      due_day: bill.due_day,
      anchor_date: bill.anchor_date,
      expected_amount: bill.expected_amount,
      status: bill.status,
    };
    rows.push(
      ...computeDueInstances({ bill: def, latestDueDate: latest.get(bill.id) ?? null, today }),
    );
  }
  if (rows.length === 0) return;

  // status:'open' is set explicitly (the column also defaults to it) so a freshly generated cycle is
  // unambiguously open in both Postgres and the in-memory test fake. ignoreDuplicates means an
  // existing (bill_id,due_date) — e.g. an already-paid cycle — is never touched.
  for (const batch of chunk(rows, 200)) {
    const { error } = await db
      .from("bill_instances")
      .upsert(
        batch.map((row) => ({ ...row, status: "open" as const })),
        { onConflict: "bill_id,due_date", ignoreDuplicates: true },
      );
    if (error) throw error;
  }
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export async function getBillsDashboard(entitySlug?: string): Promise<BillsDashboard> {
  const db = await billsTable();
  const today = todayIso();
  const entities = await getClassifiableEntities();

  const targetEntityId = entitySlug ? entities.find((e) => e.slug === entitySlug)?.id : undefined;
  if (entitySlug && !targetEntityId) return { groups: [], totalDue: 0, outstandingCount: 0 };

  let billsQuery = db
    .from("bills")
    .select("*, category:categories(full_path)")
    .in("status", ["active", "paused"]);
  if (targetEntityId) billsQuery = billsQuery.eq("entity_id", targetEntityId);
  const { data: billData, error: billsError } = await billsQuery.order("name");
  if (billsError) throw billsError;
  const bills = (billData ?? []) as BillWithCategory[];
  if (bills.length === 0) return { groups: [], totalDue: 0, outstandingCount: 0 };

  await ensureBillInstances(db, bills.filter((b) => b.status === "active"), today);

  const billIds = bills.map((b) => b.id);
  const cutoff = isoShift(today, -60);
  const instances: BillInstance[] = [];
  for (const ids of chunk(billIds, 200)) {
    const { data, error } = await db
      .from("bill_instances")
      .select("*")
      .in("bill_id", ids)
      .or(`status.eq.open,due_date.gte.${cutoff}`)
      .order("due_date");
    if (error) throw error;
    instances.push(...((data ?? []) as BillInstance[]));
  }

  // Grouping + amount coercion + totals live in the pure buildBillsDashboard (unit-tested with the
  // PostgREST string amounts production actually returns).
  return buildBillsDashboard({ bills, instances, entities, today });
}

// ---------------------------------------------------------------------------
// Payment suggestions (computed on read, no staging table)
// ---------------------------------------------------------------------------

export type BillPaymentSuggestion = {
  instanceId: string;
  billId: string;
  billName: string;
  entitySlug: string;
  dueDate: string;
  expectedAmount: number | null;
  transactionId: string;
  transactionDescription: string;
  transactionVendor: string | null;
  transactionAmount: number;
  transactionDate: string;
  score: number;
};

type CandidateTxn = {
  id: string;
  transaction_date: string;
  amount: number | string;
  description: string;
  vendor: string | null;
};

type OpenInstanceRow = BillInstance & {
  bill: {
    id: string;
    name: string;
    entity_id: string;
    match_hint: string | null;
    expected_amount: number | null;
    amount_varies: boolean;
    cadence: Bill["cadence"];
    status: Bill["status"];
  };
};

const CANDIDATE_SELECT =
  "id, transaction_date, amount, description, vendor, classification:classifications!inner(entity_id)";

export async function getPaymentSuggestions(entitySlug?: string): Promise<BillPaymentSuggestion[]> {
  const db = await billsTable();
  const supabase = await createClient();
  const entities = await getClassifiableEntities();
  const entityById = new Map(entities.map((e) => [e.id, e]));
  const targetEntityId = entitySlug ? entities.find((e) => e.slug === entitySlug)?.id : undefined;
  if (entitySlug && !targetEntityId) return [];

  let openQuery = db
    .from("bill_instances")
    .select(
      "*, bill:bills!inner(id, name, entity_id, match_hint, expected_amount, amount_varies, cadence, status)",
    )
    .eq("status", "open");
  if (targetEntityId) openQuery = openQuery.eq("entity_id", targetEntityId);
  const { data: openData, error: openError } = await openQuery;
  if (openError) throw openError;
  // Only active bills draw suggestions.
  const openInstances = ((openData ?? []) as OpenInstanceRow[]).filter(
    (i) => i.bill.status === "active",
  );
  if (openInstances.length === 0) return [];

  // Transactions already linked to ANY instance must not be re-suggested — including instances of a
  // paid one_time / paused / archived bill that no longer has an OPEN instance. Scoping this to only
  // the bills that currently have an open instance (the previous behavior) missed those links and let
  // one charge be confirmed against two bills. A transaction is classified to exactly one entity, so a
  // global exclusion set can never wrongly drop a candidate from a different entity.
  const linkedTxnIds = new Set<string>();
  const { data: linkedData, error: linkedError } = await db
    .from("bill_instances")
    .select("matched_transaction_id")
    .not("matched_transaction_id", "is", null);
  if (linkedError) throw linkedError;
  for (const row of (linkedData ?? []) as { matched_transaction_id: string }[]) {
    linkedTxnIds.add(row.matched_transaction_id);
  }

  const byEntity = new Map<string, OpenInstanceRow[]>();
  for (const inst of openInstances) {
    const list = byEntity.get(inst.entity_id) ?? [];
    list.push(inst);
    byEntity.set(inst.entity_id, list);
  }

  const suggestions: BillPaymentSuggestion[] = [];
  for (const [entityId, insts] of byEntity) {
    const entity = entityById.get(entityId);
    if (!entity) continue;
    const dueDates = insts.map((i) => i.due_date).sort();
    const start = isoShift(dueDates[0], -31);
    const end = isoShift(dueDates[dueDates.length - 1], 31);
    const txns = await fetchPeriodTransactions<CandidateTxn>({
      supabase,
      select: CANDIDATE_SELECT,
      start,
      end,
      entityId,
      order: "desc",
    });

    for (const inst of insts) {
      const dateWindowDays = dateWindowForCadence(inst.bill.cadence);
      let best: { txn: CandidateTxn; amount: number; score: number } | null = null;
      for (const txn of txns) {
        if (linkedTxnIds.has(txn.id)) continue;
        const amount = Number(txn.amount);
        const result = scoreBillMatch(
          {
            bill: {
              match_hint: inst.bill.match_hint,
              name: inst.bill.name,
              expected_amount: numOrNull(inst.bill.expected_amount),
              amount_varies: inst.bill.amount_varies,
            },
            instance: { due_date: inst.due_date, expected_amount: numOrNull(inst.expected_amount) },
            txn: { vendor: txn.vendor, description: txn.description, amount, transaction_date: txn.transaction_date },
          },
          { dateWindowDays },
        );
        if (result && result.score >= MIN_MATCH_SCORE && (!best || result.score > best.score)) {
          best = { txn, amount, score: result.score };
        }
      }
      if (best) {
        suggestions.push({
          instanceId: inst.id,
          billId: inst.bill.id,
          billName: inst.bill.name,
          entitySlug: entity.slug,
          dueDate: inst.due_date,
          expectedAmount: numOrNull(inst.expected_amount),
          transactionId: best.txn.id,
          transactionDescription: best.txn.description,
          transactionVendor: best.txn.vendor,
          transactionAmount: best.amount,
          transactionDate: best.txn.transaction_date,
          score: best.score,
        });
      }
    }
  }

  // One transaction can only pay one bill — keep the highest-scoring claim on each.
  const byTxn = new Map<string, BillPaymentSuggestion>();
  for (const suggestion of suggestions) {
    const existing = byTxn.get(suggestion.transactionId);
    if (!existing || suggestion.score > existing.score) byTxn.set(suggestion.transactionId, suggestion);
  }
  return [...byTxn.values()].sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Single bill (edit form) + onboarding seed candidates
// ---------------------------------------------------------------------------

export async function getBillById(id: string): Promise<Bill | null> {
  const db = await billsTable();
  const { data, error } = await db.from("bills").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const bill = data as Bill;
  return { ...bill, expected_amount: numOrNull(bill.expected_amount) };
}


type SeedTxn = {
  transaction_date: string;
  amount: number | string;
  description: string;
  vendor: string | null;
  classification: { entity_id: string; category_id: string | null } | null;
};

const SEED_SELECT =
  "transaction_date, amount, description, vendor, classification:classifications!inner(entity_id, category_id)";

/** Per classifiable entity, recurring-charge candidates not already covered by an existing bill. */
export async function getBillSeedCandidates(): Promise<Record<string, RecurringCandidate[]>> {
  const db = await billsTable();
  const supabase = await createClient();
  const today = todayIso();
  const entities = await getClassifiableEntities();

  const { data: existingBills } = await db
    .from("bills")
    .select("entity_id, name, match_hint")
    .in("status", ["active", "paused"]);
  const coveredByEntity = new Map<string, Set<string>>();
  for (const bill of (existingBills ?? []) as {
    entity_id: string;
    name: string;
    match_hint: string | null;
  }[]) {
    const key = extractVendorSearchKey("", bill.match_hint?.trim() || bill.name);
    const set = coveredByEntity.get(bill.entity_id) ?? new Set<string>();
    if (key) set.add(key);
    coveredByEntity.set(bill.entity_id, set);
  }

  const start = isoShift(today, -365);
  const end = isoShift(today, 1);
  const out: Record<string, RecurringCandidate[]> = {};
  for (const entity of entities) {
    const txns = await fetchPeriodTransactions<SeedTxn>({
      supabase,
      select: SEED_SELECT,
      start,
      end,
      entityId: entity.id,
    });
    const candidates = detectRecurringBills({
      transactions: txns.map((t) => ({
        vendor: t.vendor,
        description: t.description,
        amount: Number(t.amount),
        transaction_date: t.transaction_date,
        category_id: t.classification?.category_id ?? null,
      })),
      today,
    });
    const covered = coveredByEntity.get(entity.id) ?? new Set<string>();
    const fresh = candidates.filter((c) => !covered.has(c.vendorKey));
    if (fresh.length > 0) out[entity.slug] = fresh;
  }
  return out;
}
