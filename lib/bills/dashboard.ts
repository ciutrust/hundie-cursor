// Pure dashboard assembly: given raw bill + instance rows (amounts may arrive as PostgREST numeric
// STRINGS), the entity list, and today, group by entity, derive each bill's state, and total the
// outstanding amounts. Kept pure and separate from the DB fetch so it is unit-testable with the
// string amounts production actually sends (the fetch wrapper in lib/queries/bills.ts calls this).

import { getEntityDisplay, type EntityDisplayMeta } from "@/lib/entities/display";
import { deriveBillState, isOutstanding, type BillState } from "./state";
import { numOrNull, type Bill, type BillInstance } from "./types";

export type BillWithCategory = Bill & { category: { full_path: string } | null };

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

export type DashboardEntity = {
  id: string;
  slug: string;
  name: string;
  display_order?: number | null;
};

const STATE_ORDER: Record<BillState, number> = {
  overdue: 0,
  due_soon: 1,
  upcoming: 2,
  paid: 3,
  skipped: 4,
};

function coerceBill(bill: BillWithCategory): BillWithCategory {
  return { ...bill, expected_amount: numOrNull(bill.expected_amount) };
}

function coerceInstance(instance: BillInstance): BillInstance {
  return {
    ...instance,
    expected_amount: numOrNull(instance.expected_amount),
    paid_amount: numOrNull(instance.paid_amount),
  };
}

/** One row per bill: the earliest OPEN instance (most urgent), else the latest resolved one. */
function pickPrimaryInstance(instancesAsc: BillInstance[]): BillInstance | null {
  const open = instancesAsc.filter((i) => i.status === "open");
  if (open.length > 0) return open[0];
  if (instancesAsc.length > 0) return instancesAsc[instancesAsc.length - 1];
  return null;
}

export function buildBillsDashboard(input: {
  bills: BillWithCategory[];
  instances: BillInstance[];
  entities: DashboardEntity[];
  today: string;
}): BillsDashboard {
  const { today } = input;
  const bills = input.bills.map(coerceBill);
  const instances = input.instances.map(coerceInstance);
  const entityById = new Map(input.entities.map((e) => [e.id, e]));
  const displayOrder = new Map(input.entities.map((e, i) => [e.slug, e.display_order ?? i]));

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
      // Both amounts are coerced to numbers above, so this is real addition, not string concat.
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
