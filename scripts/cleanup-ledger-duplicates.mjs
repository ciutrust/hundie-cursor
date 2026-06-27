#!/usr/bin/env node
/**
 * One-time cleanup: remove duplicate ledger transactions that share the same
 * account, date, amount, and normalized description (legacy import_hash dupes).
 *
 * Keeps the best row per group (categorized > human-reviewed > oldest import).
 *
 * Usage:
 *   node scripts/cleanup-ledger-duplicates.mjs --dry-run
 *   node scripts/cleanup-ledger-duplicates.mjs --apply
 *   node scripts/cleanup-ledger-duplicates.mjs --dry-run --entity keller
 *   node scripts/cleanup-ledger-duplicates.mjs --apply --account wf-keller-services-checking
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTransactionDedupeKey } from "./lib/import-hash.mjs";
import { chunk, loadEnvFile } from "./lib/ledger-import.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", ".env.local");

function parseArgs(argv) {
  const args = { apply: false, entity: null, account: null };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--dry-run") args.apply = false;
    else if (arg === "--entity") args.entity = argv[++i];
    else if (arg === "--account") args.account = argv[++i];
  }
  return args;
}

function classificationOf(tx) {
  const cls = tx.classifications;
  if (Array.isArray(cls)) return cls[0] ?? null;
  return cls ?? null;
}

function keeperScore(tx) {
  const cls = classificationOf(tx);
  let score = 0;
  if (cls?.category_id) score += 100;
  if (cls?.classified_by && cls.classified_by !== "import") score += 50;
  if (cls?.notes) score += 10;
  return score;
}

/** Pick the row to keep when multiple share a business key. */
export function chooseDuplicateKeeper(group) {
  return [...group].sort((a, b) => {
    const scoreDiff = keeperScore(b) - keeperScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  })[0];
}

async function resolveAccountId(supabase, slug) {
  const { data, error } = await supabase.from("accounts").select("id").eq("slug", slug).maybeSingle();
  if (error) throw new Error(`Account lookup failed: ${error.message}`);
  if (!data) throw new Error(`Account not found: ${slug}`);
  return data.id;
}

async function resolveEntityId(supabase, slug) {
  const { data, error } = await supabase.from("entities").select("id").eq("slug", slug).maybeSingle();
  if (error) throw new Error(`Entity lookup failed: ${error.message}`);
  if (!data) throw new Error(`Entity not found: ${slug}`);
  return data.id;
}

