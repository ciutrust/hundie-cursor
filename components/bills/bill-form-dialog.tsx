"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
import { createBill, updateBill, type CreateBillInput } from "@/lib/actions/bills";
import { parseAmountToCents, centsToNumber, centsToInput } from "@/lib/money";
import type { Cadence } from "@/lib/bills/cadence";
import type { Bill } from "@/lib/bills/types";

type Entity = { id: string; name: string; slug: string };
type Category = { id: string; full_path: string };

const CADENCES: { value: Cadence; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "semiannual", label: "Every 6 months" },
  { value: "annual", label: "Yearly" },
  { value: "weekly", label: "Weekly" },
  { value: "one_time", label: "One-time" },
];

type Props = {
  entities: Entity[];
  categoriesByEntity: Record<string, Category[]>;
  bill?: Bill;
  trigger: ReactNode;
};

export function BillFormDialog({ entities, categoriesByEntity, bill, trigger }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [entityId, setEntityId] = useState(bill?.entity_id ?? entities[0]?.id ?? "");
  const [name, setName] = useState(bill?.name ?? "");
  const [cadence, setCadence] = useState<Cadence>(bill?.cadence ?? "monthly");
  const [amount, setAmount] = useState(
    bill?.expected_amount != null ? centsToInput(Math.round(bill.expected_amount * 100)) : "",
  );
  const [amountVaries, setAmountVaries] = useState(bill?.amount_varies ?? false);
  const [dueDay, setDueDay] = useState(bill?.due_day != null ? String(bill.due_day) : "");
  const [anchorDate, setAnchorDate] = useState(bill?.anchor_date ?? "");
  const [portalUrl, setPortalUrl] = useState(bill?.portal_url ?? "");
  const [loginHint, setLoginHint] = useState(bill?.login_hint ?? "");
  const [matchHint, setMatchHint] = useState(bill?.match_hint ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(bill?.category_id ?? null);
  const [notes, setNotes] = useState(bill?.notes ?? "");

  const entitySlug = entities.find((e) => e.id === entityId)?.slug;
  const categories = entitySlug ? (categoriesByEntity[entitySlug] ?? []) : [];
  const isOneTime = cadence === "one_time";

  function submit() {
    setError(null);
    if (!name.trim()) {
      setError("Bill name is required");
      return;
    }
    const cents = amount.trim() ? parseAmountToCents(amount) : null;
    if (amount.trim() && cents == null) {
      setError("Enter a valid amount, e.g. 142.00");
      return;
    }
    const input: CreateBillInput = {
      entityId,
      name,
      expectedAmount: cents == null ? null : centsToNumber(cents),
      amountVaries,
      cadence,
      dueDay: dueDay.trim() ? Number(dueDay) : null,
      anchorDate: anchorDate.trim() || null,
      portalUrl: portalUrl.trim() || null,
      loginHint: loginHint.trim() || null,
      matchHint: matchHint.trim() || null,
      categoryId,
      notes: notes.trim() || null,
    };
    startTransition(async () => {
      const res = bill ? await updateBill(bill.id, input) : await createBill(input);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{bill ? "Edit bill" : "Add bill"}</DialogTitle>
          <DialogDescription>
            Hundie only tracks the bill and links out to pay — it never stores a password or moves money.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="bill-name">Biller name</Label>
            <Input
              id="bill-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="TXU Electric"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Entity</Label>
              <Select value={entityId} onValueChange={(v) => setEntityId(v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Entity" />
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
            <div className="space-y-1.5">
              <Label>Frequency</Label>
              <Select value={cadence} onValueChange={(v) => setCadence(v as Cadence)}>
                <SelectTrigger>
                  <SelectValue placeholder="Frequency" />
                </SelectTrigger>
                <SelectContent>
                  {CADENCES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bill-amount">Expected amount</Label>
              <Input
                id="bill-amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="142.00"
                inputMode="decimal"
              />
              <label className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={amountVaries}
                  onChange={(e) => setAmountVaries(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border"
                />
                Amount varies (utilities)
              </label>
            </div>
            {!isOneTime && (
              <div className="space-y-1.5">
                <Label htmlFor="bill-due-day">
                  {cadence === "weekly" ? "Due weekday (0=Sun…6=Sat)" : "Due day (1–31)"}
                </Label>
                <Input
                  id="bill-due-day"
                  value={dueDay}
                  onChange={(e) => setDueDay(e.target.value)}
                  placeholder={cadence === "weekly" ? "1" : "15"}
                  inputMode="numeric"
                />
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bill-anchor">
              {isOneTime ? "Due date" : "First / next due date (optional)"}
            </Label>
            <Input
              id="bill-anchor"
              type="date"
              value={anchorDate}
              onChange={(e) => setAnchorDate(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bill-portal">Payment link (optional)</Label>
            <Input
              id="bill-portal"
              value={portalUrl}
              onChange={(e) => setPortalUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bill-match">Match hint (optional)</Label>
              <Input
                id="bill-match"
                value={matchHint}
                onChange={(e) => setMatchHint(e.target.value)}
                placeholder="TXU"
              />
              <p className="text-[11px] text-muted-foreground">
                How the charge appears in your transactions.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bill-login">Login / note (optional)</Label>
              <Input
                id="bill-login"
                value={loginHint}
                onChange={(e) => setLoginHint(e.target.value)}
                placeholder="username — never a password"
              />
            </div>
          </div>

          <CategorySearchSelect
            id="bill-category"
            label="Category (optional)"
            categories={categories}
            value={categoryId}
            onChange={setCategoryId}
            entitySlug={entitySlug}
          />

          <div className="space-y-1.5">
            <Label htmlFor="bill-notes">Notes (optional)</Label>
            <Input id="bill-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={isPending}>
              {isPending ? "Saving…" : bill ? "Save changes" : "Add bill"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
