#!/usr/bin/env node
/**
 * Import personal card tabs from 2025_Business_Expenses_Fixed.xlsx.
 * YES → entity GBSL + mapped category. NO → default personal entity.
 *
 * Usage:
 *   node scripts/import-business-sheet.mjs --dry-run
 *   node scripts/import-business-sheet.mjs --apply
 *   node scripts/import-business-sheet.mjs --apply --file ~/Downloads/2025_Business_Expenses_Fixed.xlsx
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, writeFileSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { SEED_ACCOUNT_BY_SLUG } from "./lib/seed-accounts.mjs";
import {
  BUSINESS_SHEET_DEFAULT_PATH,
  BUSINESS_SHEET_TABS,
  IMPORT_2025_FROM,
  IMPORT_2025_TO,
} from "./lib/2025-import-manifest.mjs";
import { mapSheetCategory } from "./lib/sheet-category-map.mjs";
import { readXlsxTab } from "./lib/xlsx-read.mjs";
import { getTabHeaderRow, parseBusinessSheetTab } from "./lib/sheet-tab-parsers.mjs";
import {
  buildImportPlanFromTransactions,
  importAccountPlan,
  loadEnvFile,
  resolveDownloadPath,
} from "./lib/ledger-import.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const args = process.argv.slice(2);
const dryRun = !args.includes("--apply");
const fileArg = args.includes("--file") ? args[args.indexOf("--file") + 1] : null;
const xlsxPath = fileArg ? resolve(fileArg) : resolveDownloadPath(BUSINESS_SHEET_DEFAULT_PATH);

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

async function loadGbslCategoryMap(supabase) {
  const { data: entity } = await supabase.from("entities").select("id").eq("slug", "gbsl").single();
  if (!entity) throw new Error("GBSL entity not found");

  const { data, error } = await supabase
    .from("categories")
    .select("id, full_path")
    .eq("entity_id", entity.id);
  if (error) throw new Error(error.message);

  const map = new Map();
  for (const row of data ?? []) {
    map.set(row.full_path, row.id);
  }
  return map;
}

function normalizeAccount(account, known) {
  return { ...account, default_entity: account.default_entity ?? null };
}

if (!existsSync(xlsxPath)) {
  console.error(`Xlsx not found: ${xlsxPath}`);
  process.exit(1);
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
    ])
  : await loadEntityMap(supabase);

const categoryMap = dryRun ? new Map() : await loadGbslCategoryMap(supabase);
const accounts = dryRun ? [] : await loadAccounts(supabase);
const accountBySlug = new Map(accounts.map((a) => [a.slug, a]));

console.log(`Business sheet import: ${basename(xlsxPath)}`);
console.log(`Range: ${IMPORT_2025_FROM} → ${IMPORT_2025_TO}`);
console.log(`Mode: ${dryRun ? "DRY RUN" : "APPLY"}`);

const reviewRows = [];
let totalYes = 0;
let totalNo = 0;
let missingCategories = new Set();

for (const tab of BUSINESS_SHEET_TABS) {
  const headerRow = getTabHeaderRow(tab.tab);
  const { records } = readXlsxTab(xlsxPath, tab.tab, headerRow);
  const transactions = parseBusinessSheetTab(tab.tab, records);

  const known = SEED_ACCOUNT_BY_SLUG.get(tab.slug);
  const account = dryRun
    ? { id: known?.id ?? tab.slug, slug: tab.slug, ...known, default_entity: known?.default_entity }
    : normalizeAccount(accountBySlug.get(tab.slug), known);

  if (!account?.id && !dryRun) {
    console.warn(`\nSkipping tab ${tab.tab} — account ${tab.slug} not in DB`);
    continue;
  }

  const plan = buildImportPlanFromTransactions(
    account,
    `${basename(xlsxPath)}#${tab.tab}`,
    transactions,
    entityMap,
    {
      dryRun,
      dateFrom: IMPORT_2025_FROM,
      dateTo: IMPORT_2025_TO,
      resolveRow: (tx) => {
        const isBusiness = tx.businessExpense === "YES";
        if (isBusiness) totalYes += 1;
        else totalNo += 1;

        let categoryId = null;
        let notes = tx.notes;
        if (tx.cardMember) {
          notes = notes ? `${notes} · Card: ${tx.cardMember}` : `Card: ${tx.cardMember}`;
        }

        if (isBusiness) {
          const path = mapSheetCategory(tx.businessCategory);
          categoryId = dryRun ? path : (categoryMap.get(path) ?? null);
          if (isBusiness && path && !dryRun && !categoryId) {
            missingCategories.add(path);
            reviewRows.push({
              tab: tab.tab,
              date: tx.transactionDate,
              amount: tx.amount,
              description: tx.description,
              reason: `Unknown GBSL category path: ${path}`,
            });
          }
          return {
            entitySlug: "gbsl",
            categoryId,
            classifiedBy: "sheet_2025",
            notes: notes ? `${notes} · sheet:${tx.businessCategory ?? ""}` : `sheet:${tx.businessCategory ?? ""}`,
          };
        }

        return {
          entitySlug: account.default_entity?.slug ?? "personal",
          categoryId: null,
          classifiedBy: "sheet_2025",
          notes,
        };
      },
    },
  );

  await importAccountPlan(supabase, plan, { dryRun, storeRaw: false });
}

const reviewPath = resolve(root, "scripts/.sheet-import-review.json");
writeFileSync(
  reviewPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      missingCategories: [...missingCategories],
      reviewRows,
      totals: { yes: totalYes, no: totalNo },
    },
    null,
    2,
  ),
);

console.log(`\nDone. YES=${totalYes} NO=${totalNo}`);
if (missingCategories.size > 0) {
  console.log(`Missing category paths (${missingCategories.size}):`);
  for (const path of missingCategories) console.log(`  - ${path}`);
}
console.log(`Review file: ${reviewPath}`);
