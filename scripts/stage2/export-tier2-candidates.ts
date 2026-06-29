// Stage 2 — Tier-2 candidate exporter (read-only).
//
// Finds the unclassified transactions that Tier-1 did NOT propose (no row in classification_proposals),
// groups them by vendor key, and attaches the signal Claude needs to reason well:
//   - count / total / sample descriptions / accounts / the transaction_ids in the cluster
//   - cross-entity training hint: how this vendor was categorized under OTHER entities (esp. GBSL)
// Writes batch files under scratchpad + a charts.json (every entity's active categories), then prints
// the batch list. A Workflow then reasons over each batch; a writer turns decisions into proposals.

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractVendorSearchKey } from "../../lib/suggestions/category-suggestions.ts";
import { dominantCategory } from "../lib/proposal-ranking.mjs";

const OUT = "/private/tmp/claude-501/-Users-ac-hundie-cursor/871240a2-9807-4be9-84ed-fe087b3806d5/scratchpad/tier2";
const BATCH = 40;
const ENTITIES = ["personal", "keller", "acaa-austin", "gbsl", "pflugerville"]; // personal first
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
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

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

mkdirSync(OUT, { recursive: true });

// active categories per entity
const { data: cats } = await supabase.from("categories").select("id, entity_id, full_path, is_active");
const { data: ents } = await supabase.from("entities").select("id, slug, name");
const idBySlug = new Map((ents ?? []).map((e) => [e.slug, e.id]));
const nameBySlug = new Map((ents ?? []).map((e) => [e.slug, e.name]));
const pathById = new Map<string, string>();
const chartByEntity: Record<string, string[]> = {};
for (const c of cats ?? []) {
  if (!c.is_active) continue;
  pathById.set(c.id, c.full_path);
  const slug = (ents ?? []).find((e) => e.id === c.entity_id)?.slug;
  if (slug) (chartByEntity[slug] ??= []).push(c.full_path);
}
writeFileSync(join(OUT, "charts.json"), JSON.stringify(chartByEntity, null, 1));

// training tally per entity: vendorKey -> (categoryId -> count), active cats only
async function buildTally(entityId: string) {
  const rows = await pageAll<{ category_id: string | null; vendor_name: string | null; description: string | null }>(
    (f, t) =>
      supabase
        .from("qb_training_expenses")
        .select("category_id, vendor_name, description")
        .eq("entity_id", entityId)
        .not("category_id", "is", null)
        .range(f, t),
  );
  const tally = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!r.category_id || !pathById.has(r.category_id)) continue;
    const vk = extractVendorSearchKey(r.description ?? "", r.vendor_name);
    if (!vk) continue;
    const m = tally.get(vk) ?? new Map();
    m.set(r.category_id, (m.get(r.category_id) ?? 0) + 1);
    tally.set(vk, m);
  }
  return tally;
}
const tallies: Record<string, Map<string, Map<string, number>>> = {};
for (const slug of ENTITIES) {
  const id = idBySlug.get(slug);
  if (id) tallies[slug] = await buildTally(id);
}

function crossEntity(vk: string, exceptSlug: string) {
  const hints: { entity: string; category: string; share: number; n: number }[] = [];
  for (const slug of ENTITIES) {
    if (slug === exceptSlug) continue;
    const m = tallies[slug]?.get(vk);
    if (!m) continue;
    const counts = [...m.entries()].map(([cid, count]) => ({ categoryId: cid, categoryPath: pathById.get(cid) ?? "", count }));
    const dom = dominantCategory(counts, { medShare: 0.5 });
    if (dom) hints.push({ entity: slug, category: dom.categoryPath, share: Math.round(dom.share * 100) / 100, n: dom.total });
  }
  return hints;
}

const manifest: { entity: string; vendors: number; batches: string[] }[] = [];

for (const slug of ENTITIES) {
  const entityId = idBySlug.get(slug);
  if (!entityId) continue;

  // proposals already written (Tier-1) → exclude
  const proposed = new Set(
    (await pageAll<{ transaction_id: string }>((f, t) =>
      supabase.from("classification_proposals").select("transaction_id").eq("entity_slug", slug).range(f, t),
    )).map((r) => r.transaction_id),
  );

  const unclassified = await pageAll<{ transaction_id: string; transactions: { description: string; vendor: string | null; amount: number | string; accounts: { slug: string } | null } }>(
    (f, t) =>
      supabase
        .from("classifications")
        .select("transaction_id, transactions!inner(description, vendor, amount, accounts!inner(slug))")
        .eq("entity_id", entityId)
        .is("category_id", null)
        .range(f, t) as never,
  );

  const byVk = new Map<string, { vendor_key: string; count: number; total: number; samples: Set<string>; accounts: Set<string>; transaction_ids: string[] }>();
  for (const r of unclassified) {
    if (proposed.has(r.transaction_id)) continue;
    const desc = r.transactions?.description ?? "";
    const vk = extractVendorSearchKey(desc, r.transactions?.vendor ?? null);
    const g = byVk.get(vk) ?? { vendor_key: vk, count: 0, total: 0, samples: new Set<string>(), accounts: new Set<string>(), transaction_ids: [] };
    g.count += 1;
    g.total += Math.abs(Number(r.transactions?.amount ?? 0));
    if (g.samples.size < 3) g.samples.add(desc.slice(0, 60));
    if (r.transactions?.accounts?.slug) g.accounts.add(r.transactions.accounts.slug);
    g.transaction_ids.push(r.transaction_id);
    byVk.set(vk, g);
  }

  const vendors = [...byVk.values()]
    .map((g) => ({
      vendor_key: g.vendor_key,
      count: g.count,
      total: Math.round(g.total * 100) / 100,
      samples: [...g.samples],
      accounts: [...g.accounts],
      transaction_ids: g.transaction_ids,
      cross_entity: crossEntity(g.vendor_key, slug),
    }))
    .sort((a, b) => b.total - a.total);

  const batches: string[] = [];
  for (let i = 0; i < vendors.length; i += BATCH) {
    const file = join(OUT, `${slug}-${i / BATCH}.json`);
    writeFileSync(file, JSON.stringify({ entity: slug, entityName: nameBySlug.get(slug), vendors: vendors.slice(i, i + BATCH) }));
    batches.push(file);
  }
  manifest.push({ entity: slug, vendors: vendors.length, batches });
  console.log(`${slug.padEnd(14)} unique unknown vendors=${String(vendors.length).padStart(4)}  batches=${batches.length}`);
}

writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1));
console.log(`\nWrote candidates + charts.json + manifest.json to ${OUT}`);
console.log(`Total unique unknown vendors: ${manifest.reduce((s, m) => s + m.vendors, 0)} across ${manifest.reduce((s, m) => s + m.batches.length, 0)} batches`);
