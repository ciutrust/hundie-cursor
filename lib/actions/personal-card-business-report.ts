"use server";

import { parsePeriodParams } from "@/lib/period";
import {
  getPersonalCardBusinessReport,
  personalCardBusinessToCsv,
} from "@/lib/queries/personal-card-business-report";

export async function exportPersonalCardBusinessCsv(params: {
  period?: string;
  at?: string;
  month?: string;
}) {
  const period = parsePeriodParams(params);
  const report = await getPersonalCardBusinessReport(period);
  return personalCardBusinessToCsv(report.rows);
}
