"use server";

import { parsePeriodParams } from "@/lib/period";
import { getReportTransactions, reportTransactionsToCsv } from "@/lib/queries/reports";

export async function exportReportCsv(params: {
  period?: string;
  at?: string;
  month?: string;
}) {
  const period = parsePeriodParams(params);
  const rows = await getReportTransactions(period);
  return reportTransactionsToCsv(rows);
}
