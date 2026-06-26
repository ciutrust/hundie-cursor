import { readFileSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { parseCardCsv } from "./card-parsers.mjs";
import { buildTransactionHash } from "./import-hash.mjs";
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

  const dates = rows.map((row) => row.transaction.transaction_date).sort();
  return {
    account,
    csvPath,
    rows,
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

  const dates = rows.map((row) => row.transaction.transaction_date).sort();
  return {
    account,
    csvPath: sourceLabel,
    rows,
    dateMin: dates[0] ?? null,
    dateMax: dates.at(-1) ?? null,
    rawRows: [],
  };
}

export async function importAccountPlan(supabase, plan, { dryRun = false, storeRaw = true } = {}) {
  const { account, csvPath, rows, dateMin, dateMax, rawRows } = plan;

  console.log(`\n${account.display_name} (${account.slug})`);
  console.log(`  File: ${basename(csvPath)}`);
  console.log(`  Parsed charges: ${rows.length}`);
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
      source_type: "card_csv",
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

  const { count: beforeCount } = await supabase
    .from("transactions")
    .select("*", { count: "exact", head: true })
    .eq("account_id", account.id);

  let updatedClassifications = 0;

  for (const batchRows of chunk(rows, 200)) {
    const txPayload = batchRows.map((row) => ({
      ...row.transaction,
      import_batch_id: batch.id,
    }));

    const { data: upserted, error: txError } = await supabase
      .from("transactions")
      .upsert(txPayload, { onConflict: "account_id,import_hash", ignoreDuplicates: true })
      .select("id, import_hash");

    if (txError) {
      throw new Error(`Transaction upsert failed: ${txError.message}`);
    }

    const hashToRow = new Map(batchRows.map((row) => [row.transaction.import_hash, row]));

    for (const tx of upserted ?? []) {
      const row = hashToRow.get(tx.import_hash);
      if (!row) continue;

      const { data: existing } = await supabase
        .from("classifications")
        .select("id")
        .eq("transaction_id", tx.id)
        .maybeSingle();

      const payload = {
        entity_id: row.classification.entity_id,
        category_id: row.classification.category_id,
        classified_by: row.classification.classified_by,
        notes: row.classification.notes,
        classified_at: new Date().toISOString(),
      };

      if (existing) {
        const { error: updateError } = await supabase
          .from("classifications")
          .update(payload)
          .eq("id", existing.id);
        if (updateError) throw new Error(`Classification update failed: ${updateError.message}`);
      } else {
        const { error: insertError } = await supabase.from("classifications").insert({
          transaction_id: tx.id,
          ...payload,
        });
        if (insertError) throw new Error(`Classification insert failed: ${insertError.message}`);
      }
      updatedClassifications += 1;
    }
  }

  const { count: afterCount } = await supabase
    .from("transactions")
    .select("*", { count: "exact", head: true })
    .eq("account_id", account.id);

  const inserted = (afterCount ?? 0) - (beforeCount ?? 0);
  const skipped = rows.length - inserted;

  if (storeRaw && rawRows.length > 0) {
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

  console.log(`  Inserted: ${inserted}, skipped (dupes): ${skipped}, classifications: ${updatedClassifications}`);
  return { inserted, updated: updatedClassifications, skipped, batchId: batch.id };
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
