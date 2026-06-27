#!/usr/bin/env node
/**
 * Classify uncategorized negative-amount transactions as Refund / credit (C2 backfill).
 *
 * Usage:
 *   node scripts/classify-refund-imports.mjs --dry-run
 *   node scripts/classify-refund-imports.mjs --apply
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", ".env.local");

function loadEnv() {
  if (!existsSync(envPath)) {
    console.error("Missing .env.local");
    process.exit(1);
  }
  const env = {};
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return env;
}

const apply = process.argv.includes("--apply");
const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(url, serviceKey);

const { data: refundCategories, error: catError } = await supabase
  .from("categories")
  .select("id, entity_id, full_path, entity:entities(slug)")
  .eq("full_path", "Refund / credit");

if (catError) throw catError;

const refundCategoryByEntity = new Map(
  (refundCategories ?? []).map((row) => [row.entity_id, row]),
);

async function ensureRefundCategory(entityId) {
  const existing = refundCategoryByEntity.get(entityId);
  if (existing) return existing;

  const { data, error } = await supabase
    .from("categories")
    .insert({
      entity_id: entityId,
      name: "Refund / credit",
      full_path: "Refund / credit",
      is_active: true,
    })
    .select("id, entity_id, full_path, entity:entities(slug)")
    .single();

  if (error) {
    const { data: refetched, error: refetchError } = await supabase
      .from("categories")
      .select("id, entity_id, full_path, entity:entities(slug)")
      .eq("entity_id", entityId)
      .eq("full_path", "Refund / credit")
      .single();
    if (refetchError) throw refetchError;
    refundCategoryByEntity.set(entityId, refetched);
    return refetched;
  }

  refundCategoryByEntity.set(entityId, data);
  return data;
}

const pageSize = 1000;
const targets = [];
let from = 0;

while (true) {
  const { data, error } = await supabase
    .from("transactions")
    .select(
      `
      id,
      amount,
      description,
      transaction_date,
      classification:classifications!inner(
        id,
        entity_id,
        category_id
      )
    `,
    )
    .lt("amount", 0)
    .is("classification.category_id", null)
    .order("transaction_date")
    .range(from, from + pageSize - 1);

  if (error) throw error;
  if (!data?.length) break;

  for (const row of data) {
    const classification = row.classification;
    const entityId = classification.entity_id;
    const refundCat = await ensureRefundCategory(entityId);
    targets.push({
      classificationId: classification.id,
      categoryId: refundCat.id,
      entitySlug: refundCat.entity?.slug ?? entityId,
      amount: row.amount,
      date: row.transaction_date,
      description: row.description,
    });
  }

  if (data.length < pageSize) break;
  from += pageSize;
}

console.log(`Refund auto-classify (${apply ? "APPLY" : "DRY RUN"})`);
console.log(`  Uncategorized negative rows: ${targets.length}`);

const byEntity = new Map();
for (const row of targets) {
  byEntity.set(row.entitySlug, (byEntity.get(row.entitySlug) ?? 0) + 1);
}
for (const [slug, count] of [...byEntity.entries()].sort()) {
  console.log(`  ${slug}: ${count}`);
}

if (targets.length > 0) {
  console.log("\n  Sample:");
  for (const row of targets.slice(0, 8)) {
    console.log(`    ${row.date} ${row.amount} · ${row.description.slice(0, 50)} (${row.entitySlug})`);
  }
}

if (!apply) {
  console.log("\nRe-run with --apply to write classifications.");
  process.exit(0);
}

let updated = 0;
for (const row of targets) {
  const { error } = await supabase
    .from("classifications")
    .update({
      category_id: row.categoryId,
      classified_by: "refund_backfill",
      classified_at: new Date().toISOString(),
      notes: "C2 refund import auto-classified",
    })
    .eq("id", row.classificationId)
    .is("category_id", null);

  if (error) {
    console.error("Update failed:", row.description, error.message);
  } else {
    updated += 1;
  }
}

console.log(`\nClassified ${updated} refund rows as Refund / credit.`);
