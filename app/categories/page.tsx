import Link from "next/link";
import { BookOpen } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getClassifiableEntities } from "@/lib/queries/review";
import {
  DESCRIPTIONS,
  KIND_INFO,
  KIND_ORDER,
  type CategoryKind,
} from "@/lib/category-descriptions";

type PageProps = { searchParams: Promise<{ entity?: string }> };

function pnlBadge(pnl: "income" | "expense" | "no" | "flag") {
  if (pnl === "income")
    return <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">P&L · income</span>;
  if (pnl === "expense")
    return <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">P&L · expense</span>;
  if (pnl === "flag")
    return <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-medium text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">spent · not deductible</span>;
  return <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">not P&L</span>;
}

export default async function CategoriesPage({ searchParams }: PageProps) {
  const { entity } = await searchParams;
  const entities = await getClassifiableEntities();
  const activeSlug = entity && entities.some((e) => e.slug === entity) ? entity : (entities[0]?.slug ?? "personal");
  const activeEntity = entities.find((e) => e.slug === activeSlug);

  const sb = (await createClient()) as unknown as SupabaseClient;
  const { data } = await sb
    .from("categories")
    .select("id, full_path, kind")
    .eq("entity_id", activeEntity?.id ?? "")
    .eq("is_active", true)
    .order("full_path");
  const cats = (data ?? []) as { id: string; full_path: string; kind: CategoryKind | null }[];

  const byKind = new Map<CategoryKind, { full_path: string; description?: string }[]>();
  for (const c of cats) {
    const kind = (c.kind ?? "unclassified") as CategoryKind;
    const arr = byKind.get(kind) ?? [];
    arr.push({ full_path: c.full_path, description: DESCRIPTIONS[c.full_path] });
    byKind.set(kind, arr);
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Reference</p>
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-sky-500" />
          <h1 className="text-3xl font-semibold tracking-tight">Categories</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          What each category means and whether it hits your P&L. Use this when you&apos;re unsure which to pick.
        </p>
      </div>

      <nav className="flex flex-wrap gap-2">
        {entities.map((e) => {
          const active = e.slug === activeSlug;
          return (
            <Link
              key={e.slug}
              href={`/categories?entity=${e.slug}`}
              className={`rounded-full border px-3 py-1 text-sm ${active ? "border-sky-500 bg-sky-50 font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-300" : "border-border text-muted-foreground hover:bg-muted"}`}
            >
              {e.name}
            </Link>
          );
        })}
      </nav>

      {/* Legend */}
      <div className="rounded-lg border border-border bg-card p-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">How the kinds map to your P&L</p>
        <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
          {KIND_ORDER.map((k) => (
            <li key={k} className="flex items-start gap-2">
              {pnlBadge(KIND_INFO[k].pnl)}
              <span className="text-muted-foreground">
                <span className="font-medium text-foreground">{KIND_INFO[k].label}:</span> {KIND_INFO[k].blurb}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Categories grouped by kind */}
      <div className="space-y-5">
        {KIND_ORDER.filter((k) => byKind.has(k)).map((k) => (
          <section key={k}>
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-lg font-semibold">{KIND_INFO[k].label}</h2>
              {pnlBadge(KIND_INFO[k].pnl)}
              <span className="text-xs text-muted-foreground">{byKind.get(k)!.length}</span>
            </div>
            <ul className="divide-y divide-border rounded-lg border border-border bg-card">
              {byKind.get(k)!.map((c) => (
                <li key={c.full_path} className="px-3 py-2">
                  <p className="text-sm font-medium">{c.full_path}</p>
                  {c.description ? <p className="mt-0.5 text-xs text-muted-foreground">{c.description}</p> : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
