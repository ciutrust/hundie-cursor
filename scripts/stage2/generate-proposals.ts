// Stage 2 — Tier-1 deterministic proposal generator.
//
// For each classifiable entity, learn vendor→category from that entity's qb_training_expenses
// (your snapshot + QBO), then propose a category for every UNCLASSIFIED transaction whose vendor
// matches with enough agreement. High/medium confidence only; ambiguous/unknown vendors are left
// for Tier-2 (Claude's in-session analysis). Writes rows into classification_proposals (source=training).
//
// Reuses the app's exact vendor-key logic (extractVendorSearchKey) so matches line up with the UI.
// Run (subscription-covered, no API):
//   node --experimental-strip-types scripts/stage2/generate-proposals.ts            # dry-run
//   node --experimental-strip-types scripts/stage2/generate-proposals.ts --apply
//   node --experimental-strip-types scripts/stage2/generate-proposals.ts --apply --entity personal
//
// READ-ONLY unless --apply.

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractVendorSearchKey } from "../../lib/suggestions/category-suggestions.ts";
import { dominantCategory, trainingRationale } from "../lib/proposal-ranking.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
function loadEnv() {
  const env: Record<string, string> = {};
  for (const line of readFileSync(join(root, ".env.local"), "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    env[t.slice(0, eq)] = t.slice(eq + 1);
  }
  return env;
}

const ENTITIES = ["gbsl", "keller", "personal", "acaa-austin", "pflugerville"];
const PAGE = 1000;

const apply = process.argv.includes("--apply");
const entIdx = process.argv.indexOf("--entity");
const onlyEntity = entIdx !== -1 ? process.argv[entIdx + 1] : null;

const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Offset pagination is only stable when the query orders by a UNIQUE column. Both call sites below
// add `.order("id" | "transaction_id")` for that; `key` here enforces it at runtime — it throws the
// moment a row is delivered on two pages (the signature of a missing/non-unique tiebreaker), rather
// than silently skipping/duplicating rows past 1000 (BUG-05 / C10).
async function fetchAllPaged<T>(
  builder: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>,
  key?: (row: T) => string,
): Promise<T[]> {
  const out: T[] = [];
  const seen = key ? new Set<string>() : null;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await builder(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    if (seen) {
      for (const row of page) {
        const k = key!(row);
        if (seen.has(k)) {
          throw new Error(
            `fetchAllPaged: row key ${JSON.stringify(k)} returned on two pages — the query needs a ` +
              `unique .order() tiebreaker (e.g. .order("id")) for stable offset pagination.`,
          );
        }
        seen.add(k);
      }
    }
    out.push(...page);
    if (!data || data.length < PAGE) break;
  }
  return out;
}

// active category map: id -> full_path  (inactive excluded so we never propose a hidden category)
const { data: cats, error: catErr } = await supabase
  .from("categories")
  .select("id, full_path, is_active");
if (catErr) throw new Error(catErr.message);
const activePathById = new Map<string, string>();
for (const c of cats ?? []) if (c.is_active) activePathById.set(c.id, c.full_path);

const { data: ents, error: entErr } = await supabase.from("entities").select("id, slug");
if (entErr) throw new Error(entErr.message);
const entityIdBySlug = new Map<string, string>((ents ?? []).map((e) => [e.slug, e.id]));

console.log(`Tier-1 proposal generator — mode: ${apply ? "APPLY" : "DRY RUN"}${onlyEntity ? ` — entity: ${onlyEntity}` : ""}\n`);

const allProposals: Record<string, unknown>[] = [];
let grandUnclassified = 0,
  grandMatched = 0,
  grandUnmatched = 0;

for (const slug of ENTITIES) {
  if (onlyEntity && slug !== onlyEntity) continue;
  const entityId = entityIdBySlug.get(slug);
  if (!entityId) {
    console.log(`  ${slug}: entity not found, skipping`);
    continue;
  }

  // 1) training tally: vendorKey -> (categoryId -> count), active categories only
  const training = await fetchAllPaged<{ id: string; category_id: string | null; vendor_name: string | null; description: string | null }>(
    (from, to) =>
      supabase
        .from("qb_training_expenses")
        .select("id, category_id, vendor_name, description")
        .eq("entity_id", entityId)
        .not("category_id", "is", null)
        .order("id", { ascending: true })
        .range(from, to),
    (r) => r.id,
  );
  const tally = new Map<string, Map<string, number>>();
  for (const t of training) {
    if (!t.category_id || !activePathById.has(t.category_id)) continue;
    const vk = extractVendorSearchKey(t.description ?? "", t.vendor_name);
    if (!vk) continue;
    const m = tally.get(vk) ?? new Map<string, number>();
    m.set(t.category_id, (m.get(t.category_id) ?? 0) + 1);
    tally.set(vk, m);
  }

  // 2) unclassified transactions for this entity
  const unclassified = await fetchAllPaged<{ transaction_id: string; transactions: { description: string; vendor: string | null } }>(
    (from, to) =>
      supabase
        .from("classifications")
        .select("transaction_id, transactions!inner(description, vendor)")
        .eq("entity_id", entityId)
        .is("category_id", null)
        .order("transaction_id", { ascending: true })
        .range(from, to) as never,
    (r) => r.transaction_id,
  );

  let matchedHigh = 0,
    matchedMed = 0,
    unmatched = 0;
  for (const row of unclassified) {
    const vk = extractVendorSearchKey(row.transactions.description ?? "", row.transactions.vendor);
    const counts = [...(tally.get(vk)?.entries() ?? [])].map(([categoryId, count]) => ({
      categoryId,
      categoryPath: activePathById.get(categoryId) ?? "",
      count,
    }));
    const result = dominantCategory(counts);
    if (!result) {
      unmatched++;
      continue;
    }
    if (result.confidence === "high") matchedHigh++;
    else matchedMed++;
    allProposals.push({
      transaction_id: row.transaction_id,
      entity_id: entityId,
      entity_slug: slug,
      vendor_key: vk,
      proposed_category_id: result.categoryId,
      proposed_category_path: result.categoryPath,
      confidence: result.confidence,
      source: "training",
      rationale: trainingRationale(result, vk),
      status: "pending",
    });
  }

  grandUnclassified += unclassified.length;
  grandMatched += matchedHigh + matchedMed;
  grandUnmatched += unmatched;
  console.log(
    `  ${slug.padEnd(14)} unclassified=${String(unclassified.length).padStart(5)}  proposed=${String(matchedHigh + matchedMed).padStart(5)} (high ${matchedHigh}, med ${matchedMed})  →Tier2=${unmatched}`,
  );
}

console.log(
  `\nTOTAL unclassified=${grandUnclassified}  Tier-1 proposed=${grandMatched}  remaining for Tier-2 (Claude)=${grandUnmatched}`,
);

if (apply && allProposals.length > 0) {
  let written = 0;
  for (let i = 0; i < allProposals.length; i += 200) {
    const chunk = allProposals.slice(i, i + 200);
    const { error } = await supabase
      .from("classification_proposals")
      .upsert(chunk, { onConflict: "transaction_id" });
    if (error) throw new Error(`upsert failed: ${error.message}`);
    written += chunk.length;
  }
  console.log(`\n✅ Wrote ${written} Tier-1 proposals to classification_proposals.`);
} else if (!apply) {
  console.log(`\n(DRY RUN — wrote nothing. Re-run with --apply to write ${allProposals.length} proposals.)`);
}
