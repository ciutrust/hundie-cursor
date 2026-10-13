import { formatCurrency } from "@/lib/utils";

export type BalanceCardLine = {
  name: string;
  entity: string;
  amount: number;
};

export type BalanceTotalsData = {
  assetTotal: number;
  liabilityTotal: number;
  loanTotal: number;
  cardTotal: number;
  cards: BalanceCardLine[];
  estimates: BalanceCardLine[];
};

export function summarizeTotals(
  assets: { value: number }[],
  liabilities: { name: string; entity: string; balance: number; type: string; notes: string | null }[],
): BalanceTotalsData {
  const cards = liabilities.filter((item) => item.type === "credit_card");
  const loans = liabilities.filter((item) => item.type !== "credit_card");
  return {
    assetTotal: assets.reduce((sum, item) => sum + item.value, 0),
    liabilityTotal: liabilities.reduce((sum, item) => sum + item.balance, 0),
    loanTotal: loans.reduce((sum, item) => sum + item.balance, 0),
    cardTotal: cards.reduce((sum, item) => sum + item.balance, 0),
    cards: cards.map((item) => ({ name: item.name, entity: item.entity, amount: item.balance })),
    estimates: loans
      .filter((item) => /estimate/i.test(item.notes ?? ""))
      .map((item) => ({ name: item.name, entity: item.entity, amount: item.balance })),
  };
}

export function BalanceTotals({
  totals,
  highlight,
  details = true,
}: {
  totals: BalanceTotalsData;
  highlight: "assets" | "liabilities" | "net";
  details?: boolean;
}) {
  const net = totals.assetTotal - totals.liabilityTotal;
  const boxes = [
    ["assets", "Assets", totals.assetTotal],
    ["liabilities", "Liabilities", totals.liabilityTotal],
    ["net", "Net worth", net],
  ] as const;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {boxes.map(([key, label, amount]) => (
          <div
            key={key}
            className={
              highlight === key
                ? "rounded-xl border border-primary bg-card p-4"
                : "rounded-xl border border-border bg-card p-4"
            }
          >
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-xl font-semibold tabular-nums">{formatCurrency(amount)}</p>
          </div>
        ))}
      </div>
      {details ? (
      <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
        <p>
          These three numbers are the same on Assets, Liabilities, and Net worth. Loans are{" "}
          <span className="font-medium tabular-nums">{formatCurrency(totals.loanTotal)}</span>. Credit cards add{" "}
          <span className="font-medium tabular-nums">{formatCurrency(totals.cardTotal)}</span>
          {totals.cards.length ? ` across ${totals.cards.length} cards` : ""}, which is why liabilities are{" "}
          <span className="font-medium tabular-nums">{formatCurrency(totals.liabilityTotal)}</span> and not the loan
          total alone.
        </p>
        {totals.cards.length ? (
          <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
            {totals.cards.map((card) => (
              <li key={`${card.entity}-${card.name}`} className="flex justify-between gap-3">
                <span>
                  {card.name} <span className="text-muted-foreground/80">· {card.entity}</span>
                </span>
                <span className="tabular-nums">{formatCurrency(card.amount)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {totals.estimates.length ? (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
            Still an estimate, and included in the loan total:{" "}
            {totals.estimates.map((item) => `${item.name} (${formatCurrency(item.amount)})`).join(", ")}.
          </p>
        ) : null}
      </div>
      ) : null}
    </div>
  );
}
