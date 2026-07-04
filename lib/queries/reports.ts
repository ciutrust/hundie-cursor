import type { PeriodRange } from "@/lib/period";
import { rowsToCsv } from "@/lib/csv";
import { isBookedOperatingExpense } from "@/lib/category-expense";
import { createClient } from "@/lib/supabase/server";
import { fetchLedgerExpenseLines } from "@/lib/queries/ledger-expense-lines";

export type ReportTransactionRow = {
  transaction_date: string;
  entity_name: string;
  entity_slug: string;
  account_name: string;
  description: string;
  vendor: string | null;
  amount: number;
  category_name: string;
  notes: string | null;
  counts_as_expense: boolean;
  expense_amount: number;
};

export async function getReportTransactions(
  period: PeriodRange,
  entitySlug?: string,
): Promise<ReportTransactionRow[]> {
  const supabase = await createClient();

  // Splits: each split leg exports as its own CPA row (parent's date/desc/vendor/account + the leg's
  // entity/category/amount). A split parent's whole line is dropped. The column still sums to the
  // netted entity total because the legs sum to the parent.
  const lines = await fetchLedgerExpenseLines({
    supabase,
    start: period.start,
    end: period.end,
    entitySlug,
  });

  return lines
    .slice()
    .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date))
    .map((line) => {
      const categoryPath = line.classification.category?.full_path ?? null;
      // BUG-04/QA-01: book by category kind (AMA + uncategorized excluded); signed expense_amount
      // so a refund row exports -50, not 0, and the column sums to the netted entity total.
      const isBooked = isBookedOperatingExpense(categoryPath);
      return {
        transaction_date: line.transaction_date,
        entity_name: line.classification.entity?.name ?? "",
        entity_slug: line.classification.entity?.slug ?? "",
        account_name: line.account?.display_name ?? "",
        description: line.description,
        vendor: line.vendor,
        amount: line.amount,
        category_name: categoryPath ?? "Uncategorized",
        notes: line.classification.notes,
        counts_as_expense: isBooked,
        expense_amount: isBooked ? line.amount : 0,
      };
    });
}

export function reportTransactionsToCsv(rows: ReportTransactionRow[]) {
  const header = [
    "date",
    "entity",
    "account",
    "vendor",
    "description",
    "amount",
    "counts_as_expense",
    "expense_amount",
    "category",
    "notes",
  ];
  return rowsToCsv(
    header,
    rows.map((row) => [
      row.transaction_date,
      row.entity_name,
      row.account_name,
      row.vendor,
      row.description,
      row.amount.toFixed(2),
      row.counts_as_expense ? "yes" : "no",
      row.expense_amount.toFixed(2),
      row.category_name,
      row.notes,
    ]),
  );
}

// ── #6: CPA packet — tax-line rollup export from /tax-close ──────────────────────────────────────
//
// Groups an entity's year of transactions by the (tax_form, tax_line) mapping already on `categories`
// (migration 20260705120000). tax_form='none' is intentionally excluded (personal / non-deductible /
// transfers); anything still unclassified OR mapped to a category with no tax line lands in a separate
// "CPA review needed" section so nothing is silently dropped. The DB read stays thin; the grouping is a
// pure function so the exclusions are unit-tested on a flat fixture.

export type TaxRollupInput = {
  amount: number;
  /** null = still unclassified (no category). */
  categoryPath: string | null;
  taxForm: string | null;
  taxLine: string | null;
};

export type TaxLineGroup = {
  taxForm: string;
  taxLine: string;
  category: string;
  count: number;
  amount: number;
};

export type TaxReviewGroup = {
  category: string;
  count: number;
  amount: number;
};

export type TaxLineRollup = {
  sections: TaxLineGroup[];
  review: TaxReviewGroup[];
  totalTxns: number;
  /** tax_form='none' rows (personal / non-deductible) — excluded from the tax sections, reported for transparency. */
  excludedCount: number;
};

