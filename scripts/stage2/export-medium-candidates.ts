// Stage 2 — export the Tier-1 MEDIUM-confidence proposals for a Claude review pass.
// For each medium proposal (grouped by vendor) it gathers what made it ambiguous: the current
// proposed category, the FULL same-entity training distribution, cross-entity hints, samples.
// Writes batch files + manifest under scratchpad/medium. Read-only.

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractVendorSearchKey } from "../../lib/suggestions/category-suggestions.ts";

const OUT = "/private/tmp/claude-501/-Users-ac-hundie-cursor/871240a2-9807-4be9-84ed-fe087b3806d5/scratchpad/medium";
const BATCH = 40;
const ENTITIES = ["gbsl", "personal", "keller", "acaa-austin"];
const PAGE = 1000;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
function loadEnv() {
  const env: Record<string, string> = {};
  for (const line of readFileSync(join(root, ".env.local"), "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq !== -1) env[t.slice(0, eq)] = t.slice(eq + 1);
  }
  return env;
}
const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
mkdirSync(OUT, { recursive: true });

async function pageAll<T>(b: (f: number, t: number) => Promise<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let f = 0; ; f += PAGE) {
    const { data, error } = await b(f, f + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

const { data: cats } = await supabase.from("categories").select("id, entity_id, full_path, is_active");
const { data: ents } = await supabase.from("entities").select("id, slug");
const idBySlug = new Map((ents ?? []).map((e) => [e.slug, e.id]));
const pathById = new Map<string, string>();
for (const c of cats ?? []) if (c.is_active) pathById.set(c.id, c.full_path);

// training tally per entity (vendorKey -> category_path -> count)
async function tally(entityId: string) {
  const rows = await pageAll<{ category_id: string | null; vendor_name: string | null; description: string | null }>((f, t) =>
    supabase.from("qb_training_expenses").select("category_id, vendor_name, description").eq("entity_id", entityId).not("category_id", "is", null).range(f, t));
  const m = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!r.category_id || !pathById.has(r.category_id)) continue;
    const vk = extractVendorSearchKey(r.description ?? "", r.vendor_name);
    if (!vk) continue;
    const inner = m.get(vk) ?? new Map();
    const path = pathById.get(r.category_id)!;
    inner.set(path, (inner.get(path) ?? 0) + 1);
    m.set(vk, inner);
  }
  return m;
}
const tallies: Record<string, Map<string, Map<string, number>>> = {};
for (const s of ENTITIES) { const id = idBySlug.get(s); if (id) tallies[s] = await tally(id); }

const manifest: { entity: string; vendors: number; batches: string[] }[] = [];

for (const slug of ENTITIES) {
  const entityId = idBySlug.get(slug);
  if (!entityId) continue;

  const props = await pageAll<{ vendor_key: string; proposed_category_path: string | null; transaction_id: string; transactions: { description: string; vendor: string | null; amount: number | string; accounts: { slug: string } | null } }>((f, t) =>
    supabase.from("classification_proposals")
      .select("vendor_key, proposed_category_path, transaction_id, transactions!inner(description, vendor, amount, accounts!inner(slug))")
      .eq("entity_slug", slug).eq("source", "training").eq("confidence", "medium").range(f, t) as never);

  const byVk = new Map<string, { vendor_key: string; proposed: string | null; count: number; total: number; samples: Set<string>; accounts: Set<string>; transaction_ids: string[] }>();
  for (const p of props) {
    const g = byVk.get(p.vendor_key) ?? { vendor_key: p.vendor_key, proposed: p.proposed_category_path, count: 0, total: 0, samples: new Set<string>(), accounts: new Set<string>(), transaction_ids: [] };
    g.count += 1;
    g.total += Math.abs(Number(p.transactions?.amount ?? 0));
    if (g.samples.size < 3) g.samples.add((p.transactions?.description ?? "").slice(0, 60));
    if (p.transactions?.accounts?.slug) g.accounts.add(p.transactions.accounts.slug);
    g.transaction_ids.push(p.transaction_id);
    byVk.set(p.vendor_key, g);
  }

  const vendors = [...byVk.values()].map((g) => {
    const dist = [...(tallies[slug]?.get(g.vendor_key)?.entries() ?? [])].map(([category, n]) => ({ category, n })).sort((a, b) => b.n - a.n);
    const cross: { entity: string; dist: { category: string; n: number }[] }[] = [];
    for (const other of ENTITIES) {
      if (other === slug) continue;
      const m = tallies[other]?.get(g.vendor_key);
      if (m) cross.push({ entity: other, dist: [...m.entries()].map(([category, n]) => ({ category, n })).sort((a, b) => b.n - a.n).slice(0, 3) });
    }
    return { vendor_key: g.vendor_key, current_proposed: g.proposed, count: g.count, total: Math.round(g.total * 100) / 100, samples: [...g.samples], accounts: [...g.accounts], training_distribution: dist, cross_entity: cross };
  }).sort((a, b) => b.total - a.total);

  const batches: string[] = [];
  for (let i = 0; i < vendors.length; i += BATCH) {
    const file = join(OUT, `${slug}-${i / BATCH}.json`);
    writeFileSync(file, JSON.stringify({ entity: slug, vendors: vendors.slice(i, i + BATCH) }));
    batches.push(file);
  }
  manifest.push({ entity: slug, vendors: vendors.length, batches });
  console.log(`${slug.padEnd(14)} medium vendors=${String(vendors.length).padStart(4)}  batches=${batches.length}`);
}

writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1));
console.log(`\nWrote to ${OUT}. Total medium vendors: ${manifest.reduce((s, m) => s + m.vendors, 0)} / batches: ${manifest.reduce((s, m) => s + m.batches.length, 0)}`);
