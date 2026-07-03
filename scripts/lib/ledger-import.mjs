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

/**
 * Load the existing ledger rows in [dateMin, dateMax] for an account, indexed two ways:
 *  - `hashes`: a Set of import_hash — an exact identity match means a true re-import → idempotent skip.
 *  - `keyCounts`: a Map of business-key → count — catches rows already present under a LEGACY/different
 *    import_hash (e.g. imported before issuerReference was folded into the hash); the COUNT keeps the
 *    cross-batch dedup occurrence-aware so genuine same-key duplicates are not over-collapsed (BUG-03).
 *
 * BUG-05: paginate with a STABLE .order("id") BEFORE .range(); without an explicit order, Postgres may
 * return rows in an unstable order across pages, so on >1000-row windows a page could skip keys and a
 * duplicate would slip through. The Stage-2 backfill creates exactly such >1000-row windows.
 */
async function loadExistingLedgerIndex(supabase, accountId, dateMin, dateMax) {
  const hashes = new Set();
  const keyCounts = new Map();
  if (!dateMin || !dateMax) return { hashes, keyCounts };

  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("transactions")
      .select("id, transaction_date, amount, description, import_hash")
      .eq("account_id", accountId)
      .gte("transaction_date", dateMin)
      .lte("transaction_date", dateMax)
      .order("id")
      .range(offset, offset + pageSize - 1);

    if (error) {
      throw new Error(`Failed to load existing transactions: ${error.message}`);
    }

    if (!data?.length) break;

    for (const tx of data) {
      if (tx.import_hash) hashes.add(tx.import_hash);
      const key = buildTransactionDedupeKey({
        accountId,
        transactionDate: tx.transaction_date,
        amount: tx.amount,
        description: tx.description,
      });
      keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
    }

    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return { hashes, keyCounts };
}

/**
 * Skip rows already present in the ledger while PRESERVING genuine duplicates (BUG-03).
 *
 * Two phases:
 *  1. Exact identity — a row whose import_hash is already in the ledger is a true re-import → skip.
 *     This keeps re-imports idempotent for BOTH Plaid (whose hash carries the per-txn id) and CSV
 *     (whose occurrence-suffixed hashes reproduce exactly on a re-run).
 *  2. Legacy budget — for the remaining candidates WITHOUT a stable external id, an existing ledger
 *     row of the same business key that was NOT matched by an exact hash is presumed to be the same
 *     logical transaction stored under a legacy/different hash, so that many candidates are skipped.
 *     The COUNT (not a boolean) is what preserves genuinely-distinct same-key charges: incoming N,
 *     existing E → insert max(0, N - E). Candidates carrying an external_id (Plaid) have a reliable
 *     identity, so they skip the legacy budget entirely — a brand-new Plaid charge that merely shares
 *     date+amount+merchant with an existing row is kept, not collapsed.
 */
export async function filterRowsAgainstExisting(supabase, accountId, rows, dateMin, dateMax) {
  const { hashes: existingHashes, keyCounts } = await loadExistingLedgerIndex(
    supabase,
    accountId,
    dateMin,
    dateMax,
  );

  const keyOf = (row) =>
    buildTransactionDedupeKey({
      accountId,
      transactionDate: row.transaction.transaction_date,
      amount: row.transaction.amount,
      description: row.transaction.description,
    });

  // Phase 1: exact import_hash matches are already in the ledger (idempotent re-import).
  const exactMatchByKey = new Map();
  const candidates = [];
  let skipped = 0;
  for (const row of rows) {
    const hash = row.transaction.import_hash;
    if (hash && existingHashes.has(hash)) {
      skipped++;
      const key = keyOf(row);
      exactMatchByKey.set(key, (exactMatchByKey.get(key) ?? 0) + 1);
      continue;
    }
    candidates.push(row);
  }

  // Phase 2: legacy business-key budget over only the existing rows NOT already matched by hash.
  const legacyBudget = new Map();
  for (const [key, count] of keyCounts) {
    legacyBudget.set(key, count - (exactMatchByKey.get(key) ?? 0));
  }
  const filtered = [];
  for (const row of candidates) {
    if (row.transaction.external_id) {
      filtered.push(row); // stable Plaid identity → never collapse on business key
      continue;
    }
    const key = keyOf(row);
    const remaining = legacyBudget.get(key) ?? 0;
    if (remaining > 0) {
      legacyBudget.set(key, remaining - 1);
      skipped++;
      continue;
    }
    filtered.push(row);
  }

  return { rows: filtered, skipped };
}

