"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setProposalDecision, commitApprovedProposals } from "@/lib/actions/proposals";
import type { Proposal } from "@/lib/queries/proposals";
import { formatCurrency } from "@/lib/utils";

type Category = { id: string; full_path: string };
type Entity = { id: string; name: string; slug: string };
type Props = {
  entitySlug: string;
  proposals: Proposal[];
  entities: Entity[];
  categoriesByEntity: Record<string, Category[]>;
};

type SortKey = "vendor" | "count" | "amount" | "confidence";

type Group = {
  vendorKey: string;
  label: string;
  proposals: Proposal[];
  count: number;
  total: number; // sum of absolute amounts
  confidence: Proposal["confidence"];
  source: Proposal["source"];
  proposedPath: string | null;
  rationale: string | null;
  allApproved: boolean;
  anyApproved: boolean;
};

const CONF_RANK: Record<Proposal["confidence"], number> = { high: 3, medium: 2, low: 1 };

function confidenceBadge(c: Proposal["confidence"]) {
  const map = {
    high: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
    medium: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
    low: "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
  } as const;
  return map[c];
}

export function ProposalsPanel({ entitySlug, proposals, entities, categoriesByEntity }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [override, setOverride] = useState<Record<string, string | null>>({});
  const [overrideEntity, setOverrideEntity] = useState<Record<string, string>>({});
  const entityIdBySlug = useMemo(() => new Map(entities.map((e) => [e.slug, e.id])), [entities]);
  const slugByEntityId = useMemo(() => new Map(entities.map((e) => [e.id, e.slug])), [entities]);
  const [search, setSearch] = useState("");
  const [confFilter, setConfFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [catFilter, setCatFilter] = useState("all"); // all | hard (no category) | has
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set()); // proposal ids NOT selected (default: all selected)
  const [sortKey, setSortKey] = useState<SortKey>("amount");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const groups = useMemo<Group[]>(() => {
    const byKey = new Map<string, Proposal[]>();
    for (const p of proposals) {
      const arr = byKey.get(p.vendor_key) ?? [];
      arr.push(p);
      byKey.set(p.vendor_key, arr);
    }
    const out: Group[] = [];
    for (const [vendorKey, ps] of byKey) {
      const rep = ps[0];
      // most readable label = the longest distinct vendor/description in the cluster
      const label =
        ps.map((p) => p.vendor || p.description).sort((a, b) => b.length - a.length)[0] || vendorKey;
      out.push({
        vendorKey,
        label,
        proposals: ps,
        count: ps.length,
        total: ps.reduce((s, p) => s + Math.abs(p.amount), 0),
        confidence: rep.confidence,
        source: rep.source,
        proposedPath: rep.proposed_category_path,
        rationale: rep.rationale,
        allApproved: ps.every((p) => p.status === "approved"),
        anyApproved: ps.some((p) => p.status === "approved"),
      });
    }
    return out;
  }, [proposals]);

  const filteredSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const f = groups.filter((g) => {
      if (q && !g.label.toLowerCase().includes(q) && !g.vendorKey.includes(q)) return false;
      if (confFilter !== "all" && g.confidence !== confFilter) return false;
      if (sourceFilter !== "all" && g.source !== sourceFilter) return false;
      if (statusFilter === "approved" && !g.allApproved) return false;
      if (statusFilter === "pending" && g.allApproved) return false;
      const noCat = !g.proposedPath && !g.proposals[0].chosen_category_id;
      if (catFilter === "hard" && !noCat) return false;
      if (catFilter === "has" && noCat) return false;
      return true;
    });
    const dir = sortKey === "vendor" ? 1 : -1;
    f.sort((a, b) => {
      if (sortKey === "vendor") return a.label.localeCompare(b.label) * dir;
      if (sortKey === "count") return (a.count - b.count) * dir;
      if (sortKey === "amount") return (a.total - b.total) * dir;
      return (CONF_RANK[a.confidence] - CONF_RANK[b.confidence]) * dir;
    });
    return f;
  }, [groups, search, confFilter, sourceFilter, statusFilter, catFilter, sortKey]);

  const approvedCount = proposals.filter((p) => p.status === "approved").length;

  function toggle(key: string) {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleRow(id: string) {
    setUnchecked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function setGroupChecked(g: Group, checked: boolean) {
    setUnchecked((s) => {
      const next = new Set(s);
      for (const p of g.proposals) {
        if (checked) next.delete(p.id);
        else next.add(p.id);
      }
      return next;
    });
  }
  const selectedIds = (g: Group) => g.proposals.filter((p) => !unchecked.has(p.id)).map((p) => p.id);

  function curEntitySlug(g: Group) {
    if (overrideEntity[g.vendorKey]) return overrideEntity[g.vendorKey];
    // a proposal may already recommend a reassignment (Tier-2 cross-entity) via chosen_entity_id
    const chosenEnt = g.proposals[0].chosen_entity_id;
    if (chosenEnt && slugByEntityId.has(chosenEnt)) return slugByEntityId.get(chosenEnt)!;
    return entitySlug;
  }
  function curCategoryId(g: Group): string | null {
    if (g.vendorKey in override) return override[g.vendorKey];
    if (g.proposals[0].chosen_category_id) return g.proposals[0].chosen_category_id;
    return curEntitySlug(g) === entitySlug ? g.proposals[0].proposed_category_id : null;
  }
  function onEntityChange(g: Group, slug: string) {
    setOverrideEntity((o) => ({ ...o, [g.vendorKey]: slug }));
    // the category list changes with the entity; restore the proposal only when back to original
    setOverride((o) => ({
      ...o,
      [g.vendorKey]: slug === entitySlug ? g.proposals[0].proposed_category_id : null,
    }));
  }

  function decide(group: Group, decision: "approved" | "rejected") {
    const ids = selectedIds(group);
    if (ids.length === 0) {
      setError(`No transactions selected in "${group.label}"`);
      return;
    }
    const catId = curCategoryId(group);
    if (decision === "approved" && !catId) {
      setError(`Pick a category for "${group.label}" (entity changed → choose its category)`);
      return;
    }
    const chosenEntityId = entityIdBySlug.get(curEntitySlug(group)) ?? null;
    const moved = curEntitySlug(group) !== entitySlug ? ` → ${curEntitySlug(group)}` : "";
    setError(null);
    startTransition(async () => {
      const res = await setProposalDecision(ids, decision, catId, chosenEntityId);
      if ("error" in res) return setError(res.error);
      setStatus(`${decision === "approved" ? "Approved" : "Rejected"} ${res.count} · ${group.label}${moved}`);
      router.refresh();
    });
  }

  function approveAllHighConfidence() {
    const ids = filteredSorted
      .filter((g) => g.confidence === "high" && !g.allApproved)
      .flatMap((g) => g.proposals.map((p) => p.id));
    if (ids.length === 0) return setError("No high-confidence pending groups in view");
    setError(null);
    startTransition(async () => {
      const res = await setProposalDecision(ids, "approved");
      if ("error" in res) return setError(res.error);
      setStatus(`Approved ${res.count} high-confidence proposals`);
      router.refresh();
    });
  }

  function commit() {
    setError(null);
    startTransition(async () => {
      const res = await commitApprovedProposals(entitySlug);
      if ("error" in res) return setError(res.error);
      setStatus(`Committed ${res.count} classification(s)${res.skipped ? ` (${res.skipped} skipped)` : ""}`);
      router.refresh();
    });
  }

  if (proposals.length === 0) {
    return <p className="text-sm text-muted-foreground">No pending proposals for this entity. 🎉</p>;
  }

  return (
    <div className="space-y-4 pb-24">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <Input type="search" placeholder="Filter vendors…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="h-10 rounded-md border border-border bg-background px-3 text-sm" value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
          <option value="amount">Sort: amount ↓</option>
          <option value="count">Sort: # txns ↓</option>
          <option value="vendor">Sort: vendor A–Z</option>
          <option value="confidence">Sort: confidence ↓</option>
        </select>
        <select className="h-10 rounded-md border border-border bg-background px-3 text-sm" value={confFilter} onChange={(e) => setConfFilter(e.target.value)}>
          <option value="all">All confidence</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select className="h-10 rounded-md border border-border bg-background px-3 text-sm" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
          <option value="all">All sources</option>
          <option value="training">Training</option>
          <option value="claude">Claude</option>
        </select>
        <select className="h-10 rounded-md border border-border bg-background px-3 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All status</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
        </select>
        <select className="h-10 rounded-md border border-border bg-background px-3 text-sm" value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
          <option value="all">All categories</option>
          <option value="hard">⚠ Hard — no category</option>
          <option value="has">Has a category</option>
        </select>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {filteredSorted.length} vendor groups · {proposals.length} transactions · {approvedCount} approved
        </p>
        <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={approveAllHighConfidence}>
          Approve all high-confidence (visible)
        </Button>
      </div>

      {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="space-y-2">
        {filteredSorted.map((g) => {
          const isOpen = expanded.has(g.vendorKey);
          const entSlug = curEntitySlug(g);
          const catId = curCategoryId(g);
          const moved = entSlug !== entitySlug;
          const cats = categoriesByEntity[entSlug] ?? [];
          const selCount = selectedIds(g).length;
          const partial = selCount !== g.count;
          return (
            <div
              key={g.vendorKey}
              className={`rounded-lg border bg-card ${g.allApproved ? "border-emerald-300 dark:border-emerald-800" : "border-border"}`}
            >
              <div className="flex flex-wrap items-start gap-3 px-3 py-2">
                <button type="button" className="mt-0.5 flex min-w-0 flex-1 items-start gap-2 text-left" onClick={() => toggle(g.vendorKey)}>
                  {isOpen ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{g.label}</span>
                      <span className="text-xs text-muted-foreground">{g.count} txns · {formatCurrency(g.total)}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${confidenceBadge(g.confidence)}`}>{g.confidence}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{g.source === "claude" ? "Claude" : "training"}</span>
                      {g.allApproved ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">approved</span> : null}
                    </div>
                    <p className="mt-0.5 text-sm">
                      → <span className="font-medium">{g.proposedPath ?? "—"}</span>
                    </p>
                    {g.rationale ? <p className="mt-0.5 text-xs italic text-muted-foreground">{g.rationale}</p> : null}
                  </div>
                </button>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className={`h-9 rounded-md border bg-background px-2 text-sm ${moved ? "border-amber-500 font-medium text-amber-700 dark:text-amber-300" : "border-border"}`}
                    value={entSlug}
                    onChange={(e) => onEntityChange(g, e.target.value)}
                    aria-label="Entity"
                    title={moved ? `Reassigned from ${entitySlug}` : "Entity"}
                  >
                    {entities.map((e) => (
                      <option key={e.slug} value={e.slug}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="h-9 max-w-[220px] rounded-md border border-border bg-background px-2 text-sm"
                    value={catId ?? ""}
                    onChange={(e) => setOverride((o) => ({ ...o, [g.vendorKey]: e.target.value || null }))}
                    aria-label="Category"
                  >
                    <option value="">— pick category —</option>
                    {cats.map((c) => (
                      <option key={c.id} value={c.id}>{c.full_path}</option>
                    ))}
                  </select>
                  <Button type="button" size="sm" disabled={isPending || selCount === 0} onClick={() => decide(g, "approved")}>
                    <Check className="mr-1 h-4 w-4" /> Approve{partial ? ` (${selCount})` : ""}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" disabled={isPending || selCount === 0} onClick={() => decide(g, "rejected")}>
                    <X className="mr-1 h-4 w-4" /> Reject{partial ? ` (${selCount})` : ""}
                  </Button>
                </div>
              </div>

              {isOpen ? (
                <div className="border-t border-border">
                  <label className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5"
                      checked={selCount === g.count}
                      ref={(el) => {
                        if (el) el.indeterminate = selCount > 0 && selCount < g.count;
                      }}
                      onChange={(e) => setGroupChecked(g, e.target.checked)}
                      aria-label="Select all in group"
                    />
                    {selCount} of {g.count} selected — uncheck rows to split this group; Approve/Reject act on the checked rows.
                  </label>
                  <ul className="divide-y divide-border border-t border-border">
                    {g.proposals.map((p) => (
                      <li key={p.id} className="flex items-start gap-3 px-3 py-2 text-sm">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 shrink-0"
                          checked={!unchecked.has(p.id)}
                          onChange={() => toggleRow(p.id)}
                          aria-label="Select transaction"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate">{p.description}</p>
                          <p className="text-xs text-muted-foreground">{p.transaction_date} · {p.account_display_name}</p>
                        </div>
                        <span className="shrink-0 tabular-nums">{formatCurrency(p.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            <strong className="tabular-nums">{approvedCount}</strong> approved & ready to write
          </p>
          <Button type="button" disabled={isPending || approvedCount === 0} onClick={commit}>
            Commit approved ({approvedCount})
          </Button>
        </div>
      </div>
    </div>
  );
}
