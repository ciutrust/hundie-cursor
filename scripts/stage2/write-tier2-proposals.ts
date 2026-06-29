// Stage 2 — write Tier-2 (Claude) decisions into classification_proposals.
//
// Input: the tier2-classify workflow result (--result <path>, default tasks/<id>.output) + the
// candidate batch files it references (for transaction_ids per vendor_key). For each decision it
// validates category_path against the FINAL entity's chart, sets chosen_entity_id for reassignments,
// and writes one proposal per transaction (source='claude', status='pending').
//
//   node --experimental-strip-types scripts/stage2/write-tier2-proposals.ts            # dry-run
//   node --experimental-strip-types scripts/stage2/write-tier2-proposals.ts --apply

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TASKS = "/private/tmp/claude-501/-Users-ac-hundie-cursor/871240a2-9807-4be9-84ed-fe087b3806d5/tasks";

const apply = process.argv.includes("--apply");
const rIdx = process.argv.indexOf("--result");
const resultPath = rIdx !== -1 ? process.argv[rIdx + 1] : join(TASKS, "wq54qyzt8.output");

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

type Decision = { vendor_key: string; category_path: string | null; reassign_to_entity: string | null; confidence: string; rationale: string };
type BatchResult = { entity: string; file: string; decisions: Decision[] };

// Parse the workflow task-output wrapper to get { results: BatchResult[] }
const outer = JSON.parse(readFileSync(resultPath, "utf8"));
let result = outer.result ?? outer;
if (typeof result === "string") result = JSON.parse(result);
const batches: BatchResult[] = result.results ?? [];
if (batches.length === 0) {
  console.error("No batch results found in", resultPath);
  process.exit(1);
}

// chart map: `${entityId}|${full_path}` -> category_id (active only); entity slug -> id
const { data: cats } = await supabase.from("categories").select("id, entity_id, full_path, is_active");
const { data: ents } = await supabase.from("entities").select("id, slug");
const idBySlug = new Map((ents ?? []).map((e) => [e.slug, e.id]));
const catId = new Map<string, string>();
for (const c of cats ?? []) if (c.is_active) catId.set(`${c.entity_id}|${c.full_path}`, c.id);

const rows: Record<string, unknown>[] = [];
let nullWritten = 0, skippedBadCat = 0, reassigned = 0;
const badCatSamples: string[] = [];
const byConfidence: Record<string, number> = { high: 0, medium: 0, low: 0 };

for (const b of batches) {
  const originalEntityId = idBySlug.get(b.entity);
  if (!originalEntityId) continue;
  const cand = JSON.parse(readFileSync(b.file, "utf8"));
  const txByVendor = new Map<string, string[]>(cand.vendors.map((v: { vendor_key: string; transaction_ids: string[] }) => [v.vendor_key, v.transaction_ids]));

  for (const d of b.decisions) {
    const txids0 = txByVendor.get(d.vendor_key) ?? [];
    // HARD cases: Claude couldn't confidently categorize → write with NO category + the reasoning,
    // so they're visible and filterable (proposed_category_id IS NULL) for manual handling.
    if (!d.category_path) {
      for (const txid of txids0) {
        rows.push({
          transaction_id: txid, entity_id: originalEntityId, entity_slug: b.entity, vendor_key: d.vendor_key,
          proposed_category_id: null, proposed_category_path: null, chosen_entity_id: null, chosen_category_id: null,
          confidence: "low", source: "claude", rationale: d.rationale, status: "pending",
        });
      }
      nullWritten += txids0.length;
      continue;
    }
    const finalSlug = d.reassign_to_entity || b.entity;
    const finalEntityId = idBySlug.get(finalSlug);
    if (!finalEntityId) { skippedBadCat += 1; continue; }
    const cid = catId.get(`${finalEntityId}|${d.category_path}`);
    if (!cid) {
      skippedBadCat += 1;
      if (badCatSamples.length < 12) badCatSamples.push(`${finalSlug} | ${d.category_path} (vendor ${d.vendor_key})`);
      continue;
    }
    const txids = txByVendor.get(d.vendor_key) ?? [];
    if (txids.length === 0) continue;
    const isReassign = finalSlug !== b.entity;
    if (isReassign) reassigned += txids.length;
    byConfidence[d.confidence] = (byConfidence[d.confidence] ?? 0) + txids.length;
    for (const txid of txids) {
      rows.push({
        transaction_id: txid,
        entity_id: originalEntityId,
        entity_slug: b.entity,
        vendor_key: d.vendor_key,
        proposed_category_id: cid,
        proposed_category_path: d.category_path,
        chosen_entity_id: isReassign ? finalEntityId : null,
        chosen_category_id: isReassign ? cid : null,
        confidence: d.confidence,
        source: "claude",
        rationale: d.rationale,
        status: "pending",
      });
    }
  }
}

console.log(`Tier-2 writer — mode: ${apply ? "APPLY" : "DRY RUN"}`);
console.log(`  proposals to write: ${rows.length}  (reassignments: ${reassigned}, no-category HARD cases: ${nullWritten})`);
console.log(`  by confidence: high ${byConfidence.high}, medium ${byConfidence.medium}, low ${byConfidence.low}`);
console.log(`  skipped: ${skippedBadCat} (category not in chart)`);
if (badCatSamples.length) console.log(`  bad-category samples:\n    ${badCatSamples.join("\n    ")}`);

if (apply && rows.length > 0) {
  let written = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase
      .from("classification_proposals")
      .upsert(rows.slice(i, i + 200), { onConflict: "transaction_id" });
    if (error) throw new Error(`upsert failed: ${error.message}`);
    written += Math.min(200, rows.length - i);
  }
  console.log(`\n✅ Wrote ${written} Tier-2 proposals.`);
} else if (!apply) {
  console.log(`\n(DRY RUN — wrote nothing. Re-run with --apply.)`);
}
