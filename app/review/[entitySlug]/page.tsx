import { notFound } from "next/navigation";
import { AppHeader } from "@/components/layout/app-header";
import { CategoryBreakdown } from "@/components/review/category-breakdown";
import { MonthPicker } from "@/components/review/month-picker";
import { TransactionList } from "@/components/review/transaction-list";
import {
  getCategoriesForEntity,
  getClassifiableEntities,
  getEntityTransactions,
} from "@/lib/queries/review";
import { formatCurrency, monthLabel, parseMonthParam } from "@/lib/utils";

type EntityReviewPageProps = {
  params: Promise<{ entitySlug: string }>;
  searchParams: Promise<{ month?: string }>;
};

export default async function EntityReviewPage({ params, searchParams }: EntityReviewPageProps) {
  const { entitySlug } = await params;
  const query = await searchParams;
  const { year, month } = parseMonthParam(query.month);
  const monthParam = `${year}-${String(month).padStart(2, "0")}`;

  const [entities, { groups, transactions }, categories] = await Promise.all([
    getClassifiableEntities(),
    getEntityTransactions(year, month, entitySlug),
    getCategoriesForEntity("gbsl"),
  ]);

  const entity =
    entitySlug === "unclassified"
      ? { name: "Unclassified", slug: "unclassified" }
      : entities.find((item) => item.slug === entitySlug);

  if (!entity) {
    notFound();
  }

  const total = transactions.filter((tx) => Number(tx.amount) > 0).reduce((sum, tx) => sum + Number(tx.amount), 0);

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title={entity.name} backHref={`/review?month=${monthParam}`} />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold">{entity.name}</h2>
            <p className="text-sm text-muted-foreground">
              {monthLabel(year, month)} · {formatCurrency(total)} · {transactions.length} transactions
            </p>
          </div>
          <MonthPicker year={year} month={month} />
        </div>

        <CategoryBreakdown groups={groups} />

        <section className="space-y-3">
          <h3 className="text-sm font-medium">Transactions</h3>
          <TransactionList
            transactions={transactions}
            entities={entities}
            categories={categories}
            month={monthParam}
            entitySlug={entitySlug}
          />
        </section>
      </main>
    </div>
  );
}
