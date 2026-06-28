import type { PeriodRange } from "@/lib/period";
import { createClient } from "@/lib/supabase/server";
import { paginateAll } from "@/lib/supabase/paginate";

export type ReconcileRow = {
  side: "ledger" | "qbo";
  transaction_date: string;
  amount: number;
  description: string;
  vendor: string | null;
  category_name: string | null;
  match_status: "matched" | "ledger_only" | "qbo_only";
};

export type ReconcileSummary = {
  ledgerCount: number;
  qboCount: number;
  matchedCount: number;
  ledgerOnlyCount: number;
  qboOnlyCount: number;
  matchRate: number;
};

function normalizeText(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchScore(
  ledger: { description: string; vendor: string | null; amount: number },
  qb: { description: string | null; vendor_name: string | null; amount: number },
) {
  const ledgerAmount = Math.abs(Number(ledger.amount));
  const qbAmount = Math.abs(Number(qb.amount));
  if (ledgerAmount !== qbAmount) return 0;

  let score = 10;
  const ledgerText = normalizeText(`${ledger.vendor ?? ""} ${ledger.description ?? ""}`);
  const qbText = normalizeText(`${qb.vendor_name ?? ""} ${qb.description ?? ""}`);
  const words = new Set(ledgerText.split(" ").filter((w) => w.length >= 3));
  for (const word of qbText.split(" ").filter((w) => w.length >= 3)) {
    if (words.has(word)) score += 4;
  }
  return score;
}

export async function getGbslCheckingReconciliation(
  period: PeriodRange,
): Promise<{ summary: ReconcileSummary; rows: ReconcileRow[] }> {
  const supabase = await createClient();
  const { start, end } = period;

  const { data: gbsl } = await supabase.from("entities").select("id").eq("slug", "gbsl").single();
  const { data: checking } = await supabase
    .from("accounts")
    .select("id")
    .eq("slug", "wf-gbsl-checking")
    .single();

  if (!gbsl || !checking) {
    return {
      summary: {
        ledgerCount: 0,
        qboCount: 0,
        matchedCount: 0,
        ledgerOnlyCount: 0,
        qboOnlyCount: 0,
        matchRate: 0,
      },
      rows: [],
    };
  }

  // OPT-02: paginate both sides so neither is silently truncated at 1000 rows.
  const [ledgerRows, qboRows] = await Promise.all([
    paginateAll(async (from, pageSize) => {
      const { data, error } = await supabase
        .from("transactions")
        .select(
          `
          transaction_date,
          amount,
          description,
          vendor,
          classification:classifications!inner(
            category:categories(full_path)
          )
        `,
        )
        .eq("account_id", checking.id)
        .gte("transaction_date", start)
        .lt("transaction_date", end)
        .order("transaction_date")
        .order("id")
        .range(from, from + pageSize - 1);
      return { data, error };
    }),
    paginateAll(async (from, pageSize) => {
      const { data, error } = await supabase
        .from("qb_training_expenses")
        .select("id, transaction_date, amount, description, vendor_name, category_name")
        .eq("entity_id", gbsl.id)
        .ilike("source_account", "%Navigate%Business%Checking%")
        .gte("transaction_date", start)
        .lt("transaction_date", end)
        .order("transaction_date")
        .order("id")
        .range(from, from + pageSize - 1);
      return { data, error };
    }),
  ]);
  const usedQbo = new Set<number>();
  const rows: ReconcileRow[] = [];
  let matchedCount = 0;

  for (const item of ledgerRows) {
    const key = `${item.transaction_date}|${Math.abs(Number(item.amount)).toFixed(2)}`;
    const candidates = qboRows
      .map((qb, index) => ({ qb, index, score: matchScore(item, qb) }))
      .filter((c) => c.score >= 10 && `${c.qb.transaction_date}|${Math.abs(Number(c.qb.amount)).toFixed(2)}` === key)
      .sort((a, b) => b.score - a.score);

    const best = candidates.find((c) => !usedQbo.has(c.index) && c.score >= 13) ?? candidates.find((c) => !usedQbo.has(c.index));

    if (best) {
      usedQbo.add(best.index);
      matchedCount += 1;
      rows.push({
        side: "ledger",
        transaction_date: item.transaction_date,
        amount: Number(item.amount),
        description: item.description,
        vendor: item.vendor,
        category_name: item.classification.category?.full_path ?? best.qb.category_name,
        match_status: "matched",
      });
    } else {
      rows.push({
        side: "ledger",
        transaction_date: item.transaction_date,
        amount: Number(item.amount),
        description: item.description,
        vendor: item.vendor,
        category_name: item.classification.category?.full_path ?? null,
        match_status: "ledger_only",
      });
    }
  }

  for (let i = 0; i < qboRows.length; i++) {
    if (usedQbo.has(i)) continue;
    const qb = qboRows[i];
    rows.push({
      side: "qbo",
      transaction_date: qb.transaction_date,
      amount: Math.abs(Number(qb.amount)),
      description: qb.description ?? "",
      vendor: qb.vendor_name,
      category_name: qb.category_name,
      match_status: "qbo_only",
    });
  }

  rows.sort((a, b) => a.transaction_date.localeCompare(b.transaction_date));

  const ledgerOnlyCount = rows.filter((r) => r.match_status === "ledger_only").length;
  const qboOnlyCount = rows.filter((r) => r.match_status === "qbo_only").length;
  const matchRate = qboRows.length > 0 ? matchedCount / qboRows.length : 0;

  return {
    summary: {
      ledgerCount: ledgerRows.length,
      qboCount: qboRows.length,
      matchedCount,
      ledgerOnlyCount,
      qboOnlyCount,
      matchRate,
    },
    rows,
  };
}
