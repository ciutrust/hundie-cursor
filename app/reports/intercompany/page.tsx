import { LinkedPairs } from "@/components/intercompany/linked-pairs";
import { OneSidedLegs } from "@/components/intercompany/one-sided-legs";
import { PairPrompts } from "@/components/intercompany/pair-prompts";
import { ReportFilters } from "@/components/reports/report-filters";
import { periodRangeFor } from "@/lib/period";
import { getIntercompanyPairingReview, type LinkKind } from "@/lib/queries/intercompany";
import { getCategoriesByEntity, getClassifiableEntities } from "@/lib/queries/review";
import { parseReportPeriod } from "@/lib/reports/report-params";
import { formatCurrency } from "@/lib/utils";

const KIND_LABELS: Record<LinkKind, string> = {
  owner_funding: "Owner funding",
  intercompany_service: "Intercompany",
  internal_transfer: "Internal transfer",
};

type Props = {
  searchParams: Promise<{ month?: string; period?: string; at?: string; entity?: string }>;
};

export default async function IntercompanyReportPage({ searchParams }: Props) {
  const params = await searchParams;
  // Pairing is a whole-books exercise, not a monthly one - default to the full current year
  // (transfers pair across month boundaries). Explicit period params still win.
  const period = parseReportPeriod(
    params,
    periodRangeFor("year", String(new Date().getFullYear())),
  );
  const [entities, review, categoriesByEntity] = await Promise.all([
    getClassifiableEntities(),
    getIntercompanyPairingReview(period),
    getCategoriesByEntity(),
  ]);

  const entityNames: Record<string, string> = Object.fromEntries(
    entities.map((entity) => [entity.slug, entity.name]),
  );

  const totalsLine = review.totalsByKind
    .map(
      (t) =>
        `${KIND_LABELS[t.kind]}: ${t.count} pair${t.count === 1 ? "" : "s"} - ${formatCurrency(t.total)}`,
    )
    .join(" · ");

  // Anita parity: GBSL pays the 136 Anita lease, Austin ACAA receives it. Sum of linked
  // intercompany_service legs on each side should agree - a drift here is a missed or broken leg.
  const servicePairs = review.linkedPairs.filter((p) => p.kind === "intercompany_service");
  const serviceOutCents = Math.round(
    servicePairs.reduce((sum, p) => sum + Math.abs(p.out.amount), 0) * 100,
  );
  const serviceInCents = Math.round(
    servicePairs.reduce((sum, p) => sum + Math.abs(p.in.amount), 0) * 100,
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-primary">Reports</p>
          <h1 className="text-3xl font-semibold tracking-tight">Intercompany pairing</h1>
          <p className="text-sm text-muted-foreground">
            {period.label} · Both legs of money moving between your accounts. Link them so the
            books can never go one-sided.
          </p>
        </div>
        <ReportFilters period={period} entities={entities} showEntityFilter={false} />
      </div>

      {review.suggestions.length > 0 ? (
        <PairPrompts suggestions={review.suggestions} entityNames={entityNames} />
      ) : review.linkedPairs.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          All caught up - no suggested pairs in {period.label}.
        </p>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Linked pairs</h2>
        <LinkedPairs
          pairs={review.linkedPairs}
          categoriesByEntity={categoriesByEntity}
          entityNames={entityNames}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">One-sided legs</h2>
        <p className="text-sm text-muted-foreground">
          Transfer-looking money with no matching counterpart in the ledger. Fix the category if
          the row is mislabeled, or mark it &quot;Not tracked here&quot; when the other side lives
          outside Hundie.
        </p>
        {review.oneSided.length === 0 ? (
          <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            No open one-sided legs in {period.label}
            {review.acknowledgedCount > 0
              ? ` - ${review.acknowledgedCount} resolved as not tracked here`
              : " - every transfer leg has a counterpart or a pending suggestion"}
            .
          </div>
        ) : (
          <OneSidedLegs
            legs={review.oneSided}
            categoriesByEntity={categoriesByEntity}
            entityNames={entityNames}
          />
        )}
        {review.oneSided.length > 0 && review.acknowledgedCount > 0 ? (
          <p className="text-xs text-muted-foreground">
            {review.acknowledgedCount} more previously resolved as not tracked here.
          </p>
        ) : null}
      </section>

      {totalsLine ? <p className="text-sm text-muted-foreground">{totalsLine}</p> : null}

      {servicePairs.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          Anita lease parity: {formatCurrency(serviceOutCents / 100)} out vs{" "}
          {formatCurrency(serviceInCents / 100)} in
          {serviceOutCents === serviceInCents
            ? " - balanced"
            : ` - off by ${formatCurrency(Math.abs(serviceOutCents - serviceInCents) / 100)}`}
        </p>
      ) : null}
    </div>
  );
}