async function fetchTransactions(supabase, { accountId, entityId }) {
  const rows = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    let query = supabase
      .from("transactions")
      .select(
        `
        id,
        account_id,
        transaction_date,
        amount,
        description,
        import_hash,
        created_at,
        accounts ( slug, display_name ),
        classifications (
          id,
          category_id,
          classified_by,
          notes,
          entity_id,
          entities ( slug )
        )
      `,
      )
      .order("transaction_date", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (accountId) query = query.eq("account_id", accountId);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to load transactions: ${error.message}`);
    if (!data?.length) break;

    for (const row of data) {
      if (entityId) {
        const cls = classificationOf(row);
        if (cls?.entity_id !== entityId) continue;
      }
      rows.push(row);
    }

    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return rows;
}

function groupDuplicates(transactions) {
  const groups = new Map();

  for (const tx of transactions) {
    const key = buildTransactionDedupeKey({
      accountId: tx.account_id,
      transactionDate: tx.transaction_date,
      amount: tx.amount,
      description: tx.description,
    });
    const bucket = groups.get(key) ?? [];
    bucket.push(tx);
    groups.set(key, bucket);
  }

  return [...groups.values()].filter((group) => group.length > 1);
}

async function mergeCategoryToKeeper(supabase, keeper, dupe) {
  const keeperCls = classificationOf(keeper);
  const dupeCls = classificationOf(dupe);
  if (!keeperCls || !dupeCls) return false;
  if (keeperCls.category_id || !dupeCls.category_id) return false;

  const { error } = await supabase
    .from("classifications")
    .update({
      category_id: dupeCls.category_id,
      classified_by: dupeCls.classified_by,
      notes: dupeCls.notes,
      classified_at: new Date().toISOString(),
    })
    .eq("id", keeperCls.id);

  if (error) throw new Error(`Failed to merge classification: ${error.message}`);
  keeperCls.category_id = dupeCls.category_id;
  return true;
}

function formatSample(tx) {
  const account = tx.accounts?.slug ?? tx.account_id;
  return `${tx.transaction_date}  $${Number(tx.amount).toFixed(2)}  ${account}  ${tx.description.slice(0, 60)}`;
}

async function main() {
  const args = parseArgs(process.argv);
  const env = loadEnvFile(envPath);
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey);
  const accountId = args.account ? await resolveAccountId(supabase, args.account) : null;
  const entityId = args.entity ? await resolveEntityId(supabase, args.entity) : null;

  console.log(args.apply ? "Ledger duplicate cleanup (APPLY)\n" : "Ledger duplicate cleanup (dry run)\n");
  if (args.entity) console.log(`  Entity filter: ${args.entity}`);
  if (args.account) console.log(`  Account filter: ${args.account}`);

  const transactions = await fetchTransactions(supabase, { accountId, entityId });
  console.log(`  Loaded ${transactions.length} transaction(s)\n`);

  const duplicateGroups = groupDuplicates(transactions);
  const toDelete = [];
  let mergedCategories = 0;
  let excessAmount = 0;

  for (const group of duplicateGroups) {
    const keeper = chooseDuplicateKeeper(group);
    for (const tx of group) {
      if (tx.id === keeper.id) continue;
      toDelete.push({ keeper, dupe: tx });
      excessAmount += Number(tx.amount);
    }
  }

  const byAccount = new Map();
  for (const { dupe } of toDelete) {
    const slug = dupe.accounts?.slug ?? dupe.account_id;
    byAccount.set(slug, (byAccount.get(slug) ?? 0) + 1);
  }

  console.log(`Duplicate groups: ${duplicateGroups.length}`);
  console.log(`Rows to delete:   ${toDelete.length}`);
  console.log(`Excess dollars:   $${excessAmount.toFixed(2)}`);
  if (byAccount.size > 0) {
    console.log("\nBy account:");
    for (const [slug, count] of [...byAccount.entries()].sort()) {
      console.log(`  ${slug}: ${count}`);
    }
  }

  if (toDelete.length > 0) {
    console.log("\nSample deletions (newer/import duplicate → keep oldest):");
    for (const { keeper, dupe } of toDelete.slice(0, 8)) {
      console.log(`  KEEP  ${formatSample(keeper)}  (${keeper.created_at.slice(0, 10)})`);
      console.log(`  DEL   ${formatSample(dupe)}  (${dupe.created_at.slice(0, 10)})`);
      console.log("");
    }
    if (toDelete.length > 8) console.log(`  … and ${toDelete.length - 8} more\n`);
  }

  if (!args.apply) {
    console.log("Dry run only — pass --apply to delete duplicate rows.");
    return;
  }

  if (toDelete.length === 0) {
    console.log("Nothing to delete.");
    return;
  }

  for (const { keeper, dupe } of toDelete) {
    if (await mergeCategoryToKeeper(supabase, keeper, dupe)) mergedCategories++;
  }

  const ids = toDelete.map(({ dupe }) => dupe.id);
  let deleted = 0;

  for (const idBatch of chunk(ids, 100)) {
    const { error } = await supabase.from("transactions").delete().in("id", idBatch);
    if (error) throw new Error(`Delete failed: ${error.message}`);
    deleted += idBatch.length;
  }

  console.log(`\nDeleted ${deleted} duplicate transaction(s).`);
  if (mergedCategories > 0) {
    console.log(`Merged ${mergedCategories} category from duplicate onto keeper.`);
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
