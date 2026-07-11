import Link from "next/link";
import { Receipt } from "lucide-react";
import { getClassifiableEntities, getCategoriesByEntity } from "@/lib/queries/review";
import { getBillsDashboard, getPaymentSuggestions } from "@/lib/queries/bills";
import { parseReportEntitySlug } from "@/lib/reports/report-params";
import { BillsDashboard } from "@/components/bills/bills-dashboard";
import { PaymentSuggestions } from "@/components/bills/payment-suggestions";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type PageProps = { searchParams: Promise<{ entity?: string }> };

function EntityPill({ slug, active, label }: { slug?: string; active: boolean; label: string }) {
  const href = slug ? `/bills?entity=${slug}` : "/bills";
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 text-sm ${
        active
          ? "border-emerald-500 bg-emerald-50 font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
          : "border-border text-muted-foreground hover:bg-muted"
      }`}
    >
      {label}
    </Link>
  );
}

export default async function BillsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const entitySlug = parseReportEntitySlug(params);

  const [entities, categoriesByEntity, dashboard, suggestions] = await Promise.all([
    getClassifiableEntities(),
    getCategoriesByEntity(),
    getBillsDashboard(entitySlug),
    getPaymentSuggestions(entitySlug),
  ]);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Bills</p>
        <div className="flex items-center gap-2">
          <Receipt className="h-5 w-5 text-emerald-500" />
          <h1 className="text-3xl font-semibold tracking-tight">Bills</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Everything due across your entities. Hundie auto-detects payments from your imported
          transactions and links you out to pay — it never stores a password or moves money.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-6 rounded-xl border border-border bg-card px-4 py-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total due</p>
          <p className="text-2xl font-semibold tabular-nums">{formatCurrency(dashboard.totalDue)}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Outstanding</p>
          <p className="text-2xl font-semibold tabular-nums">{dashboard.outstandingCount}</p>
        </div>
        <Link
          href="/bills/onboarding"
          className="ml-auto text-sm text-emerald-600 hover:underline dark:text-emerald-400"
        >
          Suggest bills from history →
        </Link>
      </div>

      <nav className="flex flex-wrap gap-2">
        <EntityPill active={!entitySlug} label="All entities" />
        {entities.map((e) => (
          <EntityPill key={e.slug} slug={e.slug} active={entitySlug === e.slug} label={e.name} />
        ))}
      </nav>

      <PaymentSuggestions suggestions={suggestions} />

      <BillsDashboard
        dashboard={dashboard}
        entities={entities}
        categoriesByEntity={categoriesByEntity}
      />
    </div>
  );
}
