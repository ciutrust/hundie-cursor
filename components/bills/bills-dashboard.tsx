"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, Pencil, Plus, RotateCcw, SkipForward, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BillFormDialog } from "./bill-form-dialog";
import { BillStateBadge } from "./bill-state-badge";
import { formatBillDate } from "./format";
import {
  markBillPaidManually,
  skipBillInstance,
  unlinkBillPayment,
} from "@/lib/actions/bills";
import { formatCurrency } from "@/lib/utils";
import { ENTITY_ACCENT_STYLES } from "@/lib/entities/display";
import type { BillRow, BillsDashboard as Dashboard } from "@/lib/queries/bills";

type Entity = { id: string; name: string; slug: string };
type Category = { id: string; full_path: string };

type Props = {
  dashboard: Dashboard;
  entities: Entity[];
  categoriesByEntity: Record<string, Category[]>;
};

/** Only render a payment link for a real http(s) URL — never javascript:/data: schemes. */
function safeHref(url: string | null): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

export function BillsDashboard({ dashboard, entities, categoriesByEntity }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ success: true } | { error: string }>) =>
    startTransition(async () => {
      await fn();
      router.refresh();
    });

  const addButton = (
    <BillFormDialog
      entities={entities}
      categoriesByEntity={categoriesByEntity}
      trigger={
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" /> Add bill
        </Button>
      }
    />
  );

  if (dashboard.groups.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-10 text-center">
        <p className="text-sm text-muted-foreground">No bills yet for this view.</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {addButton}
          <Button asChild variant="outline" size="sm">
            <Link href="/bills/onboarding">
              <Sparkles className="mr-1 h-4 w-4" /> Suggest from my history
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">{addButton}</div>

      {dashboard.groups.map((group) => {
        const accent = ENTITY_ACCENT_STYLES[group.display.accent];
        return (
          <section
            key={group.entitySlug}
            className="overflow-hidden rounded-xl border border-border bg-card"
          >
            <div className={`h-1 ${accent.bar}`} />
            <header className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h2 className="font-semibold">{group.entityName}</h2>
                <p className="text-xs text-muted-foreground">{group.display.subtitle}</p>
              </div>
              <div className="text-right">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Due</p>
                <p className="font-semibold tabular-nums">{formatCurrency(group.totalDue)}</p>
              </div>
            </header>

            <ul className="divide-y divide-border">
              {group.rows.map((row) => (
                <BillRowItem
                  key={row.bill.id}
                  row={row}
                  entities={entities}
                  categoriesByEntity={categoriesByEntity}
                  isPending={isPending}
                  run={run}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function BillRowItem({
  row,
  entities,
  categoriesByEntity,
  isPending,
  run,
}: {
  row: BillRow;
  entities: Entity[];
  categoriesByEntity: Record<string, Category[]>;
  isPending: boolean;
  run: (fn: () => Promise<{ success: true } | { error: string }>) => void;
}) {
  const { bill, instance, state } = row;
  const href = safeHref(bill.portal_url);
  const amount = instance.expected_amount ?? bill.expected_amount;
  const isResolved = state === "paid" || state === "skipped";

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{bill.name}</span>
          <BillStateBadge state={state} />
        </div>
        <p className="text-xs text-muted-foreground">
          {isResolved ? "Was due" : "Due"} {formatBillDate(instance.due_date)}
          {row.categoryPath ? ` · ${row.categoryPath}` : ""}
          {bill.amount_varies ? " · varies" : ""}
        </p>
      </div>

      <div className="text-right tabular-nums">
        <span className="font-medium">{amount != null ? formatCurrency(amount) : "—"}</span>
      </div>

      <div className="flex items-center gap-1">
        {href && (
          <Button asChild variant="outline" size="sm">
            <a href={href} target="_blank" rel="noreferrer noopener">
              Pay <ExternalLink className="ml-1 h-3.5 w-3.5" />
            </a>
          </Button>
        )}
        {!isResolved && (
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={isPending}
              title="Mark paid"
              onClick={() => run(() => markBillPaidManually(instance.id))}
            >
              <Check className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={isPending}
              title="Skip this cycle"
              onClick={() => run(() => skipBillInstance(instance.id))}
            >
              <SkipForward className="h-4 w-4" />
            </Button>
          </>
        )}
        {isResolved && (
          <Button
            variant="ghost"
            size="sm"
            disabled={isPending}
            title="Reopen"
            onClick={() => run(() => unlinkBillPayment(instance.id))}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        )}
        <BillFormDialog
          entities={entities}
          categoriesByEntity={categoriesByEntity}
          bill={bill}
          trigger={
            <Button variant="ghost" size="sm" title="Edit bill">
              <Pencil className="h-4 w-4" />
            </Button>
          }
        />
      </div>
    </li>
  );
}
