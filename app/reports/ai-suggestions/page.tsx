import Link from "next/link";
import { Brain } from "lucide-react";
import { getAiAcceptanceStats, getAiSuggestionCoverage } from "@/lib/queries/ai-suggestions";

export default async function AiSuggestionsReportPage() {
  const [stats, coverage] = await Promise.all([getAiAcceptanceStats(), getAiSuggestionCoverage()]);

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Tax readiness · Reports
        </p>
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-violet-500" />
          <h1 className="text-3xl font-semibold tracking-tight">AI suggestions</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Acceptance rate from confirmed review actions · Personal uncategorized 2025–2026 backlog
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-xs font-medium text-muted-foreground">Backlog total</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{coverage.total}</p>
        </div>
        <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-4 shadow-sm">
          <p className="text-xs font-medium text-muted-foreground">With AI suggestion</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-violet-600 dark:text-violet-400">
            {coverage.withAi}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-xs font-medium text-muted-foreground">Still need AI run</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{coverage.withoutAi}</p>
        </div>
      </div>

      <p className="text-sm">
        <Link
          href="/review/personal?category=unclassified&period=year&at=2025"
          className="font-medium text-violet-600 hover:underline dark:text-violet-400"
        >
          Open AI review panel →
        </Link>
      </p>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">Entity</th>
              <th className="px-4 py-3 font-medium">AI confidence</th>
              <th className="px-4 py-3 font-medium">Events</th>
              <th className="px-4 py-3 font-medium">Accepted</th>
              <th className="px-4 py-3 font-medium">Rejected</th>
              <th className="px-4 py-3 font-medium">Accept rate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {stats.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No AI suggestion events yet — accept or reject suggestions in review to populate this report.
                </td>
              </tr>
            ) : (
              stats.map((row) => (
                <tr key={`${row.entity_slug}-${row.confidence}`} className="hover:bg-muted/20">
                  <td className="px-4 py-3 font-medium">{row.entity_slug}</td>
                  <td className="px-4 py-3 capitalize">{row.confidence}</td>
                  <td className="px-4 py-3 tabular-nums">{row.shown}</td>
                  <td className="px-4 py-3 tabular-nums">{row.accepted}</td>
                  <td className="px-4 py-3 tabular-nums">{row.rejected}</td>
                  <td className="px-4 py-3 tabular-nums">{(row.accept_rate * 100).toFixed(0)}%</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
