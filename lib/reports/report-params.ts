import { parsePeriodParams, type PeriodRange } from "@/lib/period";

/**
 * Report search-param parsing. Server-safe (no client-only deps) so Server
 * Components can call these directly. Kept out of the "use client"
 * report-filters module: calling a client-module export from the server throws
 * "Attempted to call X() from the server but X is on the client."
 */
export function parseReportPeriod(
  searchParams: { period?: string; at?: string; month?: string },
  defaultPeriod?: PeriodRange,
) {
  return parsePeriodParams(searchParams, defaultPeriod);
}

export function parseReportEntitySlug(searchParams: { entity?: string }) {
  const slug = searchParams.entity?.trim();
  return slug && slug !== "all" ? slug : undefined;
}
