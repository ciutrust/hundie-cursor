import { readFileSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { parseCardCsv } from "./card-parsers.mjs";
import {
  buildTransactionDedupeKey,
  buildTransactionHash,
  dedupeImportPlanRows,
} from "./import-hash.mjs";
import { resolveEntitySlug } from "./entity-resolver.mjs";
import { rowsToObjects, parseCsv } from "./csv-utils.mjs";

export function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export function resolveDownloadPath(fileName) {
  if (fileName.startsWith("/")) return fileName;
  return resolve(process.env.HOME ?? "", "Downloads", fileName);
}

export function inDateRange(isoDate, from, to) {
  if (!isoDate) return false;
  if (from && isoDate < from) return false;
  if (to && isoDate >= to) return false;
  return true;
}

async function loadExistingBusinessKeys(supabase, accountId, dateMin, dateMax) {
  const keys = new Set();
  if (!dateMin || !dateMax) return keys;

  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("transactions")
      .select("transaction_date, amount, description")
      .eq("account_id", accountId)
      .gte("transaction_date", dateMin)
      .lte("transaction_date", dateMax)
      .range(offset, offset + pageSize - 1);

    if (error) {
      throw new Error(`Failed to load existing transactions: ${error.message}`);
    }

    if (!data?.length) break;

    for (const tx of data) {
      keys.add(
        buildTransactionDedupeKey({
          accountId,
          transactionDate: tx.transaction_date,
          amount: tx.amount,
          description: tx.description,
        }),
      );
    }

    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return keys;
}

/** Skip rows that already exist under a legacy import_hash or a prior batch. */
export async function filterRowsAgainstExisting(supabase, accountId, rows, dateMin, dateMax) {
  const existingKeys = await loadExistingBusinessKeys(supabase, accountId, dateMin, dateMax);
  const seen = new Set(existingKeys);
  const filtered = [];
  let skipped = 0;

  for (const row of rows) {
    const key = buildTransactionDedupeKey({
      accountId,
      transactionDate: row.transaction.transaction_date,
      amount: row.transaction.amount,
      description: row.transaction.description,
    });
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    filtered.push(row);
  }

  return { rows: filtered, skipped };
}

export function buildImportPlan(
  account,
  csvPath,
  csvText,
  entityMap,
  {
    dryRun = false,
    supplementalCsvTexts = [],
    dateFrom = null,
    dateTo = null,
    overrideClassification = null,
  } = {},
) {
  const parsed = parseCardCsv(csvText, account, { supplementalCsvTexts });
  const rows = [];

  for (const tx of parsed) {
    if (!inDateRange(tx.transactionDate, dateFrom, dateTo)) continue;

    let entitySlug = resolveEntitySlug(account, tx.transactionDate);
    let categoryId = null;
    let classifiedBy = "import";
    let notes = null;

    if (overrideClassification) {
      const override = overrideClassification(tx);
      if (override === null) continue;
      if (override.entitySlug) entitySlug = override.entitySlug;
      if (override.categoryId !== undefined) categoryId = override.categoryId;
      if (override.classifiedBy) classifiedBy = override.classifiedBy;
      if (override.notes) notes = override.notes;
    }

    const entityId = dryRun
      ? entitySlug
      : entitySlug
        ? entityMap.get(entitySlug)
        : account.default_entity_id;

    if (!entityId) {
      throw new Error(
        `No entity resolved for ${account.slug} on ${tx.transactionDate} (slug: ${entitySlug})`,
      );
    }

    const importHash = buildTransactionHash({
      accountId: account.id,
      transactionDate: tx.transactionDate,
      amount: tx.amount,
      description: tx.description,
      issuerReference: tx.issuerReference,
    });

    rows.push({
      transaction: {
        account_id: account.id,
        transaction_date: tx.transactionDate,
        posted_date: tx.postedDate,
        amount: tx.amount,
        description: tx.description,
        vendor: tx.vendor,
        raw_category: tx.rawCategory,
        import_hash: importHash,
      },
      classification: dryRun
        ? { entity_slug: entitySlug, category_id: categoryId, classified_by: classifiedBy, notes }
        : { entity_id: entityId, category_id: categoryId, classified_by: classifiedBy, notes },
      entitySlug,
    });
  }

  const { rows: dedupedRows, skipped: inFileDupes } = dedupeImportPlanRows(account.id, rows);
  const dates = dedupedRows.map((row) => row.transaction.transaction_date).sort();
  return {
    account,
    csvPath,
    rows: dedupedRows,
    inFileDupes,
    dateMin: dates[0] ?? null,
    dateMax: dates.at(-1) ?? null,
    rawRows: rowsToObjects(parseCsv(csvText)),
  };
}

export function buildImportPlanFromTransactions(
  account,
  sourceLabel,
  transactions,
  entityMap,
  {
    dryRun = false,
    dateFrom = null,
    dateTo = null,
    resolveRow = null,
  } = {},
) {
  const rows = [];

  for (const tx of transactions) {
    if (!inDateRange(tx.transactionDate, dateFrom, dateTo)) continue;

    const resolved = resolveRow
      ? resolveRow(tx)
      : {
          entitySlug: resolveEntitySlug(account, tx.transactionDate),
          categoryId: null,
          classifiedBy: "import",
          notes: null,
        };

    const entityId = dryRun
      ? resolved.entitySlug
      : resolved.entitySlug
        ? entityMap.get(resolved.entitySlug)
        : account.default_entity_id;

    if (!entityId) {
      throw new Error(
        `No entity resolved for ${account.slug} on ${tx.transactionDate} (slug: ${resolved.entitySlug})`,
      );
    }

    const importHash = buildTransactionHash({
      accountId: account.id,
      transactionDate: tx.transactionDate,
      amount: tx.amount,
      description: tx.description,
      issuerReference: tx.issuerReference,
    });

    rows.push({
      transaction: {
        account_id: account.id,
        transaction_date: tx.transactionDate,
        posted_date: tx.postedDate ?? tx.transactionDate,
        amount: tx.amount,
        description: tx.description,
        vendor: tx.vendor ?? null,
        raw_category: tx.rawCategory ?? null,
        import_hash: importHash,
      },
      classification: dryRun
        ? {
            entity_slug: resolved.entitySlug,
            category_id: resolved.categoryId,
            classified_by: resolved.classifiedBy,
            notes: resolved.notes,
          }
        : {
            entity_id: entityId,
            category_id: resolved.categoryId,
            classified_by: resolved.classifiedBy,
            notes: resolved.notes,
          },
      entitySlug: resolved.entitySlug,
    });
  }

  const { rows: dedupedRows, skipped: inFileDupes } = dedupeImportPlanRows(account.id, rows);
  const dates = dedupedRows.map((row) => row.transaction.transaction_date).sort();
  return {
    account,
    csvPath: sourceLabel,
    rows: dedupedRows,
    inFileDupes,
    dateMin: dates[0] ?? null,
    dateMax: dates.at(-1) ?? null,
    rawRows: [],
  };
}

export async function importAccountPlan(
  supabase,
  plan,
  { dryRun = false, storeRaw = true, sourceType = "card_csv" } = {},
) {
  const { account, csvPath, rows, dateMin, dateMax, rawRows, inFileDupes = 0 } = plan;

  console.log(`\n${account.display_name} (${account.slug})`);
  console.log(`  File: ${basename(csvPath)}`);
  console.log(`  Parsed charges: ${rows.length}`);
  if (inFileDupes > 0) console.log(`  In-file dupes skipped: ${inFileDupes}`);
  if (dateMin) console.log(`  Date range: ${dateMin} → ${dateMax}`);

  if (dryRun) {
    const entityCounts = new Map();
    const categorized = rows.filter((row) => row.classification.category_id).length;
    for (const row of rows) {
      entityCounts.set(row.entitySlug, (entityCounts.get(row.entitySlug) ?? 0) + 1);
    }
    for (const [slug, count] of [...entityCounts.entries()].sort()) {
      console.log(`  Entity ${slug}: ${count}`);
    }
    console.log(`  With category: ${categorized}`);
    return { inserted: 0, updated: 0, skipped: 0, dryRun: true };
  }

  const { data: batch, error: batchError } = await supabase
    .from("import_batches")
    .insert({
      source_type: sourceType,
      source_file: basename(csvPath),
      account_id: account.id,
      entity_id: account.default_entity_id,
      row_count: rows.length,
    })
    .select("id")
    .single();

  if (batchError || !batch) {
    throw new Error(`Failed to create import batch: ${batchError?.message}`);
  }

  let insertedClassifications = 0;
  let inserted = 0;

  const { rows: rowsToImport, skipped: existingDupes } = await filterRowsAgainstExisting(
    supabase,
    account.id,
    rows,
    dateMin,
    dateMax,
  );
  if (existingDupes > 0) {
    console.log(`  Existing ledger dupes skipped: ${existingDupes}`);
  }

  for (const batchRows of chunk(rowsToImport, 200)) {
    const txPayload = batchRows.map((row) => ({
      ...row.transaction,
      import_batch_id: batch.id,
    }));

    // ignoreDuplicates makes .select() return ONLY the newly-inserted rows — an exact, race-free
    // count, unlike a before/after COUNT(*) diff.
    const { data: newRows, error: txError } = await supabase
      .from("transactions")
      .upsert(txPayload, { onConflict: "account_id,import_hash", ignoreDuplicates: true })
      .select("id");

    if (txError) {
      throw new Error(`Transaction upsert failed: ${txError.message}`);
    }
    inserted += (newRows ?? []).length;

    // Resolve transaction ids for EVERY row in the batch (newly-inserted AND already-existing), so a
    // prior partial run that inserted a transaction but not its classification self-heals here.
    const hashes = batchRows.map((row) => row.transaction.import_hash);
    const { data: txRows, error: selError } = await supabase
      .from("transactions")
      .select("id, import_hash")
      .eq("account_id", account.id)
      .in("import_hash", hashes);
    if (selError) throw new Error(`Transaction lookup failed: ${selError.message}`);

    const idByHash = new Map((txRows ?? []).map((t) => [t.import_hash, t.id]));

    // Which transactions already have a classification? Preserve them — never overwrite a human
    // confirmation; only fill in the ones that are missing.
    const classified = new Set();
    const txIds = [...idByHash.values()];
    for (const idBatch of chunk(txIds, 200)) {
      const { data: existing, error: clsError } = await supabase
        .from("classifications")
        .select("transaction_id")
        .in("transaction_id", idBatch);
      if (clsError) throw new Error(`Classification lookup failed: ${clsError.message}`);
      for (const c of existing ?? []) classified.add(c.transaction_id);
    }

    const toInsert = [];
    for (const row of batchRows) {
      const txId = idByHash.get(row.transaction.import_hash);
      if (!txId || classified.has(txId)) continue;
      toInsert.push({
        transaction_id: txId,
        entity_id: row.classification.entity_id,
        category_id: row.classification.category_id,
        classified_by: row.classification.classified_by,
        notes: row.classification.notes,
        classified_at: new Date().toISOString(),
      });
    }

    for (const insBatch of chunk(toInsert, 200)) {
      const { error: insError } = await supabase.from("classifications").insert(insBatch);
      if (insError) throw new Error(`Classification insert failed: ${insError.message}`);
      insertedClassifications += insBatch.length;
    }
  }

  const skipped = existingDupes + (rowsToImport.length - inserted);

  // A re-sync with nothing new leaves an empty batch behind — drop it so they don't accumulate.
  if (inserted === 0) {
    await supabase.from("import_batches").delete().eq("id", batch.id);
  }

  if (inserted > 0 && storeRaw && rawRows.length > 0) {
    let rowNumber = 0;
    for (const rawBatch of chunk(rawRows, 200)) {
      const payload = rawBatch.map((raw) => {
        rowNumber += 1;
        return {
          import_batch_id: batch.id,
          account_id: account.id,
          row_number: rowNumber,
          raw_data: raw,
        };
      });

      const { error: rawError } = await supabase.from("raw_import_rows").insert(payload);
      if (rawError) {
        console.warn(`  Warning: raw_import_rows insert failed: ${rawError.message}`);
        break;
      }
    }
  }

  console.log(`  Inserted: ${inserted}, skipped (dupes): ${skipped}, classifications: ${insertedClassifications}`);
  return { inserted, updated: insertedClassifications, skipped, batchId: batch.id };
}

export function loadEnvFile(envPath) {
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
