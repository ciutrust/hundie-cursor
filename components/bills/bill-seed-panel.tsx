"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { acceptSeededBills, type CreateBillInput } from "@/lib/actions/bills";
import { formatCurrency } from "@/lib/utils";
import type { Cadence } from "@/lib/bills/cadence";
import type { RecurringCandidate } from "@/lib/bills/match";

type Entity = { id: string; name: string; slug: string };

type Props = {
  candidatesByEntity: Record<string, RecurringCandidate[]>;
  entities: Entity[];
};

const CADENCE_LABEL: Record<Cadence, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  semiannual: "Every 6 months",
  annual: "Yearly",
  one_time: "One-time",
};

const keyFor = (slug: string, vendorKey: string) => `${slug}::${vendorKey}`;

export function BillSeedPanel({ candidatesByEntity, entities }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const entityBySlug = useMemo(() => new Map(entities.map((e) => [e.slug, e])), [entities]);

  const entries = useMemo(
    () => Object.entries(candidatesByEntity).filter(([slug]) => entityBySlug.has(slug)),
    [candidatesByEntity, entityBySlug],
  );

  const [selected, setSelected] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const [slug, candidates] of entries) {
      for (const c of candidates) initial.add(keyFor(slug, c.vendorKey));
    }
    return initial;
  });

  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-10 text-center">
        <p className="text-sm text-muted-foreground">
          No recurring charges to suggest — either everything is already a bill, or there is not
          enough transaction history yet.
        </p>
      </div>
    );
  }

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const accept = () => {
    setError(null);
    const inputs: CreateBillInput[] = [];
    for (const [slug, candidates] of entries) {
      const entity = entityBySlug.get(slug);
      if (!entity) continue;
      for (const c of candidates) {
        if (!selected.has(keyFor(slug, c.vendorKey))) continue;
        inputs.push({
          entityId: entity.id,
          name: c.suggestedName,
          expectedAmount: c.expected_amount,
          amountVaries: c.amount_varies,
          cadence: c.cadence,
          dueDay: c.due_day,
          anchorDate: null,
          portalUrl: null,
          loginHint: null,
          matchHint: c.vendorKey,
          categoryId: c.category_id,
          notes: null,
        });
      }
    }
    if (inputs.length === 0) {
      setError("Select at least one bill to add.");
      return;
    }
    startTransition(async () => {
      const res = await acceptSeededBills(inputs);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      router.push("/bills");
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      {entries.map(([slug, candidates]) => {
        const entity = entityBySlug.get(slug);
        return (
          <section key={slug} className="overflow-hidden rounded-xl border border-border bg-card">
            <header className="border-b border-border px-4 py-3">
              <h2 className="font-semibold">{entity?.name ?? slug}</h2>
            </header>
            <ul className="divide-y divide-border">
              {candidates.map((c) => {
                const key = keyFor(slug, c.vendorKey);
                const checked = selected.has(key);
                return (
                  <li key={key}>
                    <label className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-muted/40">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(key)}
                        className="h-4 w-4 rounded border-border"
                      />
                      <div className="min-w-0 flex-1">
                        <span className="font-medium">{c.suggestedName}</span>
                        <p className="text-xs text-muted-foreground">
                          {CADENCE_LABEL[c.cadence]} · {formatCurrency(c.expected_amount)}
                          {c.amount_varies ? " (varies)" : ""} · seen {c.sampleCount}×
                        </p>
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

      <div className="sticky bottom-4 flex items-center justify-end gap-3 rounded-xl border border-border bg-card/95 px-4 py-3 shadow-sm backdrop-blur">
        <span className="text-sm text-muted-foreground">{selected.size} selected</span>
        <Button onClick={accept} disabled={isPending || selected.size === 0}>
          <Sparkles className="mr-1 h-4 w-4" />
          {isPending ? "Adding…" : `Add ${selected.size} bill${selected.size === 1 ? "" : "s"}`}
        </Button>
      </div>
    </div>
  );
}
