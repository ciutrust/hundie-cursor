import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCardCsv, KNOWN_ACCOUNTS } from "./lib/card-parsers.mjs";
import { buildTransactionHash, dedupeImportPlanRows } from "./lib/import-hash.mjs";
import { filterRowsAgainstExisting, inDateRange } from "./lib/ledger-import.mjs";
import { capCsvWindowForPlaid } from "./lib/csv-plaid-cap.mjs";
import { writeFileSync } from "node:fs";
import { resolveEntitySlug } from "./lib/entity-resolver.mjs";
import { rowsToObjects, parseCsv } from "./lib/csv-utils.mjs";
import { SEED_ACCOUNTS, SEED_ACCOUNT_BY_SLUG } from "./lib/seed-accounts.mjs";
import { CSV_2025_2026_DIR, CSV_2025_2026_MANIFEST } from "./lib/csv-2025-2026-manifest.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const envPath = resolve(root, ".env.local");

function loadEnv() {
  if (!existsSync(envPath)) {
    console.error("Missing .env.local — copy from .env.local.example");
    process.exit(1);
  }

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
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function resolveDefaultPath(relativePath) {
  return resolve(process.env.HOME ?? "", relativePath);
}

export function parseArgs(argv) {
  const args = {
    dryRun: true,
    all: false,
    slug: null,
    filePath: null,
    verifyOnly: false,
    csvDir: null,
    dateFrom: null, // inclusive lower bound (YYYY-MM-DD)
    dateTo: null, // EXCLUSIVE upper bound (YYYY-MM-DD); --to 2026-06-01 keeps through May 31
    exportJson: null, // path to write the filtered rows as JSON (no DB write needed)
    force: false, // C6: bypass the Plaid-cutover cap (deliberate CSV backfill over Plaid's window)
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--apply") args.dryRun = false;
    else if (arg === "--all") args.all = true;
    else if (arg === "--verify") args.verifyOnly = true;
    else if (arg === "--account") args.slug = argv[++i];
    else if (arg === "--csv-dir") args.csvDir = argv[++i];
    else if (arg === "--from") args.dateFrom = argv[++i];
    else if (arg === "--to") args.dateTo = argv[++i];
    else if (arg === "--export-json") args.exportJson = resolve(argv[++i]);
    else if (arg === "--force") args.force = true;
    else if (!arg.startsWith("-")) args.filePath = resolve(arg);
  }

  return args;
}

async function loadAccounts(supabase, slug) {
  let query = supabase
    .from("accounts")
    .select(
      `
      id,
      slug,
      display_name,
      account_type,
      issuer_parser,
      date_rules,
      default_entity_id,
      default_entity:entities!accounts_default_entity_id_fkey ( id, slug )
    `,
    )
    .eq("is_active", true)
    .order("display_name");

  if (slug) query = query.eq("slug", slug);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to load accounts: ${error.message}`);
  return data ?? [];
}

async function loadEntityMap(supabase) {
  const { data, error } = await supabase.from("entities").select("id, slug");
  if (error) throw new Error(`Failed to load entities: ${error.message}`);

  const map = new Map();
  for (const entity of data ?? []) {
    map.set(entity.slug, entity.id);
  }
  return map;
}

function normalizeAccount(account) {
  return {
    ...account,
    default_entity: account.default_entity ?? null,
  };
}

/**
 * C6: load the target account's Plaid cutover, if any. Two flat queries (mirroring run-sync's
 * separate plaid_account_links + bank_connections loads) rather than a nested join, so the shape
 * stays simple and testable. Returns `hasPlaidLink=false` (and syncFromDate=null) for a CSV-only
 * account, in which case the CSV window is left untouched.
 * @returns {Promise<{ hasPlaidLink: boolean, syncFromDate: string | null }>}
 */
export async function loadPlaidCutoverForAccount(supabase, accountId) {
  const { data: links, error: lErr } = await supabase
    .from("plaid_account_links")
    .select("connection_id")
    .eq("account_id", accountId);
  if (lErr) throw new Error(`Failed to load Plaid links: ${lErr.message}`);
  const connectionId = links?.[0]?.connection_id;
  if (!connectionId) return { hasPlaidLink: false, syncFromDate: null };

  const { data: conn, error: cErr } = await supabase
    .from("bank_connections")
    .select("sync_from_date")
    .eq("id", connectionId)
    .single();
  if (cErr) throw new Error(`Failed to load bank connection: ${cErr.message}`);
  return { hasPlaidLink: true, syncFromDate: conn?.sync_from_date ?? null };
}

function resolveSupplementalCsvTexts(known, csvDir = null, manifestEntry = null) {
  if (manifestEntry?.supplementalFiles?.length && csvDir) {
    return manifestEntry.supplementalFiles
      .map((file) => resolve(csvDir, file))
      .filter((path) => existsSync(path))
      .map((path) => readFileSync(path, "utf8"));
  }

  if (!known?.supplementalPaths?.length) return [];

  return known.supplementalPaths
    .map((relativePath) => resolveDefaultPath(relativePath))
    .filter((path) => existsSync(path))
    .map((path) => readFileSync(path, "utf8"));
}

function manifestEntryForSlug(slug, csvDir) {
  if (csvDir !== CSV_2025_2026_DIR) return null;
  return CSV_2025_2026_MANIFEST.find((entry) => entry.slug === slug) ?? null;
}

function resolveCsvPath(known, csvDir, manifestEntry) {
  if (manifestEntry) {
    return resolve(csvDir, manifestEntry.file);
  }
  return resolveDefaultPath(known.defaultPath);
}

function buildSeedDryRunTargets(args) {
  const targets = [];
  for (const account of SEED_ACCOUNTS) {
    if (args.slug && account.slug !== args.slug) continue;
    const manifestEntry = args.csvDir ? manifestEntryForSlug(account.slug, args.csvDir) : null;
    if (args.csvDir && !manifestEntry) continue;
    const csvPath = args.filePath ?? resolveCsvPath(account, args.csvDir, manifestEntry);
    if (!existsSync(csvPath)) {
      console.warn(`Skipping ${account.slug} — file not found: ${csvPath}`);
      continue;
    }
    targets.push({ account, csvPath, known: account, manifestEntry });
  }
  return targets;
}

async function buildDbTargets(supabase, args) {
  if (args.filePath) {
    if (!args.slug) {
      console.error("When importing a single file, pass --account <slug>");
      process.exit(1);
    }

    const accounts = await loadAccounts(supabase, args.slug);
    if (accounts.length !== 1) {
      console.error(`Account not found: ${args.slug}`);
      process.exit(1);
    }

    const known = SEED_ACCOUNT_BY_SLUG.get(args.slug);
    return [
      {
        account: enrichAccountFromSeed(normalizeAccount(accounts[0]), known),
        csvPath: args.filePath,
        known,
        manifestEntry: null,
      },
    ];
  }

  if (args.all || !args.slug) {
    const accounts = await loadAccounts(supabase, args.slug);
    const accountBySlug = new Map(accounts.map((account) => [account.slug, normalizeAccount(account)]));

    const entries = args.csvDir === CSV_2025_2026_DIR ? CSV_2025_2026_MANIFEST : KNOWN_ACCOUNTS.map((known) => ({
      slug: known.slug,
      known,
    }));

    const targets = [];
    for (const entry of entries) {
      const slug = entry.slug;
      const known = entry.known ?? SEED_ACCOUNT_BY_SLUG.get(slug);
      const account = accountBySlug.get(slug);
      if (!account || !known) {
        if (!account) console.warn(`Skipping ${slug} — not in database`);
        continue;
      }

      const manifestEntry = args.csvDir ? entry : null;
      const csvPath = resolveCsvPath(known, args.csvDir, manifestEntry);
      if (!existsSync(csvPath)) {
        console.warn(`Skipping ${slug} — file not found: ${csvPath}`);
        continue;
      }

      targets.push({
        account: enrichAccountFromSeed(account, known, manifestEntry),
        csvPath,
        known,
        manifestEntry,
      });
    }
    return targets;
  }

  const accounts = await loadAccounts(supabase, args.slug);
  const known = KNOWN_ACCOUNTS.find((item) => item.slug === args.slug);
  if (accounts.length !== 1 || !known) {
    console.error(`Unknown account slug: ${args.slug}`);
    process.exit(1);
  }

  const manifestEntry = args.csvDir ? manifestEntryForSlug(args.slug, args.csvDir) : null;
  const csvPath = resolveCsvPath(known, args.csvDir, manifestEntry);
  if (!existsSync(csvPath)) {
    console.error(`CSV not found: ${csvPath}`);
    process.exit(1);
  }

  return [
    {
      account: enrichAccountFromSeed(normalizeAccount(accounts[0]), known, manifestEntry),
      csvPath,
      known,
      manifestEntry,
    },
  ];
}

function enrichAccountFromSeed(account, known, manifestEntry = null) {
  if (!known) return account;

  const mergeParentChild =
    manifestEntry?.supplementalFiles?.length > 0 || known.mergeParentChild === true;

  return {
    ...account,
    mergeParentChild,
    supplementalPaths: known.supplementalPaths ?? [],
  };
}

function buildDryRunEntityMap() {
  const map = new Map();
  for (const account of SEED_ACCOUNTS) {
    map.set(account.default_entity.slug, account.default_entity.slug);
  }
  map.set("gbsl", "gbsl");
  map.set("personal", "personal");
  map.set("keller", "keller");
  map.set("acaa-austin", "acaa-austin");
  return map;
}

function buildImportPlan(account, csvPath, csvText, entityMap, { dryRun = false, supplementalCsvTexts = [], dateFrom = null, dateTo = null } = {}) {
  const parsed = parseCardCsv(csvText, account, { supplementalCsvTexts });
  const rows = [];

  for (const tx of parsed) {
    const entitySlug = resolveEntitySlug(account, tx.transactionDate);
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
        ? { entity_slug: entitySlug, category_id: null, classified_by: "import" }
        : { entity_id: entityId, category_id: null, classified_by: "import" },
      entitySlug,
    });
  }

  // Date window (inclusive lower / EXCLUSIVE upper, matching inDateRange). Applied before dedupe
  // so out-of-window rows never reach the ledger. e.g. --to 2026-06-01 keeps through May 31.
  const windowed =
    dateFrom || dateTo
      ? rows.filter((row) => inDateRange(row.transaction.transaction_date, dateFrom, dateTo))
      : rows;
  const outOfWindow = rows.length - windowed.length;

  const { rows: dedupedRows, skipped: inFileDupes } = dedupeImportPlanRows(account.id, windowed);
  const dates = dedupedRows.map((row) => row.transaction.transaction_date).sort();
  return {
    account,
    csvPath,
    rows: dedupedRows,
    inFileDupes,
    outOfWindow,
    dateMin: dates[0] ?? null,
    dateMax: dates.at(-1) ?? null,
    rawRows: rowsToObjects(parseCsv(csvText)),
  };
}

async function importAccount(supabase, plan, { dryRun = false, storeRaw = true } = {}) {
  const { account, csvPath, rows, dateMin, dateMax, rawRows, inFileDupes = 0, outOfWindow = 0 } = plan;

  console.log(`\n${account.display_name} (${account.slug})`);
  console.log(`  File: ${basename(csvPath)}`);
  console.log(`  Parsed rows: ${rows.length}`);
  if (outOfWindow > 0) console.log(`  Out-of-window skipped (date filter): ${outOfWindow}`);
  if (inFileDupes > 0) console.log(`  In-file dupes skipped: ${inFileDupes}`);
  const refundCount = rows.filter((row) => Number(row.transaction.amount) < 0).length;
  if (refundCount > 0) console.log(`  Refunds/credits (negative): ${refundCount}`);
  if (dateMin) console.log(`  Date range: ${dateMin} → ${dateMax}`);

  if (dryRun) {
    const entityCounts = new Map();
    for (const row of rows) {
      entityCounts.set(row.entitySlug, (entityCounts.get(row.entitySlug) ?? 0) + 1);
    }
    for (const [slug, count] of [...entityCounts.entries()].sort()) {
      console.log(`  Entity ${slug}: ${count}`);
    }
    return { inserted: 0, skipped: 0, dryRun: true, refundCount };
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

    const { data: upserted, error: txError } = await supabase
      .from("transactions")
      .upsert(txPayload, { onConflict: "account_id,import_hash", ignoreDuplicates: true })
      .select("id, import_hash");

    if (txError) {
      throw new Error(`Transaction upsert failed: ${txError.message}`);
    }

    const hashToEntity = new Map(
      batchRows.map((row) => [row.transaction.import_hash, row.classification.entity_id]),
    );

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

      if (classError) {
        throw new Error(`Classification upsert failed: ${classError.message}`);
      }
    }
  }

  const { count: afterCount } = await supabase
    .from("transactions")
    .select("*", { count: "exact", head: true })
    .eq("account_id", account.id);

  const inserted = (afterCount ?? 0) - (beforeCount ?? 0);
  const skipped = existingDupes + rowsToImport.length - inserted;

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

  console.log(`  Inserted: ${inserted}, skipped (dupes): ${skipped}`);
  return { inserted, skipped, batchId: batch.id };
}

async function printVerificationReport(supabase) {
  const { data: accounts, error } = await supabase
    .from("accounts")
    .select("id, slug, display_name")
    .order("display_name");

  if (error) throw new Error(error.message);

  console.log("\n=== Verification ===");

  for (const account of accounts ?? []) {
    const { data: txs, error: txError } = await supabase
      .from("transactions")
      .select("transaction_date, classifications(category_id, entity_id)")
      .eq("account_id", account.id)
      .order("transaction_date");

    if (txError) {
      console.log(`${account.display_name}: error — ${txError.message}`);
      continue;
    }

    const count = txs?.length ?? 0;
    const dates = (txs ?? []).map((tx) => tx.transaction_date).sort();
    const unclassifiedCategory = (txs ?? []).filter(
      (tx) => !tx.classifications?.[0]?.category_id,
    ).length;

    console.log(
      `${account.display_name}: ${count} tx | ${dates[0] ?? "—"} → ${dates.at(-1) ?? "—"} | category-null: ${unclassifiedCategory}`,
    );
  }
}

// isMain guard: importing this module (e.g. to test parseArgs) must NOT run the script.
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  await run();
}

async function run() {
const args = parseArgs(process.argv);

if (args.dryRun) {
  const targets = buildSeedDryRunTargets(args);

  if (targets.length === 0) {
    console.error("No CSV targets found for dry-run");
    process.exit(1);
  }

  const entityMap = buildDryRunEntityMap();
  console.log(`Import mode: dry-run (no database)`);
  if (args.csvDir) console.log(`CSV dir: ${args.csvDir}`);
  if (args.dateFrom || args.dateTo)
    console.log(`Date window: ${args.dateFrom ?? "(open)"} ≤ d < ${args.dateTo ?? "(open)"}`);
  console.log(`Targets: ${targets.length}`);
  // C6 caveat: the Plaid-cutover cap is a DB read (plaid_account_links + bank_connections), and the
  // dry-run path runs on seed data with no supabase client — so it can't apply the cap here. Warn that
  // --apply will exclude CSV rows on/after a Plaid-linked account's cutover, so this preview's row
  // count can overstate what --apply actually writes. (No ledger impact — dry-run writes nothing.)
  if (!args.force) {
    console.log(
      `Note: Plaid-linked accounts are capped at their cutover on --apply — dry-run cannot read links, so counts here may overstate what --apply writes (pass --force to import over the cutover anyway).`,
    );
  }

  let total = 0;
  let totalRefunds = 0;
  const exportRows = [];
  for (const target of targets) {
    const csvText = readFileSync(target.csvPath, "utf8");
    const supplementalCsvTexts = resolveSupplementalCsvTexts(
      target.known,
      args.csvDir,
      target.manifestEntry,
    );
    const plan = buildImportPlan(target.account, target.csvPath, csvText, entityMap, {
      dryRun: true,
      supplementalCsvTexts,
      dateFrom: args.dateFrom,
      dateTo: args.dateTo,
    });
    const result = await importAccount(null, plan, { dryRun: true });
    total += plan.rows.length;
    totalRefunds += result.refundCount ?? 0;
    if (args.exportJson) {
      for (const row of plan.rows) {
        exportRows.push({
          account_slug: target.account.slug,
          entity_slug: row.entitySlug,
          transaction_date: row.transaction.transaction_date,
          posted_date: row.transaction.posted_date,
          amount: row.transaction.amount,
          description: row.transaction.description,
          vendor: row.transaction.vendor,
          import_hash: row.transaction.import_hash,
        });
      }
    }
  }

  console.log(`\nDone. Total rows: ${total} (${totalRefunds} refunds/credits)`);
  if (args.exportJson) {
    exportRows.sort(
      (a, b) =>
        a.account_slug.localeCompare(b.account_slug) ||
        a.transaction_date.localeCompare(b.transaction_date),
    );
    writeFileSync(args.exportJson, JSON.stringify(exportRows, null, 2));
    console.log(`Exported ${exportRows.length} rows → ${args.exportJson}`);
  }
  process.exit(0);
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL in .env.local");
  process.exit(1);
}

if (!serviceKey && !args.dryRun && !args.verifyOnly) {
  console.error("Set SUPABASE_SERVICE_ROLE_KEY in .env.local for imports (server-only, never commit)");
  console.error("Or run with --dry-run to parse without writing.");
  process.exit(1);
}

const supabase = createClient(url, serviceKey ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

if (args.verifyOnly) {
  await printVerificationReport(supabase);
  process.exit(0);
}

const entityMap = await loadEntityMap(supabase);

const targets = await buildDbTargets(supabase, args);

if (targets.length === 0) {
  console.error("No import targets. Use --all or --account <slug> [--file path.csv] [--csv-dir dir]");
  process.exit(1);
}

console.log(`Import mode: ${args.dryRun ? "dry-run" : "write"}`);
if (args.csvDir) console.log(`CSV dir: ${args.csvDir}`);
if (args.dateFrom || args.dateTo)
  console.log(`Date window: ${args.dateFrom ?? "(open)"} ≤ d < ${args.dateTo ?? "(open)"}`);
console.log(`Targets: ${targets.length}`);

const results = [];

for (const target of targets) {
  const csvText = readFileSync(target.csvPath, "utf8");
  const supplementalCsvTexts = resolveSupplementalCsvTexts(
    target.known,
    args.csvDir,
    target.manifestEntry,
  );

  // C6: if this account is Plaid-linked, cap the CSV window at the day before its Plaid cutover so
  // CSV rows can't re-import a window Plaid already owns (CSV descriptors won't business-key-match
  // Plaid's raw ones → duplicates). --force bypasses (deliberate CSV backfill over Plaid's window).
  const { hasPlaidLink, syncFromDate } = await loadPlaidCutoverForAccount(
    supabase,
    target.account.id,
  );
  const { effectiveTo, capped } = capCsvWindowForPlaid({
    requestedTo: args.dateTo,
    syncFromDate,
    hasPlaidLink,
    force: args.force,
  });
  if (capped) {
    console.log(
      `  ${target.account.slug}: Plaid-linked (cutover ${syncFromDate}) — capping CSV window to < ${effectiveTo} (rows on/after ${syncFromDate} are Plaid's; pass --force to override)`,
    );
  }

  const plan = buildImportPlan(target.account, target.csvPath, csvText, entityMap, {
    dryRun: false,
    supplementalCsvTexts,
    dateFrom: args.dateFrom,
    dateTo: effectiveTo,
  });
  const result = await importAccount(supabase, plan, { dryRun: args.dryRun });
  results.push({
    slug: target.account.slug,
    ...result,
    count: plan.rows.length,
    dateMin: plan.dateMin,
    dateMax: plan.dateMax,
  });
}

if (!args.dryRun) {
  await printVerificationReport(supabase);
}

console.log("\nDone.");
for (const result of results) {
  console.log(
    `  ${result.slug}: ${result.count} parsed${result.dryRun ? " (dry-run)" : `, ${result.inserted} inserted, ${result.skipped} dupes`}`,
  );
}
}
