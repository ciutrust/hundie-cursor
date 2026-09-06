"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  confirmAmazonSplit,
  confirmAmazonWhole,
  rejectAmazonMatch,
} from "@/lib/actions/amazon";
import { AmazonLogo } from "@/components/amazon/amazon-logo";
import { CategorySearchSelect } from "@/components/review/category-search-select";
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
import { amountToCents, centsToInput } from "@/lib/money";
import { remainingCents, type SplitLegDraft } from "@/lib/split-validation";
import { formatCurrency } from "@/lib/utils";
import type { AmazonDeskQueueItem, AmazonShipmentWithItems } from "@/lib/queries/amazon";

type EntityOpt = { id: string; name: string; slug: string };
type CatOpt = { id: string; full_path: string };

type AmazonDeskClientProps = {
  items: AmazonDeskQueueItem[];
  counts: { open: number; suggested: number; confirmed: number; total: number };
  entities: EntityOpt[];
  categoriesByEntity: Record<string, CatOpt[]>;
  filter: string;
};

type LegDraft = SplitLegDraft & { key: string; label: string };

let legSeq = 0;
function newKey() {
  legSeq += 1;
  return `leg-${legSeq}`;
}

function tierLabel(tier: string | undefined) {
  if (tier === "A") return "Unique match";
  if (tier === "B") return "Ambiguous";
  if (tier === "C") return "No match";
  if (tier === "manual") return "Manual";
  return "—";
}

