"use server";

import { requireUser } from "@/lib/auth/require-user";
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
  const auth = await requireUser();
  if (auth.error) throw new Error(auth.error);

  const period = parsePeriodParams(params);
  const report = await getPersonalCardBusinessReport(period);
  return personalCardBusinessToCsv(report.rows);
}
