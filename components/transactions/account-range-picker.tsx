"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { FilterMultiSelect } from "@/components/review/filter-multi-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DateRange } from "@/lib/date-range";
import type { AccountWithEntity } from "@/lib/queries/accounts";

const TYPE_LABELS: Record<string, string> = {
  credit_card: "Credit card",
  checking: "Checking",
  savings: "Savings",
};

function typeLabel(accountType: string): string {
  return TYPE_LABELS[accountType] ?? accountType;
}

type AccountRangePickerProps = {
  accounts: AccountWithEntity[];
  selectedIds: string[];
  range: DateRange;
};

export function AccountRangePicker({ accounts, selectedIds, range }: AccountRangePickerProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);

  // The URL is the source of truth; re-sync when it changes from elsewhere (back button, a quick-select
  // that re-parses, a hand-edited link).
  useEffect(() => {
    setFrom(range.from);
    setTo(range.to);
  }, [range.from, range.to]);

  function push(nextIds: string[], nextFrom: string, nextTo: string) {
    const params = new URLSearchParams();
    // Always written, even when empty: an absent `accounts` means "default to the cards", so an empty
    // string is the only way to express "none selected".
    params.set("accounts", nextIds.join(","));
    params.set("from", nextFrom);
    params.set("to", nextTo);
    startTransition(() => router.replace(`/transactions?${params}`));
  }

  function changeAccounts(nextIds: string[]) {
    push(nextIds, from, to);
  }

  function changeFrom(value: string) {
    setFrom(value);
    // A half-typed date is "" from a date input; pushing it would bounce the range back to the default.
    if (value) push(selectedIds, value, to);
  }

  function changeTo(value: string) {
    setTo(value);
    if (value) push(selectedIds, from, value);
  }

  const cardIds = accounts
    .filter((account) => account.account_type === "credit_card")
    .map((account) => account.id);

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4 shadow-sm print:hidden">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
        <FilterMultiSelect
          id="transactions-accounts"
          label="Accounts"
          emptyLabel="No accounts selected"
          options={accounts.map((account) => ({
            id: account.id,
            label: `${account.display_name} (${typeLabel(account.account_type)})`,
          }))}
          selectedIds={selectedIds}
          onChange={changeAccounts}
        />

        <div className="min-w-0">
          <Label htmlFor="transactions-from" className="mb-2 block text-sm font-medium">
            From
          </Label>
          <Input
            id="transactions-from"
            type="date"
            value={from}
            max={to}
            onChange={(event) => changeFrom(event.target.value)}
            className="h-10"
          />
        </div>

        <div className="min-w-0">
          <Label htmlFor="transactions-to" className="mb-2 block text-sm font-medium">
            To
          </Label>
          <Input
            id="transactions-to"
            type="date"
            value={to}
            min={from}
            onChange={(event) => changeTo(event.target.value)}
            className="h-10"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Quick select</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => changeAccounts(cardIds)}
          disabled={cardIds.length === 0}
        >
          Cards
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => changeAccounts(accounts.map((account) => account.id))}
        >
          All
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => changeAccounts([])}>
          None
        </Button>
        {pending ? <span className="text-xs text-muted-foreground">Loading…</span> : null}
      </div>
    </div>
  );
}
