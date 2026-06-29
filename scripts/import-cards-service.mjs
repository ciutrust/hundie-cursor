#!/usr/bin/env node
/**
 * Execute card import SQL chunks via Supabase MCP-compatible flow.
 * Requires SUPABASE_SERVICE_ROLE_KEY, or set HUNDIE_USE_MCP=1 and run chunks manually.
 *
 * With service role: inserts directly via supabase-js (bypasses RLS).
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { parseCardCsv, KNOWN_ACCOUNTS } from "./lib/card-parsers.mjs";
import { buildTransactionHash, dedupeImportPlanRows } from "./lib/import-hash.mjs";
import { filterRowsAgainstExisting } from "./lib/ledger-import.mjs";
import { resolveEntitySlug } from "./lib/entity-resolver.mjs";

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

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function resolveDefaultPath(relativePath) {
  return resolve(process.env.HOME ?? "", relativePath);
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  console.error("Or run: node scripts/archive/generate-card-import-sql.mjs && use Supabase MCP execute_sql on scripts/.card-import-sql/mcp-chunks/*.sql");
  process.exit(1);
}

const supabase = createClient(url, serviceKey);

const { data: accounts, error: accountsError } = await supabase
  .from("accounts")
  .select("id, slug, display_name, account_type, issuer_parser, date_rules, default_entity_id, default_entity:entities!accounts_default_entity_id_fkey(id, slug)")
  .eq("is_active", true);

if (accountsError) throw new Error(accountsError.message);

const { data: entities } = await supabase.from("entities").select("id, slug");
const entityMap = new Map((entities ?? []).map((e) => [e.slug, e.id]));
const accountBySlug = new Map((accounts ?? []).map((a) => [a.slug, a]));

console.log("Card import (service role)\n");

let totalInserted = 0;

for (const known of KNOWN_ACCOUNTS) {
  const account = accountBySlug.get(known.slug);
  const csvPath = resolveDefaultPath(known.defaultPath);
  if (!account || !existsSync(csvPath)) {
    console.warn(`Skip ${known.slug}`);
    continue;
  }

  const csvText = readFileSync(csvPath, "utf8");
  const parsed = parseCardCsv(csvText, account);
  const batchId = randomUUID();

  const { error: batchError } = await supabase.from("import_batches").insert({
    id: batchId,
    source_type: "card_csv",
    source_file: csvPath.split("/").pop(),
    account_id: account.id,
    entity_id: account.default_entity_id,
    row_count: parsed.length,
  });

  if (batchError) throw new Error(`${known.slug} batch: ${batchError.message}`);

  const rows = parsed.map((tx) => {
    const entitySlug = resolveEntitySlug(account, tx.transactionDate);
    const entityId = entitySlug ? entityMap.get(entitySlug) : account.default_entity_id;
    const importHash = buildTransactionHash({
      accountId: account.id,
      transactionDate: tx.transactionDate,
      amount: tx.amount,
      description: tx.description,
      issuerReference: tx.issuerReference,
    });
    return {
      transaction: {
        account_id: account.id,
        import_batch_id: batchId,
        transaction_date: tx.transactionDate,
        posted_date: tx.postedDate,
        amount: tx.amount,
        description: tx.description,
        vendor: tx.vendor,
        raw_category: tx.rawCategory,
        import_hash: importHash,
      },
      entityId,
    };
  });

  const { rows: dedupedRows } = dedupeImportPlanRows(account.id, rows);
  const dates = dedupedRows.map((row) => row.transaction.transaction_date).sort();
  const { rows: rowsToImport } = await filterRowsAgainstExisting(
    supabase,
    account.id,
    dedupedRows,
    dates[0] ?? null,
    dates.at(-1) ?? null,
  );

  let inserted = 0;
  for (const batch of chunk(rowsToImport, 200)) {
    const { data: upserted, error: txError } = await supabase
      .from("transactions")
      .upsert(
        batch.map((r) => r.transaction),
        { onConflict: "account_id,import_hash", ignoreDuplicates: true },
      )
      .select("id, import_hash");

    if (txError) throw new Error(`${known.slug} tx: ${txError.message}`);

    const hashToEntity = new Map(batch.map((r) => [r.transaction.import_hash, r.entityId]));
    const classPayload = (upserted ?? []).map((tx) => ({
      transaction_id: tx.id,
      entity_id: hashToEntity.get(tx.import_hash),
      category_id: null,
      classified_by: "import",
    }));

    if (classPayload.length > 0) {
      const { error: classError } = await supabase
        .from("classifications")
        .upsert(classPayload, { onConflict: "transaction_id", ignoreDuplicates: true });
      if (classError) throw new Error(`${known.slug} class: ${classError.message}`);
    }

    inserted += upserted?.length ?? 0;
  }

  totalInserted += inserted;
  console.log(`${known.slug}: ${inserted} inserted (${rowsToImport.length} new of ${parsed.length} parsed) ${dates[0] ?? "—"} → ${dates.at(-1) ?? "—"}`);
}

console.log(`\nTotal inserted this run: ${totalInserted}`);