export function AmazonDeskClient({
  items,
  counts,
  entities,
  categoriesByEntity,
  filter,
}: AmazonDeskClientProps) {
  const [selectedId, setSelectedId] = useState(items[0]?.charge.transactionId ?? null);
  const selected = items.find((i) => i.charge.transactionId === selectedId) ?? items[0] ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <FilterPill href="/amazon?status=open" active={filter === "open"} label={`Open ${counts.open + counts.suggested}`} />
          <FilterPill href="/amazon?status=suggested" active={filter === "suggested"} label={`Suggested ${counts.suggested}`} />
          <FilterPill href="/amazon?status=confirmed" active={filter === "confirmed"} label={`Done ${counts.confirmed}`} />
          <FilterPill href="/amazon?status=all" active={filter === "all"} label={`All ${counts.total}`} />
        </div>
        <ul className="max-h-[70vh] space-y-1 overflow-y-auto rounded-xl border border-border">
          {items.length === 0 ? (
            <li className="p-4 text-sm text-muted-foreground">
              No Amazon charges in this filter. Import an Orders export, or check All.
            </li>
          ) : (
            items.map((item) => {
              const active = item.charge.transactionId === selected?.charge.transactionId;
              return (
                <li key={item.charge.transactionId}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(item.charge.transactionId)}
                    className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm ${
                      active ? "bg-muted" : "hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium tabular-nums">{item.charge.date}</span>
                      <span className="tabular-nums">{formatCurrency(item.charge.amount)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="truncate">{item.charge.accountName}</span>
                      <span>
                        {item.link?.status === "confirmed"
                          ? "Done"
                          : tierLabel(item.link?.match_tier)}
                      </span>
                    </div>
                    {item.shipment ? (
                      <p className="truncate text-xs text-muted-foreground">
                        {item.shipment.items[0]?.product_name ?? item.shipment.order_id}
                      </p>
                    ) : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>

      {selected ? (
        <AmazonChargeDetail
          key={selected.charge.transactionId}
          item={selected}
          entities={entities}
          categoriesByEntity={categoriesByEntity}
          onDone={() => {
            const idx = items.findIndex(
              (i) => i.charge.transactionId === selected.charge.transactionId,
            );
            const next = items[idx + 1] ?? items[idx - 1] ?? null;
            setSelectedId(next?.charge.transactionId ?? null);
          }}
        />
      ) : (
        <div className="flex items-center justify-center rounded-xl border border-dashed border-border p-8 text-sm text-muted-foreground">
          Select a charge
        </div>
      )}
    </div>
  );
}

function FilterPill({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 ${
        active
          ? "border-amber-500 bg-amber-50 font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          : "border-border text-muted-foreground hover:bg-muted"
      }`}
    >
      {label}
    </Link>
  );
}

function AmazonChargeDetail({
  item,
  entities,
  categoriesByEntity,
  onDone,
}: {
  item: AmazonDeskQueueItem;
  entities: EntityOpt[];
  categoriesByEntity: Record<string, CatOpt[]>;
  onDone: () => void;
}) {
  const charge = item.charge;
  const defaultEntity = entities.find((e) => e.id === charge.entityId) ?? entities[0];
  const [entityId, setEntityId] = useState(defaultEntity?.id ?? "");
  const entitySlug = entities.find((e) => e.id === entityId)?.slug ?? charge.entitySlug;
  const categories = categoriesByEntity[entitySlug] ?? [];

  const shipmentOptions = useMemo(() => {
    const list = [...item.candidateShipments];
    if (item.shipment && !list.some((s) => s.id === item.shipment!.id)) {
      list.unshift(item.shipment);
    }
    return list;
  }, [item.candidateShipments, item.shipment]);

  const [shipmentId, setShipmentId] = useState(
    item.shipment?.id ?? shipmentOptions[0]?.id ?? "",
  );
  const activeShipment =
    shipmentOptions.find((s) => s.id === shipmentId) ?? item.shipment ?? null;

  const [categoryId, setCategoryId] = useState<string | null>(charge.categoryId);
  const [mode, setMode] = useState<"whole" | "split">("whole");
  const [extraNotes, setExtraNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const parentCents = Math.abs(amountToCents(Number(charge.amount)));
  const sign = Number(charge.amount) < 0 ? -1 : 1;

  function buildLegsFromShipment(ship: AmazonShipmentWithItems | null): LegDraft[] {
    const items = ship?.items ?? [];
    if (items.length >= 2) {
      const drafts: LegDraft[] = items.map((it) => {
        const line = it.line_total_cents ?? it.unit_price_cents ?? 0;
        return {
          key: newKey(),
          entityId: charge.entityId,
          categoryId: null,
          amount: centsToInput(sign * line),
          label: it.product_name.slice(0, 40),
        };
      });
      const used = drafts.reduce((s, l) => {
        const n = Math.abs(amountToCents(Number(l.amount) || 0));
        return s + n;
      }, 0);
      const rem = parentCents - used;
      if (rem !== 0) {
        drafts.push({
          key: newKey(),
          entityId: charge.entityId,
          categoryId: null,
          amount: centsToInput(sign * rem),
          label: "Tax / shipping / remainder",
        });
      }
      return drafts;
    }
    return [
      {
        key: newKey(),
        entityId: charge.entityId,
        categoryId: charge.categoryId,
        amount: centsToInput(Number(charge.amount)),
        label: "Full charge",
      },
      {
        key: newKey(),
        entityId: charge.entityId,
        categoryId: null,
        amount: "",
        label: "Part 2",
      },
    ];
  }

  const [legs, setLegs] = useState<LegDraft[]>(() => buildLegsFromShipment(activeShipment));

  useEffect(() => {
    setLegs(buildLegsFromShipment(activeShipment));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild only when shipment changes
  }, [shipmentId]);

  const remaining = remainingCents(legs, Number(charge.amount));

  function confirmWhole() {
    if (!shipmentId || !categoryId) {
      setError("Pick a shipment and category");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await confirmAmazonWhole({
        transactionId: charge.transactionId,
        shipmentId,
        entityId,
        categoryId,
        entitySlug,
        extraNotes: extraNotes || null,
      });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      onDone();
    });
  }

  function confirmSplit() {
    if (!shipmentId) {
      setError("Pick a shipment");
      return;
    }
    if (legs.some((l) => !l.categoryId)) {
      setError("Every split leg needs a category");
      return;
    }
    if (remaining !== 0) {
      setError("Split legs must sum to the charge exactly");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await confirmAmazonSplit({
        transactionId: charge.transactionId,
        shipmentId,
        entitySlug,
        extraNotes: extraNotes || null,
        legs: legs.map((l) => ({
          entityId: l.entityId,
          categoryId: l.categoryId!,
          amount: l.amount,
          label: l.label,
        })),
      });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      onDone();
    });
  }

  function onReject() {
    setError(null);
    startTransition(async () => {
      const res = await rejectAmazonMatch(charge.transactionId);
      if ("error" in res) setError(res.error);
      else onDone();
    });
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <AmazonLogo className="h-5 w-5 text-[#232F3E]" />
            <h2 className="text-lg font-semibold tabular-nums">
              {formatCurrency(charge.amount)}
            </h2>
          </div>
          <p className="text-sm text-muted-foreground">
            {charge.date} · {charge.accountName}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{charge.descriptor}</p>
          {item.link ? (
            <p className="mt-1 text-xs">
              Match: {tierLabel(item.link.match_tier)}
              {item.link.match_hypothesis ? ` (${item.link.match_hypothesis})` : ""}
              {item.link.date_delta != null ? ` · Δ${item.link.date_delta}d` : ""}
            </p>
          ) : null}
        </div>
        <Link
          href={`/review/${charge.entitySlug}`}
          className="text-xs text-muted-foreground underline"
        >
          Open in review
        </Link>
      </div>

      <div className="space-y-2">
        <Label>Matched shipment</Label>
        {shipmentOptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No shipment candidates. Import a fresher Orders export or pick after rematch.
          </p>
        ) : (
          <Select value={shipmentId} onValueChange={setShipmentId}>
            <SelectTrigger>
              <SelectValue placeholder="Select shipment" />
            </SelectTrigger>
            <SelectContent>
              {shipmentOptions.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.order_id} · {s.ship_date ?? "?"} ·{" "}
                  {s.items[0]?.product_name?.slice(0, 40) ?? s.order_id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {activeShipment ? (
          <div className="space-y-2 rounded-lg border border-border bg-background p-3">
            <a
              href={activeShipment.order_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-amber-700 underline dark:text-amber-400"
            >
              Open Amazon order →
            </a>
            <ul className="space-y-1 text-sm">
              {(activeShipment.items ?? []).map((it) => (
                <li key={it.id} className="flex justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate">
                    {it.quantity > 1 ? `${it.quantity}× ` : ""}
                    {it.product_name}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {it.line_total_cents != null
                      ? formatCurrency((it.line_total_cents / 100) * (sign < 0 ? -1 : 1))
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={mode === "whole" ? "default" : "outline"}
          onClick={() => setMode("whole")}
        >
          Whole charge
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "split" ? "default" : "outline"}
          onClick={() => setMode("split")}
        >
          Split by item
        </Button>
      </div>

      {mode === "whole" ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Entity</Label>
            <Select
              value={entityId}
              onValueChange={(id) => {
                setEntityId(id);
                setCategoryId(null);
              }}
            >
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
          <CategorySearchSelect
            id="amazon-cat"
            label="Category"
            entitySlug={entitySlug}
            categories={categories}
            value={categoryId}
            onChange={setCategoryId}
          />
        </div>
      ) : (
        <div className="space-y-3">
          {legs.map((leg) => {
            const slug = entities.find((e) => e.id === leg.entityId)?.slug ?? entitySlug;
            const cats = categoriesByEntity[slug] ?? [];
            return (
              <div key={leg.key} className="space-y-2 rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">{leg.label}</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Select
                    value={leg.entityId}
                    onValueChange={(id) =>
                      setLegs((prev) =>
                        prev.map((l) =>
                          l.key === leg.key ? { ...l, entityId: id, categoryId: null } : l,
                        ),
                      )
                    }
                  >
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
                  <Input
                    value={leg.amount}
                    onChange={(e) =>
                      setLegs((prev) =>
                        prev.map((l) =>
                          l.key === leg.key ? { ...l, amount: e.target.value } : l,
                        ),
                      )
                    }
                    className="tabular-nums"
                  />
                  <CategorySearchSelect
                    id={`amazon-split-${leg.key}`}
                    label="Category"
                    entitySlug={slug}
                    categories={cats}
                    value={leg.categoryId}
                    onChange={(cid) =>
                      setLegs((prev) =>
                        prev.map((l) => (l.key === leg.key ? { ...l, categoryId: cid } : l)),
                      )
                    }
                  />
                </div>
              </div>
            );
          })}
          <p
            className={`text-sm tabular-nums ${remaining === 0 ? "text-emerald-600" : "text-amber-700"}`}
          >
            Remaining: {formatCurrency(remaining / 100)}
          </p>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="amazon-extra-notes">Extra notes (optional)</Label>
        <Input
          id="amazon-extra-notes"
          value={extraNotes}
          onChange={(e) => setExtraNotes(e.target.value)}
          placeholder="Added before item summary + order URL"
        />
        <p className="text-xs text-muted-foreground">
          On confirm, notes get the item summary and Amazon order link automatically.
        </p>
      </div>

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={pending || !shipmentId || item.link?.status === "confirmed"}
          onClick={mode === "whole" ? confirmWhole : confirmSplit}
        >
          {pending ? "Saving…" : "Confirm & link"}
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={onReject}>
          Skip / no match
        </Button>
      </div>
    </div>
  );
}
