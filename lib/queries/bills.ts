import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { chunk } from "@/lib/supabase/chunk";
import { getClassifiableEntities } from "@/lib/queries/review";
import { fetchPeriodTransactions } from "@/lib/queries/fetch-period-transactions";
import { getEntityDisplay, type EntityDisplayMeta } from "@/lib/entities/display";
import { extractVendorSearchKey } from "@/lib/suggestions/category-suggestions";
import { parseIsoDate, toIsoDate, todayIso } from "@/lib/bills/cadence";
import { deriveBillState, isOutstanding, type BillState } from "@/lib/bills/state";
import { computeDueInstances, type BillDef, type DueInstanceRow } from "@/lib/bills/instances";
import {
  detectRecurringBills,
  scoreBillMatch,
  MIN_MATCH_SCORE,
  type RecurringCandidate,
} from "@/lib/bills/match";
import { dateWindowForCadence, type Bill, type BillInstance } from "@/lib/bills/types";

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

export type BillRow = {
  bill: Bill;
  instance: BillInstance;
  state: BillState;
  categoryPath: string | null;
};

export type EntityBillsGroup = {
  entitySlug: string;
  entityName: string;
  display: EntityDisplayMeta;
  rows: BillRow[];
  totalDue: number;
};

export type BillsDashboard = {
  groups: EntityBillsGroup[];
  totalDue: number;
  outstandingCount: number;
};

const STATE_ORDER: Record<BillState, number> = {
  overdue: 0,
  due_soon: 1,
  upcoming: 2,
  paid: 3,
  skipped: 4,
};

/** One row per bill: the earliest OPEN instance (most urgent), else the latest resolved one. */
function pickPrimaryInstance(instancesAsc: BillInstance[]): BillInstance | null {
  const open = instancesAsc.filter((i) => i.status === "open");
  if (open.length > 0) return open[0];
  if (instancesAsc.length > 0) return instancesAsc[instancesAsc.length - 1];
  return null;
}

export async function getBillsDashboard(entitySlug?: string): Promise<BillsDashboard> {
  const db = await billsTable();
  const today = todayIso();
  const entities = await getClassifiableEntities();
  const entityById = new Map(entities.map((e) => [e.id, e]));
  const displayOrder = new Map(entities.map((e, i) => [e.slug, e.display_order ?? i]));

  const targetEntityId = entitySlug ? entities.find((e) => e.slug === entitySlug)?.id : undefined;
  if (entitySlug && !targetEntityId) return { groups: [], totalDue: 0, outstandingCount: 0 };

  let billsQuery = db
    .from("bills")
    .select("*, category:categories(full_path)")
    .in("status", ["active", "paused"]);
  if (targetEntityId) billsQuery = billsQuery.eq("entity_id", targetEntityId);
  const { data: billData, error: billsError } = await billsQuery.order("name");
  if (billsError) throw billsError;
  const bills = (billData ?? []) as (Bill & { category: { full_path: string } | null })[];
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

  const byBill = new Map<string, BillInstance[]>();
  for (const inst of instances) {
    const list = byBill.get(inst.bill_id) ?? [];
    list.push(inst);
    byBill.set(inst.bill_id, list);
  }

  const groupsMap = new Map<string, EntityBillsGroup>();
  let totalDue = 0;
  let outstandingCount = 0;

  for (const bill of bills) {
    const entity = entityById.get(bill.entity_id);
    if (!entity) continue;
    const instancesAsc = (byBill.get(bill.id) ?? []).sort((a, b) =>
      a.due_date.localeCompare(b.due_date),
    );
    const primary = pickPrimaryInstance(instancesAsc);
    if (!primary) continue;

    const state = deriveBillState({ dueDate: primary.due_date, status: primary.status, today });
    const group =
      groupsMap.get(entity.slug) ??
      ({
        entitySlug: entity.slug,
        entityName: entity.name,
        display: getEntityDisplay(entity.slug),
        rows: [],
        totalDue: 0,
      } satisfies EntityBillsGroup);

    group.rows.push({ bill, instance: primary, state, categoryPath: bill.category?.full_path ?? null });
    if (isOutstanding(state)) {
      const amount = primary.expected_amount ?? bill.expected_amount ?? 0;
      group.totalDue += amount;
      totalDue += amount;
      outstandingCount += 1;
    }
    groupsMap.set(entity.slug, group);
  }

  const groups = [...groupsMap.values()]
    .map((g) => ({
      ...g,
      rows: g.rows.sort(
        (a, b) =>
          STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
          a.instance.due_date.localeCompare(b.instance.due_date),
      ),
    }))
    .sort((a, b) => (displayOrder.get(a.entitySlug) ?? 0) - (displayOrder.get(b.entitySlug) ?? 0));

  return { groups, totalDue, outstandingCount };
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

  // Transactions already linked to some instance must not be re-suggested elsewhere.
  const linkedTxnIds = new Set<string>();
  const billIds = [...new Set(openInstances.map((i) => i.bill.id))];
  for (const ids of chunk(billIds, 200)) {
    const { data } = await db
      .from("bill_instances")
      .select("matched_transaction_id")
      .in("bill_id", ids)
      .not("matched_transaction_id", "is", null);
    for (const row of (data ?? []) as { matched_transaction_id: string }[]) {
      linkedTxnIds.add(row.matched_transaction_id);
    }
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
              expected_amount: inst.bill.expected_amount,
              amount_varies: inst.bill.amount_varies,
            },
            instance: { due_date: inst.due_date, expected_amount: inst.expected_amount },
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
          expectedAmount: inst.expected_amount,
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
  return (data as Bill | null) ?? null;
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
