import { AccountRangePicker } from "@/components/transactions/account-range-picker";
import { TransactionsBrowserList } from "@/components/transactions/transaction-selection-actions";
import { TransactionsExport } from "@/components/transactions/transactions-export";
import { parseDateRange } from "@/lib/date-range";
import { getAccountTransactions } from "@/lib/queries/account-transactions";
import { getAccountsWithEntities, type AccountWithEntity } from "@/lib/queries/accounts";
import { getOpenExpenseReports } from "@/lib/queries/expense-reports";
import {
  getCategoriesByEntity,
  getCategoriesForEntity,
  getClassifiableEntities,
} from "@/lib/queries/review";
import { formatCurrency } from "@/lib/utils";

export const maxDuration = 300;

type TransactionsPageProps = {
  searchParams: Promise<{ accounts?: string; from?: string; to?: string }>;
};

/**
 * An ABSENT `accounts` param defaults to every credit card (AC's ask: "all my card expenses"). An
 * explicitly EMPTY one is a real deselect-all and must be respected, or the None button could never
 * stick. Resolving against the fetched accounts also drops stale/garbage ids from a hand-edited URL,
 * and dedupes while preserving the accounts' own display order.
 */
function resolveSelectedAccountIds(param: string | undefined, accounts: AccountWithEntity[]): string[] {
  if (param === undefined) {
    return accounts.filter((account) => account.account_type === "credit_card").map((a) => a.id);
  }
  const requested = new Set(param.split(",").map((id) => id.trim()).filter(Boolean));
  return accounts.filter((account) => requested.has(account.id)).map((account) => account.id);
}

export default async function TransactionsPage({ searchParams }: TransactionsPageProps) {
  const query = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const range = parseDateRange(query, today);

  // The accounts list has to land before the transactions fetch: the credit-card default is derived
  // from it, so this one hop can't be folded into the Promise.all below.
  const accounts = await getAccountsWithEntities();
  const selectedIds = resolveSelectedAccountIds(query.accounts, accounts);

  const [transactions, entities, categoriesByEntity, personalCategories, openReports] =
    await Promise.all([
      getAccountTransactions({ start: range.start, end: range.end, accountIds: selectedIds }),
      getClassifiableEntities(),
      getCategoriesByEntity(),
      getCategoriesForEntity("personal"),
      // Feeds "Add to existing report" AND the reconcile prompt — without it a charge can never join
      // the capture that's been waiting for it, so nothing would ever suppress and every trip that
      // used a capture would double-count.
      getOpenExpenseReports(),
    ]);

  // Signed: a positive amount is an outflow, so refunds and credits net out of the running total.
  const total = transactions.reduce((sum, tx) => sum + Number(tx.amount), 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">Transactions</h1>
          <p className="text-sm text-muted-foreground">
            {range.label} · {transactions.length} transaction{transactions.length === 1 ? "" : "s"} ·{" "}
            <span className="font-semibold tabular-nums text-foreground">{formatCurrency(total)}</span>
          </p>
        </div>
        <TransactionsExport
          transactions={transactions}
          filename={`transactions-${range.from}_${range.to}.csv`}
        />
      </div>

      <AccountRangePicker accounts={accounts} selectedIds={selectedIds} range={range} />

      {selectedIds.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="font-medium">Pick at least one account</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose the accounts to browse, or hit Cards for every credit card.
          </p>
        </div>
      ) : transactions.length === 0 ? (
        // TransactionList's own zero-row state is review-flavored ("nothing to classify"), which reads
        // wrong here: an empty window is a search miss, not a cleared backlog.
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="font-medium">No transactions in this window</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Nothing posted to these accounts between {range.from} and {range.to}. Try widening the dates
            or adding accounts.
          </p>
        </div>
      ) : (
        <TransactionsBrowserList
          transactions={transactions}
          entities={entities}
          categories={personalCategories}
          categoriesByEntity={categoriesByEntity}
          month={range.from}
          openReports={openReports}
        />
      )}
    </div>
  );
}
