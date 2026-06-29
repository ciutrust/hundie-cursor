// Stage 2 — apply the medium-review workflow decisions by UPDATING the existing Tier-1 medium
// proposals (set new category/confidence/rationale, reassignment, and flip source->claude when the
// category or entity actually changed). Dry-run by default.
//
//   node --experimental-strip-types scripts/stage2/write-medium-review.ts            # dry-run
//   node --experimental-strip-types scripts/stage2/write-medium-review.ts --apply

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TASKS = "/private/tmp/claude-501/-Users-ac-hundie-cursor/871240a2-9807-4be9-84ed-fe087b3806d5/tasks";
const apply = process.argv.includes("--apply");
const rIdx = process.argv.indexOf("--result");
const resultPath = rIdx !== -1 ? process.argv[rIdx + 1] : join(TASKS, "w6cma9yjb.output");

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

type Decision = { vendor_key: string; category_path: string | null; reassign_to_entity: string | null; confidence: string; rationale: string };
type BatchResult = { entity: string; file: string; decisions: Decision[] };

const outer = JSON.parse(readFileSync(resultPath, "utf8"));
let result = outer.result ?? outer;
if (typeof result === "string") result = JSON.parse(result);
const batches: BatchResult[] = result.results ?? [];

const { data: cats } = await supabase.from("categories").select("id, entity_id, full_path, is_active");
const { data: ents } = await supabase.from("entities").select("id, slug");
const idBySlug = new Map((ents ?? []).map((e) => [e.slug, e.id]));
const catId = new Map<string, string>();
for (const c of cats ?? []) if (c.is_active) catId.set(`${c.entity_id}|${c.full_path}`, c.id);

let upgraded = 0, recategorized = 0, reassigned = 0, keptMedium = 0, low = 0, skippedNull = 0, badCat = 0;
const updates: { entity: string; vk: string; patch: Record<string, unknown> }[] = [];

for (const b of batches) {
  const originalEntityId = idBySlug.get(b.entity);
  if (!originalEntityId) continue;
  const cand = JSON.parse(readFileSync(b.file, "utf8"));
  const currentByVk = new Map<string, string | null>(cand.vendors.map((v: { vendor_key: string; current_proposed: string | null }) => [v.vendor_key, v.current_proposed]));

  for (const d of b.decisions) {
    if (!d.category_path) { skippedNull += 1; continue; }
    const finalSlug = d.reassign_to_entity || b.entity;
    const finalEntityId = idBySlug.get(finalSlug);
    if (!finalEntityId) { badCat += 1; continue; }
    const cid = catId.get(`${finalEntityId}|${d.category_path}`);
    if (!cid) { badCat += 1; continue; }

    const isReassign = finalSlug !== b.entity;
    const current = currentByVk.get(d.vendor_key) ?? null;
    const changed = isReassign || d.category_path !== current;

    if (isReassign) reassigned += 1;
    else if (d.category_path !== current) recategorized += 1;
    if (d.confidence === "high") upgraded += 1;
    else if (d.confidence === "medium") keptMedium += 1;
    else low += 1;

    updates.push({
      entity: b.entity, vk: d.vendor_key,
      patch: {
        proposed_category_id: cid,
        proposed_category_path: d.category_path,
        chosen_entity_id: isReassign ? finalEntityId : null,
        chosen_category_id: isReassign ? cid : null,
        confidence: d.confidence,
        rationale: d.rationale,
        source: changed ? "claude" : "training",
        updated_at: new Date().toISOString(),
      },
    });
  }
}

console.log(`Medium review writer — mode: ${apply ? "APPLY" : "DRY RUN"}`);
console.log(`  decisions: ${updates.length} to update`);
console.log(`  → upgraded to HIGH: ${upgraded} | kept medium: ${keptMedium} | downgraded low: ${low}`);
console.log(`  → recategorized: ${recategorized} | reassigned to another entity: ${reassigned}`);
console.log(`  skipped: ${skippedNull} (null), ${badCat} (category not in chart)`);

if (apply) {
  for (const u of updates) {
    const { error } = await supabase
      .from("classification_proposals")
      .update(u.patch)
      .eq("entity_slug", u.entity)
      .eq("vendor_key", u.vk)
      .eq("source", "training"); // the un-reviewed Tier-1 mediums for this vendor
    if (error) throw new Error(`update ${u.entity}/${u.vk}: ${error.message}`);
  }
  console.log(`\n✅ Updated ${updates.length} vendor groups (medium → reviewed).`);
} else {
  console.log(`\n(DRY RUN — wrote nothing. Re-run with --apply.)`);
}
