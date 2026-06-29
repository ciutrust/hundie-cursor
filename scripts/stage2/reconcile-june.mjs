// Stage 2 Phase 5.5: reconcile Plaid's June pull against the CSV June ground-truth.
// Read-only. Matches on a business key (account|date|amount) as a MULTISET (legit same-key repeats
// are counted, not collapsed). CSV ground truth ends ~June 24; Plaid runs to today, so rows after
// the CSV's max date are reported separately (expected Plaid-only), not as discrepancies.

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
function loadEnv() {
  const env = {};
  for (const line of readFileSync(join(root, ".env.local"), "utf8").split("\n")) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("="); if (eq === -1) continue;
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[t.slice(0, eq)] = v;
  }
  return env;
}

const gtPath = process.argv[2] || "/Users/ac/hundie-backups/stage2-2026-06-29_05-12-13/june-ground-truth.json";
if (!existsSync(gtPath)) { console.error("ground-truth file not found:", gtPath); process.exit(2); }
const gt = JSON.parse(readFileSync(gtPath, "utf8"));

const env = loadEnv();
const s = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Pull all June rows from the ledger (Plaid just imported them).
const dbRows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await s
    .from("transactions")
    .select("transaction_date, amount, description, accounts!inner(slug)")
    .gte("transaction_date", "2026-06-01")
    .order("transaction_date")
    .range(from, from + 999);
  if (error) { console.error(error.message); process.exit(1); }
  dbRows.push(...data);
  if (data.length < 1000) break;
}

const amt = (a) => Number(a).toFixed(2);
const key = (slug, date, amount) => `${slug}|${date}|${amt(amount)}`;

const csvMaxDate = gt.reduce((m, r) => (r.transaction_date > m ? r.transaction_date : m), "0000");
console.log(`CSV ground truth: ${gt.length} rows (max date ${csvMaxDate})`);
console.log(`Plaid/ledger June: ${dbRows.length} rows (max date ${dbRows.reduce((m, r) => (r.transaction_date > m ? r.transaction_date : m), "0000")})`);

// Split DB June into the overlap window (<= CSV max date) and the tail (after — expected Plaid-only).
const dbOverlap = dbRows.filter((r) => r.transaction_date <= csvMaxDate);
const dbTail = dbRows.filter((r) => r.transaction_date > csvMaxDate);
console.log(`  Plaid in overlap window (≤ ${csvMaxDate}): ${dbOverlap.length} | tail (> ${csvMaxDate}, expected Plaid-only): ${dbTail.length}\n`);

function multiset(rows, slugOf) {
  const m = new Map();
  for (const r of rows) {
    const k = key(slugOf(r), r.transaction_date, r.amount);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}
const csvMs = multiset(gt, (r) => r.account_slug);
const dbMs = multiset(dbOverlap, (r) => r.accounts.slug);

let matched = 0, csvOnly = 0, plaidOnly = 0;
const csvOnlyEx = [], plaidOnlyEx = [];
const allKeys = new Set([...csvMs.keys(), ...dbMs.keys()]);
for (const k of allKeys) {
  const c = csvMs.get(k) ?? 0, d = dbMs.get(k) ?? 0;
  matched += Math.min(c, d);
  if (c > d) { csvOnly += c - d; if (csvOnlyEx.length < 12) csvOnlyEx.push(`${k} ×${c - d}`); }
  if (d > c) { plaidOnly += d - c; if (plaidOnlyEx.length < 12) plaidOnlyEx.push(`${k} ×${d - c}`); }
}

console.log(`OVERLAP WINDOW reconciliation (account|date|amount multiset):`);
console.log(`  ✓ matched:        ${matched}`);
console.log(`  ⚠ CSV-only (in ground truth, missing from Plaid): ${csvOnly}`);
console.log(`  ⚠ Plaid-only (in Plaid, not in CSV): ${plaidOnly}`);
if (csvOnlyEx.length) console.log(`\n  CSV-only examples:\n    ${csvOnlyEx.join("\n    ")}`);
if (plaidOnlyEx.length) console.log(`\n  Plaid-only-in-overlap examples:\n    ${plaidOnlyEx.join("\n    ")}`);
console.log(`\n  Tail (Plaid June after ${csvMaxDate}) = ${dbTail.length} rows — expected (CSV didn't extend this far).`);

// ---- Diagnosis 1: relaxed match ignoring DATE (account|amount), overlap window ----
function ms(rows, slugOf, keyer) {
  const m = new Map();
  for (const r of rows) { const k = keyer(slugOf(r), r); m.set(k, (m.get(k) ?? 0) + 1); }
  return m;
}
const csvAA = ms(gt, (r) => r.account_slug, (slug, r) => `${slug}|${amt(r.amount)}`);
const dbAA = ms(dbOverlap, (r) => r.accounts.slug, (slug, r) => `${slug}|${amt(r.amount)}`);
let mAA = 0, csvOnlyAA = 0, plaidOnlyAA = 0;
for (const k of new Set([...csvAA.keys(), ...dbAA.keys()])) {
  const c = csvAA.get(k) ?? 0, d = dbAA.get(k) ?? 0;
  mAA += Math.min(c, d); if (c > d) csvOnlyAA += c - d; if (d > c) plaidOnlyAA += d - c;
}
console.log(`\n── Diagnosis: relax DATE, match on account|amount (overlap window) ──`);
console.log(`  matched: ${mAA} | CSV-only: ${csvOnlyAA} | Plaid-only: ${plaidOnlyAA}`);
console.log(`  → if CSV-only collapses vs the strict ${csvOnly}, the gap is a date-convention shift, not missing data.`);

// ---- Diagnosis 2: per-account strict mismatch concentration ----
const perAcct = new Map();
for (const k of allKeys) {
  const slug = k.split("|")[0];
  const c = csvMs.get(k) ?? 0, d = dbMs.get(k) ?? 0;
  const e = perAcct.get(slug) ?? { csvOnly: 0, plaidOnly: 0 };
  if (c > d) e.csvOnly += c - d; if (d > c) e.plaidOnly += d - c;
  perAcct.set(slug, e);
}
console.log(`\n── Per-account strict mismatch (account|date|amount) ──`);
for (const [slug, e] of [...perAcct.entries()].filter(([, e]) => e.csvOnly || e.plaidOnly).sort((a, b) => (b[1].csvOnly + b[1].plaidOnly) - (a[1].csvOnly + a[1].plaidOnly)))
  console.log(`  ${slug.padEnd(30)} CSV-only=${e.csvOnly}  Plaid-only=${e.plaidOnly}`);

// ---- Diagnosis 3: the genuinely CSV-only rows (no account|amount match in Plaid overlap) ----
const dbAAremain = new Map(dbAA);
console.log(`\n── CSV rows with NO account|amount match in Plaid (the real gaps) ──`);
const realGaps = [];
for (const r of gt) {
  const k = `${r.account_slug}|${amt(r.amount)}`;
  const have = dbAAremain.get(k) ?? 0;
  if (have > 0) { dbAAremain.set(k, have - 1); }
  else realGaps.push(r);
}
for (const r of realGaps)
  console.log(`  ${r.account_slug.padEnd(28)} ${r.transaction_date}  ${String(r.amount).padStart(10)}  ${(r.description || "").slice(0, 46)}`);
console.log(`  (${realGaps.length} rows)`);