const FORM_ORDER: Record<string, number> = {
  sch_c: 0,
  sch_e: 1,
  sch_a: 2,
  form_2441: 3,
  form_8889: 4,
};

export const TAX_FORM_LABELS: Record<string, string> = {
  sch_c: "Schedule C",
  sch_e: "Schedule E",
  sch_a: "Schedule A",
  form_2441: "Form 2441",
  form_8889: "Form 8889",
};

/** Pure: fold flat rows into per-(form,line,category) tax sections + a CPA-review bucket. */
export function buildTaxLineRollup(rows: TaxRollupInput[]): TaxLineRollup {
  const sections = new Map<string, TaxLineGroup>();
  const review = new Map<string, TaxReviewGroup>();
  let excludedCount = 0;

  const addReview = (category: string, amount: number) => {
    const g = review.get(category);
    if (g) {
      g.count += 1;
      g.amount += amount;
    } else {
      review.set(category, { category, count: 1, amount });
    }
  };

  for (const r of rows) {
    const amount = Number(r.amount);
    if (r.categoryPath === null) {
      addReview("Unclassified", amount);
      continue;
    }
    if (r.taxForm === "none") {
      excludedCount += 1;
      continue;
    }
    if (r.taxForm === null || r.taxLine === null) {
      // Category exists but its tax line isn't mapped yet — CPA decides where it goes.
      addReview(r.categoryPath, amount);
      continue;
    }
    const key = `${r.taxForm} ${r.taxLine} ${r.categoryPath}`;
    const g = sections.get(key);
    if (g) {
      g.count += 1;
      g.amount += amount;
    } else {
      sections.set(key, {
        taxForm: r.taxForm,
        taxLine: r.taxLine,
        category: r.categoryPath,
        count: 1,
        amount,
      });
    }
  }

  const sectionsArr = [...sections.values()].sort((a, b) => {
    const fa = FORM_ORDER[a.taxForm] ?? 99;
    const fb = FORM_ORDER[b.taxForm] ?? 99;
    if (fa !== fb) return fa - fb;
    if (a.taxForm !== b.taxForm) return a.taxForm.localeCompare(b.taxForm);
    if (a.taxLine !== b.taxLine) return a.taxLine.localeCompare(b.taxLine);
    return a.category.localeCompare(b.category);
  });
  const reviewArr = [...review.values()].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  return { sections: sectionsArr, review: reviewArr, totalTxns: rows.length, excludedCount };
}

export async function getTaxLineRollup(entitySlug: string, year: number): Promise<TaxLineRollup> {
  const supabase = await createClient();
  // Splits: legs roll up by their own entity + tax line (parent excluded), so the Anita rental-utility
  // leg of a Personal-card bill lands on the ACAA Schedule E rollup.
  const lines = await fetchLedgerExpenseLines({
    supabase,
    start: `${year}-01-01`,
    end: `${year + 1}-01-01`,
    entitySlug,
  });

  return buildTaxLineRollup(
    lines.map((line) => ({
      amount: line.amount,
      categoryPath: line.classification.category?.full_path ?? null,
      taxForm: line.classification.category?.tax_form ?? null,
      taxLine: line.classification.category?.tax_line ?? null,
    })),
  );
}

export function taxLineRollupToCsv(rollup: TaxLineRollup): string {
  const header = ["tax_form", "tax_line", "category", "num_transactions", "amount"];
  const rows: Array<Array<string | number | null>> = [];

  for (const s of rollup.sections) {
    rows.push([
      TAX_FORM_LABELS[s.taxForm] ?? s.taxForm,
      s.taxLine,
      s.category,
      s.count,
      s.amount.toFixed(2),
    ]);
  }
  for (const r of rollup.review) {
    rows.push(["Needs CPA review", "", r.category, r.count, r.amount.toFixed(2)]);
  }
  if (rollup.excludedCount > 0) {
    rows.push(["Excluded (personal / non-deductible)", "", "", rollup.excludedCount, ""]);
  }

  return rowsToCsv(header, rows);
}