/**
 * Split plan rows into {existing, fresh} by whether (account_id, external_id) is already in the
 * ledger. Rows without an external_id (all CSV rows) are always `fresh`. Plaid routing uses this so a
 * known external_id — whether arriving as `modified` OR re-labeled `added` on a cursor reset — goes
 * to UPDATE-in-place (BUG-01) instead of inserting a duplicate.
 */
export async function partitionRowsByExistingExternalId(supabase, accountId, rows) {
  const ids = [...new Set(rows.map((r) => r.transaction.external_id).filter(Boolean))];
  const existingIds = new Set();
  for (const idBatch of chunk(ids, 500)) {
    const { data, error } = await supabase
      .from("transactions")
      .select("external_id")
      .eq("account_id", accountId)
      .in("external_id", idBatch);
    if (error) throw new Error(`external_id lookup failed: ${error.message}`);
    for (const r of data ?? []) existingIds.add(r.external_id);
  }
  const existing = [];
  const fresh = [];
  for (const r of rows) {
    const ext = r.transaction.external_id;
    if (ext && existingIds.has(ext)) existing.push(r);
    else fresh.push(r);
  }
  return { existing, fresh };
}

/**
 * Apply rows keyed on (account_id, external_id) as UPDATEs to the transactions row ONLY — the
 * classifications row is never read or written, so any human classification is preserved (BUG-01).
 * import_hash is recomputed by the caller and updated so it stays consistent with the new amount/desc
 * (keeps a later `added` re-feed a clean onConflict no-op). Rows whose external_id is not present yet
 * are returned in `unmatched` for the caller to INSERT. The UPDATE deliberately omits import_batch_id,
 * created_at and id, so the original batch lineage and insert timestamp are preserved.
 *
 * C20 mirror: the payload also clears `plaid_removed_at`. A row that was stamped removed (e.g. a
 * modified event flipped it to pending) but is now being re-delivered as an eligible Plaid txn is, by
 * definition, NOT removed — leaving the flag set would keep a live charge hidden (understated
 * expenses). This path only runs for rows Plaid re-delivered as eligible in the current batch, so
 * clearing the flag is always correct; external_id is Plaid-only so CSV/manual rows are unaffected.
 *
 * @returns {Promise<{ updated: number, unmatched: any[] }>}
 */
export async function updateTransactionsByExternalId(supabase, accountId, rows) {
  let updated = 0;
  const unmatched = [];
  for (const row of rows) {
    const externalId = row.transaction.external_id;
    if (!externalId) {
      unmatched.push(row); // no stable id → can't update safely; insert instead
      continue;
    }
    const { data, error } = await supabase
      .from("transactions")
      .update({
        transaction_date: row.transaction.transaction_date,
        posted_date: row.transaction.posted_date,
        amount: row.transaction.amount,
        description: row.transaction.description,
        vendor: row.transaction.vendor,
        raw_category: row.transaction.raw_category,
        import_hash: row.transaction.import_hash,
        plaid_removed_at: null, // C20: re-delivered as eligible → un-stamp any prior removal
      })
      .eq("account_id", accountId)
      .eq("external_id", externalId)
      .select("id");
    if (error) throw new Error(`Plaid modify update failed: ${error.message}`);
    if (data && data.length > 0) updated += data.length;
    else unmatched.push(row); // external_id not in ledger yet → insert it
  }
  return { updated, unmatched };
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
        external_id: tx.externalId ?? null, // BUG-01: CSV has none → null (shape symmetry only)
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

/**
 * @param {any} account
 * @param {string} sourceLabel
 * @param {any[]} transactions
 * @param {Map<string, string>} entityMap
 * @param {{ dryRun?: boolean, dateFrom?: string | null, dateTo?: string | null, resolveRow?: ((tx: any) => any) | null }} [options]
 */
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
        external_id: tx.externalId ?? null, // BUG-01: Plaid transaction_id (CSV → null)
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

  // PASS 1 — INSERT only new transactions (business keys not already in the ledger).
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
  }

  // PASS 2 — HEAL classifications over the FULL deduped set (BUG-02).
  // filterRowsAgainstExisting drops rows whose business key already exists, so a transaction inserted
  // on a PRIOR run whose classification insert failed (an orphan — invisible to every
  // classifications!inner report) never reached the old heal loop. Iterating `rows` (every deduped
  // row, INCLUDING ones filtered out of the insert) resolves each tx id by import_hash and inserts any
  // MISSING classification. Existing classifications (human or import) are preserved — never
  // overwritten. Rows whose import_hash isn't found (legacy rows stored under a different hash) are
  // skipped: we only heal rows we can match exactly by identity.
  for (const batchRows of chunk(rows, 200)) {
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
