import Link from "next/link";
import { Suspense } from "react";
import { ReportFilters } from "@/components/reports/report-filters";
import { parseReportEntitySlug, parseReportPeriod } from "@/lib/reports/report-params";
import { getClassifiableEntities } from "@/lib/queries/review";
import { activeMonthPeriod } from "@/lib/period";

const REPORT_LINKS = [
  { href: "/reports/transactions", label: "Transaction detail" },
  { href: "/reports/spending-by-entity", label: "Spending by entity (monthly matrix)" },
  { href: "/reports/spending-by-category", label: "Spending by category (monthly matrix)" },
  { href: "/reports/category-breakdown", label: "Category breakdown" },
  { href: "/reports/top-vendors", label: "Top vendors" },
  { href: "/reports/uncategorized-aging", label: "Uncategorized aging" },
  { href: "/reports/classification-progress", label: "Classification progress" },
  { href: "/reports/account-summary", label: "Account summary" },
  { href: "/reports/yoy-comparison", label: "Year-over-year comparison" },
  { href: "/reports/reconcile", label: "GBSL checking reconciliation" },
  { href: "/reports/intercompany", label: "Intercompany review" },
  { href: "/reports/income", label: "Money in (income by source)" },
  { href: "/reports/business-expenses-personal-cards", label: "Business expenses on personal cards" },
  { href: "/reports/funding", label: "Funding" },
  { href: "/reports/ai-suggestions", label: "AI suggestions stats" },
] as const;

type ReportsHubProps = {
  searchParams: Promise<{ month?: string; period?: string; at?: string; entity?: string }>;
};

export default async function ReportsHubPage({ searchParams }: ReportsHubProps) {
  const params = await searchParams;
  const period = parseReportPeriod(params, activeMonthPeriod());
  const entitySlug = parseReportEntitySlug(params);
  const entities = await getClassifiableEntities();
  const querySuffix = entitySlug ? `entity=${entitySlug}&period=${period.type}&at=${period.at}` : `period=${period.type}&at=${period.at}`;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-primary">Reports</p>
          <h1 className="text-3xl font-semibold tracking-tight">Reports & export</h1>
          <p className="text-sm text-muted-foreground">
            Transaction detail and analytics · pick entity and period on each report
          </p>
        </div>
        <Suspense fallback={null}>
          <ReportFilters period={period} entities={entities} selectedEntitySlug={entitySlug} />
        </Suspense>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {REPORT_LINKS.map((link) => (
          <Link
            key={link.href}
            href={`${link.href}?${querySuffix}`}
            className="rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/30"
          >
            {link.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
