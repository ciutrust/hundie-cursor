import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PeriodPicker } from "@/components/review/period-picker";
import { TransactionList } from "@/components/review/transaction-list";
import { parsePeriodParams, periodQueryString, ytdPeriod } from "@/lib/period";
import {
  getCategoriesByEntity,
  getCategoriesForEntity,
  getClassifiableEntities,
  getEntityTransactions,
} from "@/lib/queries/review";
import { getPersonalAiBacklog } from "@/lib/queries/ai-suggestions";
import { formatCurrency } from "@/lib/utils";
import { isOperatingExpense } from "@/lib/category-expense";

export const maxDuration = 300;

type UncategorizedPageProps = {
  params: Promise<{ entitySlug: string }>;
  searchParams: Promise<{ month?: string; period?: string; at?: string }>;
};

export default async function EntityUncategorizedPage({ params, searchParams }: UncategorizedPageProps) {
  const { entitySlug } = await params;
  const query = await searchParams;
  const period = parsePeriodParams(query, ytdPeriod());
  const periodQuery = periodQueryString(period);

  if (entitySlug === "unclassified" || entitySlug === "entities" || entitySlug === "ai") {
    notFound();
  }

  const [entities, { transactions }, categories, categoriesByEntity, aiBacklog] = await Promise.all([
    getClassifiableEntities(),
    getEntityTransactions(period, entitySlug, "unclassified"),
    getCategoriesForEntity(entitySlug),
    getCategoriesByEntity(),
    entitySlug === "personal" ? getPersonalAiBacklog() : Promise.resolve([]),
  ]);

  const entity = entities.find((item) => item.slug === entitySlug);
  if (!entity) notFound();

  const total = transactions
    .filter((tx) => isOperatingExpense(tx.amount, tx.classification.category?.full_path))
    .reduce((sum, tx) => sum + Number(tx.amount), 0);

  const aiSuggestionTxIds = new Set(
    aiBacklog.filter((tx) => tx.ai_suggestion).map((tx) => tx.id),
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            <Link href={`/review/${entitySlug}?${periodQuery}`} className="hover:text-foreground">
              {entity.name}
            </Link>
            {" · Uncategorized"}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Classify · {entity.name}</h1>
          <p className="text-sm text-muted-foreground">
            {period.label} ·{" "}
            <span className="font-semibold text-amber-600 dark:text-amber-400">
              {formatCurrency(total)}
            </span>{" "}
            remaining across {transactions.length} transaction{transactions.length === 1 ? "" : "s"} to classify
          </p>
          {entitySlug === "personal" ? (
            <Link href="/review/ai" className="text-sm font-medium text-violet-600 hover:underline dark:text-violet-400">
              Bulk AI review →
            </Link>
          ) : null}
        </div>
        <Suspense fallback={null}>
          <PeriodPicker period={period} />
        </Suspense>
      </div>

      <TransactionList
        transactions={transactions}
        entities={entities}
        categories={categories}
        categoriesByEntity={categoriesByEntity}
        month={period.at}
        entitySlug={entitySlug}
        aiSuggestionTxIds={aiSuggestionTxIds.size > 0 ? aiSuggestionTxIds : undefined}
      />
    </div>
  );
}
