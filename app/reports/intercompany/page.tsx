import { ReportFilters } from "@/components/reports/report-filters";
import { parseReportPeriod } from "@/lib/reports/report-params";
import { getClassifiableEntities } from "@/lib/queries/review";
import { getIntercompanyReview } from "@/lib/queries/intercompany";
import { activeMonthPeriod } from "@/lib/period";

type Props = {
  searchParams: Promise<{ month?: string; period?: string; at?: string; entity?: string }>;
};

export default async function IntercompanyReportPage({ searchParams }: Props) {
  const params = await searchParams;
  const period = parseReportPeriod(params, activeMonthPeriod());
  const [entities, legs] = await Promise.all([
    getClassifiableEntities(),
    getIntercompanyReview(period),
  ]);
  const flaggedCount = legs.filter((leg) => leg.potentialMirror).length;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-primary">Reports</p>
          <h1 className="text-3xl font-semibold tracking-tight">Intercompany review</h1>
          <p className="text-sm text-muted-foreground">
            {period.label} · GBSL ↔ Austin ACAA (136 Anita) lease legs
          </p>
        </div>
        <ReportFilters period={period} entities={entities} showEntityFilter={false} />
      </div>

      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm">
        <strong>Not auto-eliminated — verify manually.</strong> Intercompany legs are not netted in
        code. Rows sharing the same date and amount across two entities are flagged below as a
        possible double-count; confirm each lease is counted once (as a GBSL expense) and its mirror
        is not also counted.
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Entity</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium">Description</th>
              <th className="px-4 py-3 text-right font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">Flag</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {legs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No intercompany-tagged legs in {period.label}.
                </td>
              </tr>
            ) : (
              legs.map((leg, index) => (
                <tr
                  key={`${leg.transactionDate}-${leg.entitySlug}-${index}`}
                  className={leg.potentialMirror ? "bg-amber-500/5" : "hover:bg-muted/20"}
                >
                  <td className="px-4 py-3 tabular-nums">{leg.transactionDate}</td>
                  <td className="px-4 py-3 font-medium">{leg.entitySlug}</td>
                  <td className="px-4 py-3">{leg.categoryPath}</td>
                  <td className="px-4 py-3 text-muted-foreground">{leg.description}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{leg.amount.toFixed(2)}</td>
                  <td className="px-4 py-3">
                    {leg.potentialMirror ? (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                        possible mirror
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {flaggedCount > 0 ? (
        <p className="text-sm text-muted-foreground">
          {flaggedCount} row(s) flagged as a possible cross-entity mirror — verify manually.
        </p>
      ) : null}
    </div>
  );
}
