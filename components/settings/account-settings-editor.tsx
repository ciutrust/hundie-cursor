"use client";

import { useState, useTransition } from "react";
import { updateAccountSettings } from "@/lib/actions/accounts";
import type { AccountDateRule, AccountWithEntity } from "@/lib/queries/accounts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type AccountSettingsEditorProps = {
  accounts: AccountWithEntity[];
  entities: Array<{ id: string; name: string; slug: string }>;
};

function emptyRule(): AccountDateRule {
  return { entity_slug: "personal" };
}

export function AccountSettingsEditor({ accounts, entities }: AccountSettingsEditorProps) {
  return (
    <div className="space-y-4">
      {accounts.map((account) => (
        <AccountCard key={account.id} account={account} entities={entities} />
      ))}
    </div>
  );
}

function AccountCard({
  account,
  entities,
}: {
  account: AccountWithEntity;
  entities: Array<{ id: string; name: string; slug: string }>;
}) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [defaultEntityId, setDefaultEntityId] = useState(account.default_entity?.id ?? "");
  const [dateRules, setDateRules] = useState<AccountDateRule[]>(
    account.date_rules.length > 0 ? account.date_rules : [],
  );

  function updateRule(index: number, patch: Partial<AccountDateRule>) {
    setDateRules((current) => current.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  }

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await updateAccountSettings({
        accountId: account.id,
        defaultEntityId,
        dateRules,
      });
      setMessage(result.error ?? "Saved. Rules apply to future imports only — existing transactions are unchanged.");
    });
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">{account.display_name}</h2>
          <p className="text-sm text-muted-foreground">
            {account.slug} · {account.account_type.replace("_", " ")}
            {account.mixed_use ? " · mixed use" : ""}
          </p>
        </div>
        <Button size="sm" onClick={save} disabled={isPending}>
          {isPending ? "Saving…" : "Save"}
        </Button>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`default-${account.id}`}>Default entity (fallback)</Label>
          <select
            id={`default-${account.id}`}
            value={defaultEntityId}
            onChange={(event) => setDefaultEntityId(event.target.value)}
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
          >
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">Date-based entity rules</h3>
            <p className="text-xs text-muted-foreground">
              Used when importing new transactions. Does not retroactively change the ledger.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setDateRules((current) => [...current, emptyRule()])}>
            Add rule
          </Button>
        </div>

        {dateRules.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
            No date rules — all new imports use the default entity.
          </p>
        ) : (
          dateRules.map((rule, index) => (
            <div key={index} className="grid gap-3 rounded-lg border border-border bg-muted/20 p-4 md:grid-cols-4">
              <div className="space-y-1">
                <Label>From</Label>
                <Input type="date" value={rule.from ?? ""} onChange={(event) => updateRule(index, { from: event.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Until</Label>
                <Input type="date" value={rule.until ?? ""} onChange={(event) => updateRule(index, { until: event.target.value })} />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label>Entity</Label>
                <select
                  value={rule.entity_slug}
                  onChange={(event) => updateRule(index, { entity_slug: event.target.value })}
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                >
                  {entities.map((entity) => (
                    <option key={entity.slug} value={entity.slug}>
                      {entity.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))
        )}
      </div>

      {message ? <p className="mt-3 text-sm text-muted-foreground">{message}</p> : null}
    </div>
  );
}
