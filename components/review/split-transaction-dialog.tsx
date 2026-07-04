"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CategorySearchSelect } from "@/components/review/category-search-select";
import { splitTransaction, unsplitTransaction } from "@/lib/actions/split-transaction";
import { centsToInput } from "@/lib/money";
import { remainingCents, validateSplit, type SplitLegDraft } from "@/lib/split-validation";
import type { Category, Entity, TransactionWithDetails } from "@/lib/types/database";
import { formatCurrency } from "@/lib/utils";

type EntityCategory = Pick<Category, "id" | "full_path">;

type LegDraft = SplitLegDraft & { key: string };

type SplitTransactionDialogProps = {
  transaction: TransactionWithDetails;
  entities: Pick<Entity, "id" | "name" | "slug">[];
  categoriesByEntity: Record<string, EntityCategory[]>;
  entitySlug: string;
  onClose: () => void;
};

let legKeySeq = 0;
function newKey() {
  legKeySeq += 1;
  return `leg-${legKeySeq}`;
}

export function SplitTransactionDialog({
  transaction,
  entities,
  categoriesByEntity,
  entitySlug,
  onClose,
}: SplitTransactionDialogProps) {
  const parentAmount = Number(transaction.amount);
  const parentCents = Math.round(parentAmount * 100);
  const alreadySplit = (transaction.splits?.length ?? 0) >= 2;

  const slugById = useMemo(
    () => new Map(entities.map((e) => [e.id, e.slug])),
    [entities],
  );

  const [legs, setLegs] = useState<LegDraft[]>(() => {
    if (transaction.splits && transaction.splits.length >= 2) {
      return transaction.splits.map((s) => ({
        key: newKey(),
        entityId: s.entity_id,
        categoryId: s.category_id,
        amount: centsToInput(Math.round(s.amount * 100)),
      }));
    }
    // Fresh split: leg 1 = current entity/category + full amount (Remaining starts at $0.00), leg 2 empty.
    return [
      {
        key: newKey(),
        entityId: transaction.classification.entity_id,
        categoryId: transaction.classification.category_id,
        amount: centsToInput(parentCents),
      },
      { key: newKey(), entityId: transaction.classification.entity_id, categoryId: null, amount: "" },
    ];
  });

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const remaining = remainingCents(legs, parentAmount);
  const balanced = remaining === 0;

  function updateLeg(key: string, patch: Partial<LegDraft>) {
    setLegs((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function setLegEntity(key: string, entityId: string) {
    // Categories are entity-scoped, so changing the entity clears the category.
    setLegs((prev) => prev.map((l) => (l.key === key ? { ...l, entityId, categoryId: null } : l)));
  }
  function addLeg() {
    setLegs((prev) => [
      ...prev,
      { key: newKey(), entityId: transaction.classification.entity_id, categoryId: null, amount: "" },
    ]);
  }
  function removeLeg(key: string) {
    setLegs((prev) => (prev.length <= 2 ? prev : prev.filter((l) => l.key !== key)));
  }
  function fillRemaining(key: string) {
    // Give this leg whatever is left so the split balances to the cent.
    const others = legs.filter((l) => l.key !== key);
    const otherSum = others.reduce((s, l) => s + (Math.round(Number(l.amount.replace(/[$,\s]/g, "")) * 100) || 0), 0);
    const target = parentCents - otherSum;
    updateLeg(key, { amount: centsToInput(target) });
  }

  function onSave() {
    const validation = validateSplit(legs, parentAmount);
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await splitTransaction({
        transactionId: transaction.id,
        legs: legs.map((l) => ({ entityId: l.entityId, categoryId: l.categoryId, amount: l.amount })),
        entitySlug,
      });
      if ("error" in res) setError(res.error);
      else onClose();
    });
  }

  function onUnsplit() {
    setError(null);
    startTransition(async () => {
      const res = await unsplitTransaction({ transactionId: transaction.id, entitySlug });
      if ("error" in res) setError(res.error);
      else onClose();
    });
  }

  const remainingLabel = `${remaining < 0 ? "-" : ""}$${Math.abs(remaining / 100).toFixed(2)}`;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Split transaction</DialogTitle>
          <DialogDescription>
            {transaction.description} · {transaction.transaction_date} ·{" "}
            {formatCurrency(parentAmount)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {legs.map((leg, i) => {
            const legSlug = slugById.get(leg.entityId) ?? entitySlug;
            const legCategories = categoriesByEntity[legSlug] ?? [];
            return (
              <div
                key={leg.key}
                className="grid grid-cols-1 gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_1.4fr_auto]"
              >
                <div>
                  <Label className="text-xs text-muted-foreground">Entity</Label>
                  <Select value={leg.entityId} onValueChange={(v) => setLegEntity(leg.key, v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {entities.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <CategorySearchSelect
                    id={`split-cat-${leg.key}`}
                    label="Category"
                    categories={legCategories}
                    value={leg.categoryId}
                    onChange={(categoryId) => updateLeg(leg.key, { categoryId })}
                  />
                </div>
                <div className="flex flex-col">
                  <Label htmlFor={`split-amt-${leg.key}`} className="text-xs text-muted-foreground">
                    Amount
                  </Label>
                  <div className="flex items-center gap-1">
                    <Input
                      id={`split-amt-${leg.key}`}
                      inputMode="decimal"
                      value={leg.amount}
                      onChange={(e) => updateLeg(leg.key, { amount: e.target.value })}
                      placeholder="0.00"
                      className="w-24 tabular-nums"
                    />
                    <button
                      type="button"
                      onClick={() => fillRemaining(leg.key)}
                      title="Use the remaining amount"
                      className="rounded-md border border-border px-1.5 py-1 text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      = rest
                    </button>
                    {legs.length > 2 ? (
                      <button
                        type="button"
                        onClick={() => removeLeg(leg.key)}
                        aria-label={`Remove leg ${i + 1}`}
                        className="rounded-md border border-border px-1.5 py-1 text-xs text-muted-foreground hover:text-destructive"
                      >
                        ✕
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={addLeg}>
            + Add leg
          </Button>
          <p className={`text-sm font-medium tabular-nums ${balanced ? "text-muted-foreground" : "text-destructive"}`}>
            Remaining: {remainingLabel}
          </p>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <div className="flex items-center justify-between gap-2 pt-2">
          <div>
            {alreadySplit ? (
              <Button variant="outline" size="sm" onClick={onUnsplit} disabled={pending}>
                Unsplit
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={onSave} disabled={pending || !balanced}>
              {pending ? "Saving…" : alreadySplit ? "Save split" : "Split"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
