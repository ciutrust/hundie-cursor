"use client";

import { useState, useTransition } from "react";
import { updateAccountSettings } from "@/lib/actions/accounts";
import type { AccountDateRule } from "@/lib/queries/accounts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type AccountDateRulesEditorProps = {
  accountId: string;
  accountName: string;
  defaultEntityId: string;
  defaultEntityName: string | null;
  initialRules: AccountDateRule[];
  entities: Array<{ id: string; name: string; slug: string }>;
  compact?: boolean;
  hideSave?: boolean;
  onRulesChange?: (rules: AccountDateRule[]) => void;
};

function emptyRule(): AccountDateRule {
  return { entity_slug: "personal" };
}

export function AccountDateRulesEditor({
  accountId,
  accountName,
  defaultEntityId,
  defaultEntityName,
  initialRules,
  entities,
  compact = false,
  hideSave = false,
  onRulesChange,
}: AccountDateRulesEditorProps) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [dateRules, setDateRules] = useState<AccountDateRule[]>(initialRules);

  function commit(next: AccountDateRule[]) {
    setDateRules(next);
    onRulesChange?.(next);
  }

  function updateRule(index: number, patch: Partial<AccountDateRule>) {
    commit(dateRules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  }

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await updateAccountSettings({
        accountId,
        defaultEntityId,
        dateRules,
      });
      setMessage(result.error ?? "Saved. Rules apply to future imports only — existing transactions are unchanged.");
    });
  }

  const fieldClass = compact
    ? "h-8 w-full rounded-md border border-white/20 bg-black/25 px-2 text-xs text-white"
    : "h-10 w-full rounded-md border border-border bg-background px-3 text-sm";

  return (
    <div
      className={
        compact
          ? "rounded-lg border border-white/20 bg-black/20 p-3"
          : "rounded-xl border border-border bg-card p-4 shadow-sm"
      }
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className={compact ? "text-xs font-medium uppercase tracking-wide text-white/80" : "text-sm font-medium"}>
            Edit rules
          </h3>
          {compact ? null : (
            <p className="text-xs text-muted-foreground">
              {accountName}
              {defaultEntityName ? ` · ledger default ${defaultEntityName}` : ""}.
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant={compact ? "secondary" : "outline"}
            size="sm"
            onClick={() => commit([...dateRules, emptyRule()])}
          >
            Add rule
          </Button>
          {hideSave ? null : (
            <Button size="sm" onClick={save} disabled={isPending}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {dateRules.length === 0 ? (
          <p
            className={cn(
              "rounded-lg border border-dashed px-3 py-2 text-xs",
              compact ? "border-white/25 text-white/70" : "border-border text-muted-foreground",
            )}
          >
            No date rules — new imports use the default entity.
          </p>
        ) : (
          dateRules.map((rule, index) => (
            <div
              key={`${rule.entity_slug}-${index}`}
              className={cn(
                "grid gap-2 p-3 md:grid-cols-4",
                compact ? "rounded-md border border-white/15 bg-black/20" : "rounded-lg border border-border bg-muted/20",
              )}
            >
              <div className="space-y-1">
                <Label className={compact ? "text-white/70" : undefined}>From</Label>
                <Input
                  type="date"
                  value={rule.from ?? ""}
                  onChange={(event) => updateRule(index, { from: event.target.value })}
                  className={fieldClass}
                />
              </div>
              <div className="space-y-1">
                <Label className={compact ? "text-white/70" : undefined}>Until</Label>
                <Input
                  type="date"
                  value={rule.until ?? ""}
                  onChange={(event) => updateRule(index, { until: event.target.value })}
                  className={fieldClass}
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label className={compact ? "text-white/70" : undefined}>Entity</Label>
                <select
                  value={rule.entity_slug}
                  onChange={(event) => updateRule(index, { entity_slug: event.target.value })}
                  className={fieldClass}
                >
                  {entities.map((entity) => (
                    <option key={entity.slug} value={entity.slug} className="text-zinc-900">
                      {entity.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))
        )}
      </div>

      {message ? <p className={cn("mt-2 text-xs", compact ? "text-white/70" : "text-muted-foreground")}>{message}</p> : null}
    </div>
  );
}
