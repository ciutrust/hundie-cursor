"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { PersonalCardBusinessRow } from "@/lib/queries/personal-card-business-report";
import { formatCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";

type GroupBy = "month" | "quarter" | "category" | "account";

type SummaryLine = {
  key: string;
  label: string;
  total: number;
  count: number;
  rows: PersonalCardBusinessRow[];
};

function aggregateBy(rows: PersonalCardBusinessRow[], keyFn: (row: PersonalCardBusinessRow) => string, labelFn: (key: string, row: PersonalCardBusinessRow) => string) {
  const map = new Map<string, PersonalCardBusinessRow[]>();
  for (const row of rows) {
    const key = keyFn(row);
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return [...map.entries()]
    .map(([key, groupRows]) => ({
      key,
      label: labelFn(key, groupRows[0]),
      total: groupRows.reduce((s, r) => s + r.amount, 0),
      count: groupRows.length,
      rows: groupRows.sort((a, b) => a.transaction_date.localeCompare(b.transaction_date)),
    }))
    .sort((a, b) => b.total - a.total);
}

function monthKey(date: string) {
  return date.slice(0, 7);
}

function monthLabel(key: string) {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function quarterKey(date: string) {
  const month = Number(date.slice(5, 7));
  const year = date.slice(0, 4);
  const q = Math.ceil(month / 3);
  return `${year}-Q${q}`;
}

function quarterLabel(key: string) {
  const [year, q] = key.split("-Q");
  return `Q${q} ${year}`;
}

type PersonalCardBusinessReportViewProps = {
  rows: PersonalCardBusinessRow[];
  grandTotal: number;
  transactionCount: number;
};

export function PersonalCardBusinessReportView({
  rows,
  grandTotal,
  transactionCount,
}: PersonalCardBusinessReportViewProps) {
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>("month");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const byAccount = useMemo(
    () => aggregateBy(rows, (r) => r.account_slug, (_, r) => r.account_name),
    [rows],
  );

  const byCategory = useMemo(
    () => aggregateBy(rows, (r) => r.category_name, (key) => key),
    [rows],
  );

  const detailGroups = useMemo(() => {
    switch (groupBy) {
      case "month":
        return aggregateBy(rows, (r) => monthKey(r.transaction_date), (key) => monthLabel(key));
      case "quarter":
        return aggregateBy(rows, (r) => quarterKey(r.transaction_date), (key) => quarterLabel(key));
      case "category":
        return byCategory;
      case "account":
        return byAccount;
    }
  }, [rows, groupBy, byAccount, byCategory]);

  function toggleGroup(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
        No business expenses on personal cards for this period.
      </p>
    );
  }

  return (
    <div className="space-y-8">
      <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/8 via-card to-card px-6 py-8 shadow-sm">
        <p className="text-sm font-medium text-primary">Grand total</p>
        <p className="mt-1 text-4xl font-semibold tracking-tight tabular-nums">{formatCurrency(grandTotal)}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {transactionCount} transactions · GBSL entity on personal credit cards
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SummaryPanel
          title="By account"
          lines={byAccount}
          expandedKey={expandedAccount}
          onToggle={(key) => setExpandedAccount((prev) => (prev === key ? null : key))}
          grandTotal={grandTotal}
        />
        <SummaryPanel
          title="By category"
          lines={byCategory}
          expandedKey={expandedCategory}
          onToggle={(key) => setExpandedCategory((prev) => (prev === key ? null : key))}
          grandTotal={grandTotal}
        />
      </div>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Detail</h2>
            <p className="text-sm text-muted-foreground">Expand a group to see individual charges.</p>
          </div>
          <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-muted/40 p-1 print:hidden">
            {(
              [
                ["month", "Month"],
                ["quarter", "Quarter"],
                ["category", "Category"],
                ["account", "Account"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setGroupBy(value);
                  setExpandedGroups(new Set());
                }}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  groupBy === value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          {detailGroups.map((group) => {
            const open = expandedGroups.has(group.key);
            return (
              <div key={group.key} className="border-b border-border last:border-b-0">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.key)}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-muted/30 print:pointer-events-none"
                >
                  <span className="text-muted-foreground print:hidden">
                    {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                  </span>
                  <span className="min-w-0 flex-1 font-medium">{group.label}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{group.count} tx</span>
                  <span className="w-28 text-right font-semibold tabular-nums">{formatCurrency(group.total)}</span>
                </button>
                {open && (
                  <div className="border-t border-border bg-muted/15 px-4 py-2 print:block">
                    <TransactionTable rows={group.rows} compact />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="hidden print:block">
        <h2 className="mb-3 text-lg font-semibold">All transactions</h2>
        <div className="rounded-xl border border-border">
          <TransactionTable rows={rows} />
        </div>
      </section>
    </div>
  );
}

function SummaryPanel({
  title,
  lines,
  expandedKey,
  onToggle,
  grandTotal,
}: {
  title: string;
  lines: SummaryLine[];
  expandedKey: string | null;
  onToggle: (key: string) => void;
  grandTotal: number;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="border-b border-border bg-muted/40 px-4 py-3">
        <h2 className="font-semibold">{title}</h2>
      </div>
      <div className="divide-y divide-border">
        {lines.map((line) => {
          const open = expandedKey === line.key;
          return (
            <div key={line.key}>
              <button
                type="button"
                onClick={() => onToggle(line.key)}
                className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-muted/25 print:pointer-events-none"
              >
                <span className="text-muted-foreground print:hidden">
                  {open ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{line.label}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{line.count}</span>
                <span className="w-24 text-right tabular-nums">{formatCurrency(line.total)}</span>
              </button>
              {open && (
                <div className="border-t border-border/60 bg-muted/10 px-3 py-2">
                  <TransactionTable rows={line.rows} compact />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between border-t border-border bg-muted/20 px-4 py-3 font-semibold">
        <span>Total</span>
        <span className="tabular-nums">{formatCurrency(grandTotal)}</span>
      </div>
    </div>
  );
}

function TransactionTable({ rows, compact = false }: { rows: PersonalCardBusinessRow[]; compact?: boolean }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th className="pb-2 pr-3 font-medium">Date</th>
          {!compact && <th className="pb-2 pr-3 font-medium">Account</th>}
          <th className="pb-2 pr-3 font-medium">Category</th>
          <th className="pb-2 pr-3 font-medium">Description</th>
          <th className="pb-2 text-right font-medium">Amount</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border/60">
        {rows.map((row, index) => (
          <tr key={`${row.transaction_date}-${index}`}>
            <td className="py-2 pr-3 tabular-nums text-muted-foreground">{row.transaction_date}</td>
            {!compact && <td className="py-2 pr-3">{row.account_name}</td>}
            <td className="max-w-[8rem] truncate py-2 pr-3 text-muted-foreground" title={row.category_name}>
              {row.category_name}
            </td>
            <td className="max-w-xs truncate py-2 pr-3" title={row.description}>
              {row.description}
            </td>
            <td className="py-2 text-right tabular-nums">{formatCurrency(row.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
