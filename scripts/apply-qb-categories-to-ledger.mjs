#!/usr/bin/env node
/**
 * Match GBSL card ledger transactions to qb_training_expenses (2026 QBO export)
 * and apply QB categories where confidence is high enough.
 *
 * Usage:
 *   node scripts/apply-qb-categories-to-ledger.mjs --dry-run
 *   node scripts/apply-qb-categories-to-ledger.mjs --apply
 *   node scripts/apply-qb-categories-to-ledger.mjs --apply --from 2026-01-01 --to 2026-07-01
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const envPath = resolve(root, ".env.local");

function loadEnv() {
  if (!existsSync(envPath)) return {};
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

function normalizeText(text) {
  return (text ?? "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function significantWords(text) {
  const stop = new Set(["payment", "purchase", "online", "card", "thank", "you", "the", "inc", "llc"]);
  return normalizeText(text)
    .split(" ")
    .filter((word) => word.length >= 3 && !stop.has(word));
}

function matchScore(card, qb) {
  const cardAmount = Math.abs(Number(card.amount));
  const qbAmount = Math.abs(Number(qb.amount));
  if (card.transaction_date !== qb.transaction_date || cardAmount !== qbAmount) {
    return 0;
  }

  let score = 10;
  const cardText = normalizeText(`${card.vendor ?? ""} ${card.description ?? ""}`);
  const qbText = normalizeText(`${qb.vendor_name ?? ""} ${qb.description ?? ""}`);
  const cardWords = new Set(significantWords(cardText));

  for (const word of significantWords(qbText)) {
    if (cardWords.has(word)) score += 4;
  }

  if (cardText && qbText && (cardText.includes(qbText.slice(0, 10)) || qbText.includes(cardText.slice(0, 10)))) {
    score += 3;
  }

  return score;
}

function pickBestMatch(card, candidates) {
  const scored = candidates
    .map((qb) => ({ qb, score: matchScore(card, qb) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;

  const best = scored[0];
  const tied = scored.filter((item) => item.score === best.score);
  if (tied.length > 1) return null;

  const minScore = candidates.length === 1 ? 10 : 13;
  return best.score >= minScore ? best.qb : null;
}

const args = process.argv.slice(2);
const dryRun = !args.includes("--apply");
const fromDate = args.includes("--from") ? args[args.indexOf("--from") + 1] : "2026-01-01";
const toDate = args.includes("--to") ? args[args.indexOf("--to") + 1] : "2026-07-01";

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(url, serviceKey);

const { data: entity, error: entityError } = await supabase
  .from("entities")
  .select("id")
  .eq("slug", "gbsl")
  .single();

if (entityError || !entity) {
  console.error("GBSL entity not found", entityError?.message);
  process.exit(1);
}

async function fetchAllUncategorizedCardRows() {
  const pageSize = 1000;
  const all = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("transactions")
      .select(
        `
        id,
        transaction_date,
        amount,
        description,
        vendor,
        classification:classifications!inner(
          id,
          category_id
        )
      `,
      )
      .eq("classification.entity_id", entity.id)
      .is("classification.category_id", null)
      .gte("transaction_date", fromDate)
      .lt("transaction_date", toDate)
      .order("transaction_date")
      .order("id")
      .range(from, from + pageSize - 1);

    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

async function fetchAllQbRows() {
  const pageSize = 1000;
  const all = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("qb_training_expenses")
      .select("transaction_date, amount, vendor_name, description, category_id, category_name")
      .eq("entity_id", entity.id)
      .gte("transaction_date", fromDate)
      .lt("transaction_date", toDate)
      .not("category_id", "is", null)
      .order("transaction_date")
      .range(from, from + pageSize - 1);

    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

let cardRows;
let qbRows;
try {
  [cardRows, qbRows] = await Promise.all([fetchAllUncategorizedCardRows(), fetchAllQbRows()]);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const qbByDateAmount = new Map();
for (const row of qbRows) {
  const key = `${row.transaction_date}|${Math.abs(Number(row.amount)).toFixed(2)}`;
  if (!qbByDateAmount.has(key)) qbByDateAmount.set(key, []);
  qbByDateAmount.get(key).push(row);
}

const results = { matched: 0, skipped: 0, cpaReview: 0, byCategory: new Map() };
const updates = [];

for (const card of cardRows) {
  const key = `${card.transaction_date}|${Math.abs(Number(card.amount)).toFixed(2)}`;
  const candidates = qbByDateAmount.get(key) ?? [];
  const qb = pickBestMatch(card, candidates);
  if (!qb?.category_id) {
    results.skipped += 1;
    continue;
  }

  results.matched += 1;
  if (qb.category_name === "Ask My Accountant") results.cpaReview += 1;
  results.byCategory.set(qb.category_name, (results.byCategory.get(qb.category_name) ?? 0) + 1);

  updates.push({
    classificationId: card.classification.id,
    categoryId: qb.category_id,
    categoryName: qb.category_name,
    description: card.description,
    date: card.transaction_date,
    amount: card.amount,
  });
}

console.log(`GBSL QB category backfill (${fromDate} → ${toDate})`);
console.log(`  Mode: ${dryRun ? "DRY RUN" : "APPLY"}`);
console.log(`  Uncategorized card txs: ${cardRows.length}`);
console.log(`  QB training rows: ${qbRows.length}`);
console.log(`  Matched to apply: ${results.matched}`);
console.log(`  Skipped (no confident match): ${results.skipped}`);
console.log(`  Includes Ask My Accountant (CPA review): ${results.cpaReview}`);
console.log("\n  By category:");
for (const [name, count] of [...results.byCategory.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${name}: ${count}`);
}

if (!dryRun && updates.length > 0) {
  for (const item of updates) {
    const { error } = await supabase
      .from("classifications")
      .update({
        category_id: item.categoryId,
        classified_by: "qb_backfill",
        classified_at: new Date().toISOString(),
        notes: "Auto-matched from QBO export",
      })
      .eq("id", item.classificationId);

    if (error) {
      console.error("Update failed:", item.description, error.message);
    }
  }
  console.log(`\nApplied ${updates.length} category updates.`);
} else if (dryRun && updates.length > 0) {
  console.log("\n  Sample matches:");
  for (const item of updates.slice(0, 8)) {
    console.log(`    ${item.date} ${item.amount} → ${item.categoryName} · ${item.description.slice(0, 50)}`);
  }
  console.log("\n  Re-run with --apply to write updates.");
}
