"use server";

import { requireUser } from "@/lib/auth/require-user";
import { parsePeriodParams } from "@/lib/period";
import {
  getReportTransactionsForExport,
  getTaxLineRollup,
  reportTransactionsToCsv,
  taxLineRollupToCsv,
} from "@/lib/queries/reports";

export async function exportReportCsv(params: {
  period?: string;
  at?: string;
  month?: string;
  entity?: string;
}) {
  const auth = await requireUser();
  if (auth.error) throw new Error(auth.error);

  const period = parsePeriodParams(params);
  // Uncapped on purpose: the page view caps at REPORT_TRANSACTIONS_CAP for serialization, but a
  // CSV has no such ceiling and "use the export for full data" must actually be true.
  const rows = await getReportTransactionsForExport(period, params.entity?.trim() || undefined);
  return reportTransactionsToCsv(rows);
}

/** #6: CPA packet — a per-entity, per-year tax-line rollup CSV grouped by the tax_form/tax_line mapping. */
export async function exportCpaPacketCsv(params: { entitySlug: string; year: number }) {
  const auth = await requireUser();
  if (auth.error) throw new Error(auth.error);

  const rollup = await getTaxLineRollup(params.entitySlug, params.year);
  return taxLineRollupToCsv(rollup);
}
