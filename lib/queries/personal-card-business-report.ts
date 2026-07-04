import type { PeriodRange } from "@/lib/period";
import { rowsToCsv } from "@/lib/csv";
import { isBookedOperatingExpense } from "@/lib/category-expense";
import { createClient } from "@/lib/supabase/server";
import { fetchLedgerExpenseLines } from "@/lib/queries/ledger-expense-lines";

/** Personal credit cards only — not checking (transfers are separate). */
export const PERSONAL_CARD_SLUGS = [
  "amex-alex-personal",
  "citi-aadvantage-alex",
  "cap-one-alex-platinum",
  "wf-personal-cc",
  "citi-strata-claudia",
  "united-chase-claudia",
];

export type PersonalCardBusinessRow = {
  transaction_date: string;
  account_name: string;
  account_slug: string;
  category_name: string;
  description: string;
  vendor: string | null;
  amount: number;
  notes: string | null;
};

export type PersonalCardBusinessReport = {
  rows: PersonalCardBusinessRow[];
  grandTotal: number;
  transactionCount: number;
};

export async function getPersonalCardBusinessReport(period: PeriodRange): Promise<PersonalCardBusinessReport> {
  const supabase = await createClient();
  const { start, end } = period;

  const { data: gbsl } = await supabase.from("entities").select("id").eq("slug", "gbsl").single();
  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, slug")
    .in("slug", PERSONAL_CARD_SLUGS);

  if (!gbsl || !accounts?.length) {
    return { rows: [], grandTotal: 0, transactionCount: 0 };
  }

  const personalCardIds = accounts.map((a) => a.id);

  // Splits: a personal-card charge split so a portion is GBSL surfaces as a GBSL leg (leg.entity=gbsl,
  // parent account ∈ personal cards). The materializer handles both whole rows and legs; legs mirror
  // the parent sign, so the business portion of a positive charge is positive (kept by amount > 0).
  const lines = await fetchLedgerExpenseLines({
    supabase,
    start,
    end,
    entityId: gbsl.id,
    accountIds: personalCardIds,
  });

  const all: PersonalCardBusinessRow[] = lines
    .filter((line) => line.amount > 0)
    .map((line) => ({
      transaction_date: line.transaction_date,
      account_name: line.account?.display_name ?? "",
      account_slug: line.account?.slug ?? "",
      category_name: line.classification.category?.full_path ?? "Uncategorized",
      description: line.description,
      vendor: line.vendor,
      amount: line.amount,
      notes: line.classification.notes,
    }));

  // BUG-04/QA-01: shared predicate excludes AMA from grandTotal. Rows are pre-filtered to amount>0
  // (line above), so signed == positive here — netting refunds would need removing .gt("amount", 0).
  const expenseRows = all.filter((row) => isBookedOperatingExpense(row.category_name));
  const grandTotal = expenseRows.reduce((sum, row) => sum + row.amount, 0);
  return {
    rows: all.sort((a, b) => a.transaction_date.localeCompare(b.transaction_date)),
    grandTotal,
    transactionCount: all.length,
  };
}

export function personalCardBusinessToCsv(rows: PersonalCardBusinessRow[]) {
  const header = [
    "date",
    "account",
    "category",
    "vendor",
    "description",
    "amount",
    "counts_as_expense",
    "expense_amount",
    "notes",
  ];
  return rowsToCsv(
    header,
    rows.map((row) => {
      const countsAsExpense = isBookedOperatingExpense(row.category_name);
      return [
        row.transaction_date,
        row.account_name,
        row.category_name,
        row.vendor,
        row.description,
        row.amount.toFixed(2),
        countsAsExpense ? "yes" : "no",
        countsAsExpense ? row.amount.toFixed(2) : "0.00",
        row.notes,
      ];
    }),
  );
}
