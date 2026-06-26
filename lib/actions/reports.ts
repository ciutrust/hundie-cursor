"use server";

import { requireUser } from "@/lib/auth/require-user";
import { parsePeriodParams } from "@/lib/period";
import { getReportTransactions, reportTransactionsToCsv } from "@/lib/queries/reports";

export async function exportReportCsv(params: {
  period?: string;
  at?: string;
  month?: string;
}) {
  const auth = await requireUser();
  if (auth.error) throw new Error(auth.error);

  const period = parsePeriodParams(params);
  const rows = await getReportTransactions(period);
  return reportTransactionsToCsv(rows);
}
