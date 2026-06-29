import type { PeriodRange } from "@/lib/period";
import { rowsToCsv } from "@/lib/csv";
import { isBookedOperatingExpense } from "@/lib/category-expense";
import { createClient } from "@/lib/supabase/server";
import { paginateAll } from "@/lib/supabase/paginate";

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

  const data = await paginateAll(async (from, pageSize) => {
    const { data: page, error } = await supabase
      .from("transactions")
      .select(
        `
        transaction_date,
        description,
        vendor,
        amount,
        account_id,
        account:accounts!inner(display_name, slug),
        classification:classifications!inner(
          notes,
          entity_id,
          category:categories(full_path)
        )
      `,
      )
      .in("account_id", personalCardIds)
      .eq("classification.entity_id", gbsl.id)
      .gte("transaction_date", start)
      .lt("transaction_date", end)
      .gt("amount", 0)
      .order("transaction_date")
      .order("id")
      .range(from, from + pageSize - 1);

    return { data: page ?? [], error };
  });

  const all: PersonalCardBusinessRow[] = data.map((row) => ({
    transaction_date: row.transaction_date,
    account_name: row.account.display_name,
    account_slug: row.account.slug,
    category_name: row.classification.category?.full_path ?? "Uncategorized",
    description: row.description,
    vendor: row.vendor,
    amount: Number(row.amount),
    notes: row.classification.notes,
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
