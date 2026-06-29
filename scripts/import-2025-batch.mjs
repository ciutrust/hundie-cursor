#!/usr/bin/env node
/**
 * Import 2025 bank/card CSVs (see lib/2025-import-manifest.mjs).
 * Files resolve relative to ~/Downloads by default, or to --csv-dir if given.
 *
 * Usage:
 *   node scripts/import-2025-batch.mjs --dry-run
 *   node scripts/import-2025-batch.mjs --apply
 *   node scripts/import-2025-batch.mjs --dry-run --csv-dir "/Users/ac/Downloads/CSV 2025-2026"
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SEED_ACCOUNT_BY_SLUG } from "./lib/seed-accounts.mjs";
import {
  IMPORT_2025_FROM,
  IMPORT_2025_TO,
  IMPORT_2025_MANIFEST,
} from "./lib/2025-import-manifest.mjs";
import {
  buildImportPlan,
  importAccountPlan,
  loadEnvFile,
  resolveDownloadPath,
} from "./lib/ledger-import.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const args = process.argv.slice(2);
const dryRun = !args.includes("--apply");
const csvDirIdx = args.indexOf("--csv-dir");
const csvDir = csvDirIdx !== -1 ? args[csvDirIdx + 1] : null;

// Files resolve relative to --csv-dir when given, else ~/Downloads (resolveDownloadPath).
function resolveCsv(file) {
  return csvDir ? resolve(csvDir, file) : resolveDownloadPath(file);
}

async function loadAccounts(supabase) {
  const { data, error } = await supabase
    .from("accounts")
    .select(
      `
      id, slug, display_name, account_type, issuer_parser, date_rules,
      default_entity_id,
      default_entity:entities!accounts_default_entity_id_fkey ( id, slug )
    `,
    )
    .eq("is_active", true);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function loadEntityMap(supabase) {
  const { data, error } = await supabase.from("entities").select("id, slug");
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((e) => [e.slug, e.id]));
}

function normalizeAccount(account, known) {
  return {
    ...account,
    default_entity: account.default_entity ?? null,
    mergeParentChild: known?.mergeParentChild ?? false,
  };
}

const env = loadEnvFile(resolve(root, ".env.local"));
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL in .env.local");
  process.exit(1);
}

if (!dryRun && !serviceKey) {
  console.error("Set SUPABASE_SERVICE_ROLE_KEY for --apply");
  process.exit(1);
}

const supabase = dryRun ? null : createClient(url, serviceKey);
const entityMap = dryRun
  ? new Map([
      ["gbsl", "gbsl"],
      ["personal", "personal"],
      ["keller", "keller"],
      ["acaa-austin", "acaa-austin"],
    ])
  : await loadEntityMap(supabase);

const accounts = dryRun ? [] : await loadAccounts(supabase);
const accountBySlug = new Map(accounts.map((a) => [a.slug, a]));

console.log(`2025 batch import (${IMPORT_2025_FROM} → ${IMPORT_2025_TO})`);
console.log(`Mode: ${dryRun ? "DRY RUN" : "APPLY"}`);
if (csvDir) console.log(`CSV dir: ${csvDir}`);
console.log(`Targets: ${IMPORT_2025_MANIFEST.length}`);

let totalParsed = 0;

for (const entry of IMPORT_2025_MANIFEST) {
  const csvPath = resolveCsv(entry.file);
  if (!existsSync(csvPath)) {
    console.warn(`\nSkipping ${entry.slug} — not found: ${csvPath}`);
    continue;
  }

  const known = SEED_ACCOUNT_BY_SLUG.get(entry.slug);
  const account = dryRun
    ? { id: known?.id ?? entry.slug, slug: entry.slug, ...known, default_entity: known?.default_entity }
    : normalizeAccount(accountBySlug.get(entry.slug), known);

  if (!account?.id && !dryRun) {
    console.warn(`\nSkipping ${entry.slug} — not in database`);
    continue;
  }

  const supplementalCsvTexts = (entry.supplementalFiles ?? [])
    .map((file) => resolveCsv(file))
    .filter((path) => existsSync(path))
    .map((path) => readFileSync(path, "utf8"));

  const csvText = readFileSync(csvPath, "utf8");
  const plan = buildImportPlan(account, csvPath, csvText, entityMap, {
    dryRun,
    supplementalCsvTexts,
    dateFrom: IMPORT_2025_FROM,
    dateTo: IMPORT_2025_TO,
  });

  await importAccountPlan(supabase, plan, { dryRun, storeRaw: !dryRun });
  totalParsed += plan.rows.length;
}

console.log(`\nDone. Total parsed in range: ${totalParsed}`);
