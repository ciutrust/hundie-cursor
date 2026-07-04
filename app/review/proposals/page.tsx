import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { ProposalsPanel } from "@/components/review/proposals-panel";
import { GenerateControls } from "@/components/review/generate-controls";
import { getClassifiableEntities, getCategoriesByEntity } from "@/lib/queries/review";
import { getProposalEntityCounts, getProposalsForEntity } from "@/lib/queries/proposals";

export const maxDuration = 300;

type PageProps = {
  searchParams: Promise<{ entity?: string }>;
};

export default async function ProposalsPage({ searchParams }: PageProps) {
  const { entity } = await searchParams;

  const [entities, categoriesByEntity, counts] = await Promise.all([
    getClassifiableEntities(),
    getCategoriesByEntity(),
    getProposalEntityCounts(),
  ]);

  // Default to the entity with the most actionable proposals.
  const ranked = entities
    .map((e) => ({ e, n: (counts[e.slug]?.pending ?? 0) + (counts[e.slug]?.approved ?? 0) }))
    .sort((a, b) => b.n - a.n);
  const activeSlug =
    entity && entities.some((e) => e.slug === entity)
      ? entity
      : (ranked[0]?.e.slug ?? entities[0]?.slug ?? "personal");

  const proposals = await getProposalsForEntity(activeSlug);
  const activeEntity = entities.find((e) => e.slug === activeSlug);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Classify · proposals
          </p>
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-emerald-500" />
            <h1 className="text-3xl font-semibold tracking-tight">Recommendations</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Staged classification proposals with confidence + reasoning. Approve / reject / override —
            nothing touches your ledger until you <strong>Commit approved</strong>.
          </p>
        </div>
        <GenerateControls entitySlug={activeSlug} entityName={activeEntity?.name ?? activeSlug} />
      </div>

      <nav className="flex flex-wrap gap-2">
        {entities.map((e) => {
          const c = counts[e.slug] ?? { pending: 0, approved: 0 };
          const total = c.pending + c.approved;
          const active = e.slug === activeSlug;
          return (
            <Link
              key={e.slug}
              href={`/review/proposals?entity=${e.slug}`}
              className={`rounded-full border px-3 py-1 text-sm ${
                active
                  ? "border-emerald-500 bg-emerald-50 font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {e.name}{" "}
              <span className="tabular-nums">
                {total}
                {c.approved > 0 ? ` (${c.approved}✓)` : ""}
              </span>
            </Link>
          );
        })}
      </nav>

      <ProposalsPanel
        key={activeSlug}
        entitySlug={activeSlug}
        proposals={proposals}
        entities={entities}
        categoriesByEntity={categoriesByEntity}
      />
    </div>
  );
}
