import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { PeriodPicker } from "@/components/review/period-picker";
import { EntityHomeCards } from "@/components/review/entity-home-cards";
import { getEntityHomeStats } from "@/lib/queries/entity-home";
import { getClassifiableEntities } from "@/lib/queries/review";
import { parsePeriodParams, periodQueryString, ytdPeriod } from "@/lib/period";

type EntityHomePageProps = {
  params: Promise<{ entitySlug: string }>;
  searchParams: Promise<{ month?: string; period?: string; at?: string; category?: string }>;
};

export default async function EntityHomePage({ params, searchParams }: EntityHomePageProps) {
  const { entitySlug } = await params;
  const query = await searchParams;

  if (entitySlug === "unclassified") {
    redirect("/review/entities");
  }

  if (entitySlug === "entities" || entitySlug === "ai") {
    notFound();
  }

  if (query.category === "unclassified") {
    const period = parsePeriodParams(query, ytdPeriod());
    redirect(`/review/${entitySlug}/uncategorized?${periodQueryString(period)}`);
  }

  const period = parsePeriodParams(query, ytdPeriod());
  const periodQuery = periodQueryString(period);

  const [entities, stats] = await Promise.all([
    getClassifiableEntities(),
    getEntityHomeStats(entitySlug, period),
  ]);

  const entity = entities.find((item) => item.slug === entitySlug);
  if (!entity || !stats) {
    notFound();
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            <Link href="/review/entities" className="hover:text-foreground">
              Entities
            </Link>
            {" · "}
            {entity.name}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">{entity.name}</h1>
          <p className="text-sm text-muted-foreground">
            {period.label} · classify uncategorized or view details in{" "}
            <Link href={`/reports/transactions?entity=${entitySlug}&${periodQuery}`} className="text-primary hover:underline">
              Reports
            </Link>
          </p>
          {entitySlug === "personal" ? (
            <Link href="/review/ai" className="text-sm font-medium text-violet-600 hover:underline dark:text-violet-400">
              Open AI review →
            </Link>
          ) : null}
        </div>
        <Suspense fallback={null}>
          <PeriodPicker period={period} />
        </Suspense>
      </div>

      <EntityHomeCards stats={stats} period={period} />

      <div className="flex flex-wrap gap-4 text-sm">
        <Link
          href={`/review/${entitySlug}/uncategorized?${periodQuery}`}
          className="font-medium text-primary hover:underline"
        >
          Classify uncategorized →
        </Link>
        <Link
          href={`/reports/spending-by-category?entity=${entitySlug}&${periodQuery}`}
          className="text-muted-foreground hover:text-foreground hover:underline"
        >
          Category breakdown report
        </Link>
        <Link
          href={`/reports/transactions?entity=${entitySlug}&${periodQuery}`}
          className="text-muted-foreground hover:text-foreground hover:underline"
        >
          Transaction detail report
        </Link>
      </div>
    </div>
  );
}
