#!/usr/bin/env node
/**
 * Match GBSL card ledger transactions to qb_training_expenses (QBO export)
 * and apply QB categories where confidence is high enough.
 *
 * When --account is set, ALL ledger rows for that account are matched first
 * (categorized rows reserve their QBO line so duplicates aren't reused).
 * Only uncategorized ledger rows get category updates — manual work is preserved.
 *
 * Usage:
 *   node scripts/apply-qb-categories-to-ledger.mjs --dry-run
 *   node scripts/apply-qb-categories-to-ledger.mjs --apply
 *   node scripts/apply-qb-categories-to-ledger.mjs --apply --from 2026-01-01 --to 2026-07-01
 *   node scripts/apply-qb-categories-to-ledger.mjs --dry-run --account cap-one-quicksilver-claudia --qb-source "Capital One" --from 2025-07-01 --to 2026-07-01
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

function argValue(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
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

function dateAmountKey(row) {
  return `${row.transaction_date}|${Math.abs(Number(row.amount)).toFixed(2)}`;
}

function stripQboCardSuffix(text) {
  return (text ?? "").replace(/\s*-\s*\d{4}\s*$/, "").trim();
}

function addDaysIso(isoDate, days) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateAmountKeys(row, slackDays = 0) {
  const amount = Math.abs(Number(row.amount)).toFixed(2);
  const keys = [`${row.transaction_date}|${amount}`];
  if (slackDays > 0) {
    for (let delta = 1; delta <= slackDays; delta += 1) {
      keys.push(`${addDaysIso(row.transaction_date, delta)}|${amount}`);
      keys.push(`${addDaysIso(row.transaction_date, -delta)}|${amount}`);
    }
  }
  return keys;
}

function matchScore(card, qb, maxDateSlack = 0) {
  const cardAmount = Math.abs(Number(card.amount));
  const qbAmount = Math.abs(Number(qb.amount));
  if (cardAmount !== qbAmount) {
    return 0;
  }

  const cardDate = card.transaction_date;
  const qbDate = qb.transaction_date;
  let score = 10;
  if (cardDate !== qbDate) {
    const cardTime = new Date(`${cardDate}T12:00:00`).getTime();
    const qbTime = new Date(`${qbDate}T12:00:00`).getTime();
    const dayDiff = Math.round(Math.abs(cardTime - qbTime) / (1000 * 60 * 60 * 24));
    if (dayDiff > maxDateSlack) return 0;
    score = 8;
  }
  const cardText = normalizeText(`${card.vendor ?? ""} ${card.description ?? ""}`);
  const qbText = normalizeText(`${stripQboCardSuffix(qb.vendor_name ?? "")} ${stripQboCardSuffix(qb.description ?? "")}`);
  const cardWords = new Set(significantWords(cardText));

  for (const word of significantWords(qbText)) {
    if (cardWords.has(word)) score += 4;
  }

  if (cardText && qbText && (cardText.includes(qbText.slice(0, 10)) || qbText.includes(cardText.slice(0, 10)))) {
    score += 3;
  }

  return score;
}

function pickBestMatch(card, indexedCandidates, maxDateSlack = 0) {
  const scored = indexedCandidates
    .map(({ qb, index }) => ({ qb, index, score: matchScore(card, qb, maxDateSlack) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.qb.transaction_date.localeCompare(b.qb.transaction_date));

  if (scored.length === 0) return null;

  const best = scored[0];
  const tied = scored.filter((item) => item.score === best.score);
  if (tied.length > 1) return null;

  const hasExactDate = best.qb.transaction_date === card.transaction_date;
  const minScore =
    indexedCandidates.length === 1 ? (hasExactDate ? 10 : 12) : hasExactDate ? 13 : 15;
  return best.score >= minScore ? best : null;
}

const args = process.argv.slice(2);
const dryRun = !args.includes("--apply");
// Read-only audit: report already-categorized rows that a CONFIDENT QBO match
// disagrees with. Never writes, even with --apply. Use to find genuine
// manual-vs-QBO conflicts without risking correct manual work.
const reportConflicts = args.includes("--report-conflicts");
const entitySlug = argValue("--entity") ?? "gbsl";
const fromDate = argValue("--from") ?? "2026-01-01";
const toDate = argValue("--to") ?? "2026-07-01";
const accountSlug = argValue("--account");
const qbSource = argValue("--qb-source");
const dateSlackDays = Number(argValue("--date-slack") ?? (accountSlug === "cap-one-quicksilver-claudia" ? "5" : "0"));

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
  .eq("slug", entitySlug)
  .single();

if (entityError || !entity) {
  console.error(`Entity not found: ${entitySlug}`, entityError?.message);
  process.exit(1);
}

let accountId = null;
if (accountSlug) {
  const { data: account, error: accountError } = await supabase
    .from("accounts")
    .select("id, display_name")
    .eq("slug", accountSlug)
    .single();

  if (accountError || !account) {
    console.error(`Account not found: ${accountSlug}`, accountError?.message);
    process.exit(1);
  }
  accountId = account.id;
}

async function fetchAllLedgerRows() {
  const pageSize = 1000;
  const all = [];
  let from = 0;

  while (true) {
    let query = supabase
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
          category_id,
          classified_by,
          category:categories(full_path)
        )
      `,
      )
      .eq("classification.entity_id", entity.id)
      .gte("transaction_date", fromDate)
      .lt("transaction_date", toDate)
      .order("transaction_date")
      .order("id")
      .range(from, from + pageSize - 1);

    if (accountId) {
      query = query.eq("account_id", accountId);
    } else if (!reportConflicts) {
      // Conflict audit needs already-categorized rows too; the fill path only wants blanks.
      query = query.is("classification.category_id", null);
    }

    const { data, error } = await query;
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
    let query = supabase
      .from("qb_training_expenses")
      .select("transaction_date, amount, vendor_name, description, category_id, category_name, source_account")
      .eq("entity_id", entity.id)
      .gte("transaction_date", fromDate)
      .lt("transaction_date", toDate)
      .not("category_id", "is", null)
      .order("transaction_date")
      .range(from, from + pageSize - 1);

    if (qbSource) {
      query = query.eq("source_account", qbSource);
    }

    const { data, error } = await query;
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
  [cardRows, qbRows] = await Promise.all([fetchAllLedgerRows(), fetchAllQbRows()]);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const qbByDateAmount = new Map();
for (let index = 0; index < qbRows.length; index++) {
  const row = qbRows[index];
  for (const key of dateAmountKeys(row, dateSlackDays)) {
    if (!qbByDateAmount.has(key)) qbByDateAmount.set(key, []);
    qbByDateAmount.get(key).push({ qb: row, index });
  }
}

const usedQbIndices = new Set();

function consumeMatch(card) {
  const candidates = [];
  const seen = new Set();
  for (const key of dateAmountKeys(card, dateSlackDays)) {
    for (const item of qbByDateAmount.get(key) ?? []) {
      if (usedQbIndices.has(item.index) || seen.has(item.index)) continue;
      seen.add(item.index);
      candidates.push(item);
    }
  }

  const best = pickBestMatch(card, candidates, dateSlackDays);
  if (best) usedQbIndices.add(best.index);
  return best;
}

const categorizedRows = cardRows.filter((row) => row.classification.category_id != null);
const uncategorizedRows = cardRows.filter((row) => row.classification.category_id == null);

if (reportConflicts) {
  // Non-consuming match: find the single best confident QBO line per row, ignoring
  // reservation, so a real disagreement is never hidden by another row's claim.
  function findBestMatchNoConsume(card) {
    const candidates = [];
    const seen = new Set();
    for (const key of dateAmountKeys(card, dateSlackDays)) {
      for (const item of qbByDateAmount.get(key) ?? []) {
        if (seen.has(item.index)) continue;
        seen.add(item.index);
        candidates.push(item);
      }
    }
    return pickBestMatch(card, candidates, dateSlackDays);
  }

  // A match scores 10 for exact date+amount alone; each shared vendor word adds 4.
  // Require >= 14 so a coincidental same-day/same-amount collision (zero word overlap)
  // is not reported as a real conflict.
  const WORD_MATCH_THRESHOLD = 14;
  const conflicts = [];
  // How many auto-filled (qb_backfill) rows rest only on a date+amount coincidence
  // with no vendor-word agreement — i.e., possibly the wrong QBO category.
  let qbBackfillWeak = 0;
  const weakFills = [];
  for (const card of categorizedRows) {
    const best = findBestMatchNoConsume(card);
    if (!best?.qb.category_id) continue;
    if (best.score < WORD_MATCH_THRESHOLD) {
      if (card.classification.classified_by === "qb_backfill") {
        qbBackfillWeak += 1;
        weakFills.push({
          date: card.transaction_date,
          amount: card.amount,
          description: (card.description ?? "").slice(0, 50),
          applied: card.classification.category?.full_path ?? "(unknown)",
        });
      }
      continue;
    }
    if (best.qb.category_id === card.classification.category_id) continue;
    conflicts.push({
      date: card.transaction_date,
      amount: card.amount,
      description: (card.description ?? "").slice(0, 50),
      classifiedBy: card.classification.classified_by,
      current: card.classification.category?.full_path ?? "(unknown)",
      qbo: best.qb.category_name,
      qboSource: best.qb.source_account,
    });
  }

  console.log(`QBO conflict audit for '${entitySlug}' (${fromDate} → ${toDate}) — READ ONLY`);
  console.log(`  Date slack: ±${dateSlackDays} days`);
  console.log(`  Already-categorized rows scanned: ${categorizedRows.length}`);
  console.log(`  Weak auto-fills (qb_backfill on date+amount only, no vendor word): ${qbBackfillWeak}`);
  console.log(`  Confident QBO disagreements: ${conflicts.length}`);
  if (weakFills.length > 0) {
    console.log("\n  Weak auto-fills to review (category rests on date+amount only):");
    for (const w of weakFills) {
      console.log(`  ${w.date}  ${String(w.amount).padStart(10)}  ${w.description}  →  ${w.applied}`);
    }
  }
  if (conflicts.length > 0) {
    console.log("");
    for (const c of conflicts) {
      console.log(`  ${c.date}  ${String(c.amount).padStart(10)}  ${c.description}`);
      console.log(`      you: ${c.current}  [${c.classifiedBy}]`);
      console.log(`      QBO: ${c.qbo}  (${c.qboSource})`);
    }
  }
  console.log("\n  No changes written (audit mode).");
  process.exit(0);
}

const results = {
  ledgerTotal: cardRows.length,
  alreadyCategorized: categorizedRows.length,
  uncategorized: uncategorizedRows.length,
  reservedQbo: 0,
  matchedToApply: 0,
  lowConfidence: 0,
  skipped: 0,
  cpaReview: 0,
  byCategory: new Map(),
};
const updates = [];

for (const card of categorizedRows) {
  if (consumeMatch(card)) results.reservedQbo += 1;
}

for (const card of uncategorizedRows) {
  const best = consumeMatch(card);
  if (!best?.qb.category_id) {
    results.skipped += 1;
    continue;
  }

  results.matchedToApply += 1;
  // score 10 == exact date+amount but no shared vendor word (coincidental collision risk)
  if (best.score < 14) results.lowConfidence += 1;
  if (best.qb.category_name === "Ask My Accountant") results.cpaReview += 1;
  results.byCategory.set(best.qb.category_name, (results.byCategory.get(best.qb.category_name) ?? 0) + 1);

  updates.push({
    classificationId: card.classification.id,
    categoryId: best.qb.category_id,
    categoryName: best.qb.category_name,
    description: card.description,
    date: card.transaction_date,
    amount: card.amount,
  });
}

const scopeLabel = accountSlug
  ? `${accountSlug}${qbSource ? ` ↔ QBO ${qbSource}` : ""}`
  : `all ${entitySlug} uncategorized cards`;

console.log(`${entitySlug} QB category backfill (${fromDate} → ${toDate})`);
console.log(`  Scope: ${scopeLabel}`);
console.log(`  Date slack: ±${dateSlackDays} days`);
console.log(`  Mode: ${dryRun ? "DRY RUN" : "APPLY"}`);
console.log(`  Ledger rows (all): ${results.ledgerTotal}`);
console.log(`  Already categorized (manual/QB): ${results.alreadyCategorized}`);
console.log(`  QBO lines reserved by categorized matches: ${results.reservedQbo}`);
console.log(`  Still uncategorized: ${results.uncategorized}`);
console.log(`  QB training rows: ${qbRows.length}`);
console.log(`  Matched to apply: ${results.matchedToApply}`);
console.log(`    ...of which low-confidence (date+amount only, no vendor-word overlap): ${results.lowConfidence}`);
console.log(`  Skipped (no confident match): ${results.skipped}`);
console.log(`  Includes Ask My Accountant (CPA review): ${results.cpaReview}`);
console.log("\n  By category (new applies only):");
for (const [name, count] of [...results.byCategory.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${name}: ${count}`);
}

if (!dryRun && updates.length > 0) {
  let applied = 0;
  for (const item of updates) {
    const { error } = await supabase
      .from("classifications")
      .update({
        category_id: item.categoryId,
        classified_by: "qb_backfill",
        classified_at: new Date().toISOString(),
        notes: accountSlug
          ? `Auto-matched from QBO export (${accountSlug})`
          : "Auto-matched from QBO export",
      })
      .eq("id", item.classificationId)
      .is("category_id", null);

    if (error) {
      console.error("Update failed:", item.description, error.message);
    } else {
      applied += 1;
    }
  }
  console.log(`\nApplied ${applied} category updates (${updates.length - applied} skipped — already categorized).`);
} else if (dryRun && updates.length > 0) {
  console.log("\n  Sample matches:");
  for (const item of updates.slice(0, 12)) {
    console.log(`    ${item.date} ${item.amount} → ${item.categoryName} · ${item.description.slice(0, 50)}`);
  }
  console.log("\n  Re-run with --apply to write updates.");
}
