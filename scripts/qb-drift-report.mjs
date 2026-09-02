#!/usr/bin/env node
/**
 * GBSL ↔ QuickBooks Online drift report. READ ONLY — never writes to Supabase or QBO.
 *
 * Compares Alex's GBSL classification in Hundie against the accountant's QBO books and writes a
 * standalone HTML page (plus an optional JSON sidecar / body-only fragment for artifact publishing).
 *
 * Usage:
 *   node scripts/qb-drift-report.mjs --file "~/Downloads/Gracie Barra Southlake_Transaction Detail by Account.csv"
 *   node scripts/qb-drift-report.mjs --file <csv> --from 2026-01-01 --to 2026-09-02 --date-slack 5 \
 *        --out ~/Downloads/GBSL-QB-drift-2026-09-02.html --json ./drift.json --fragment ./drift-fragment.html
 *
 * Defaults: period = the export's own period (row 3 of the CSV); out = ~/Downloads/GBSL-QB-drift-<to>.html.
 * Spec: docs/superpowers/specs/2026-09-02-qb-drift-report-design.md
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeDrift, hundieCategoryKind, parseQboDriftRows } from "./lib/qb-drift.mjs";
import { renderDriftDocument, renderDriftFragment } from "./lib/qb-drift-html.mjs";

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

const args = process.argv.slice(2);
function argValue(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}
function expandHome(p) {
  return p?.startsWith("~/") ? resolve(process.env.HOME ?? "", p.slice(2)) : p;
}

const csvPath = expandHome(argValue("--file"));
if (!csvPath || !existsSync(resolve(csvPath))) {
  console.error("Usage: node scripts/qb-drift-report.mjs --file <QBO Transaction Detail by Account .csv> [--from] [--to] [--date-slack 5] [--out] [--json] [--fragment]");
  process.exit(1);
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const supabase = createClient(url, serviceKey);

const { data: entity, error: entityError } = await supabase.from("entities").select("id, name").eq("slug", "gbsl").single();
if (entityError || !entity) {
  console.error("Could not load GBSL entity:", entityError?.message ?? "not found");
  process.exit(1);
}

const [{ data: categories, error: catError }, { data: accountRows, error: accError }] = await Promise.all([
  supabase.from("categories").select("full_path, kind, is_active").eq("entity_id", entity.id).order("full_path"),
  supabase.from("accounts").select("slug, display_name, default_entity:entities(slug)"),
]);
if (catError || accError) {
  console.error("Failed to load chart/accounts:", catError?.message ?? accError?.message);
  process.exit(1);
}
const accounts = (accountRows ?? []).map((a) => ({
  slug: a.slug,
  display_name: a.display_name,
  default_entity_slug: a.default_entity?.slug ?? null,
}));

const csvText = readFileSync(resolve(csvPath), "utf8");
const qbo = parseQboDriftRows(csvText, { hundieCategories: categories ?? [] });

const today = new Date();
const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
const from = argValue("--from") ?? qbo.meta.period?.from ?? "2026-01-01";
const to = argValue("--to") ?? qbo.meta.period?.to ?? todayIso;
const dateSlack = Number(argValue("--date-slack") ?? 5);

async function fetchAll(build) {
  const pageSize = 1000;
  const all = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await build().range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    all.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

const unsplit = await fetchAll(() =>
  supabase
    .from("transactions")
    .select(
      `id, transaction_date, amount, description, vendor,
       account:accounts(slug, display_name),
       classification:classifications!inner(entity_id, category:categories(full_path))`,
    )
    .eq("classification.entity_id", entity.id)
    .is("split_at", null)
    .gte("transaction_date", from)
    .lte("transaction_date", to)
    .order("transaction_date")
    .order("id"),
);

const legs = await fetchAll(() =>
  supabase
    .from("transaction_splits")
    .select(
      `id, amount, category:categories(full_path),
       transaction:transactions!inner(id, transaction_date, description, vendor, account:accounts(slug, display_name))`,
    )
    .eq("entity_id", entity.id)
    .gte("transaction.transaction_date", from)
    .lte("transaction.transaction_date", to)
    .order("id"),
);

const hundieRows = [
  ...unsplit.map((t) => ({
    id: t.id,
    date: t.transaction_date,
    amount: Number(t.amount),
    description: t.description ?? "",
    vendor: t.vendor ?? "",
    accountSlug: t.account?.slug ?? "(unknown)",
    accountName: t.account?.display_name ?? t.account?.slug ?? "(unknown)",
    category: t.classification?.category?.full_path ?? null,
    kind: hundieCategoryKind(t.classification?.category?.full_path ?? null),
    isSplitLeg: false,
  })),
  ...legs.map((s) => ({
    id: `split-${s.id}`,
    date: s.transaction.transaction_date,
    amount: Number(s.amount),
    description: s.transaction.description ?? "",
    vendor: s.transaction.vendor ?? "",
    accountSlug: s.transaction.account?.slug ?? "(unknown)",
    accountName: s.transaction.account?.display_name ?? "(unknown)",
    category: s.category?.full_path ?? null,
    kind: hundieCategoryKind(s.category?.full_path ?? null),
    isSplitLeg: true,
    parentId: s.transaction.id,
  })),
];

const report = analyzeDrift({
  qboRows: qbo.rows,
  hundieRows,
  hundieCategories: categories ?? [],
  accounts,
  options: { from, to, dateSlack },
});
report.meta = {
  ...report.meta,
  generatedAt: new Date().toISOString(),
  qboFile: csvPath.split("/").pop(),
  company: qbo.meta.company,
  basis: qbo.meta.basis,
  periodText: qbo.meta.periodText,
  unmappedQboSections: qbo.meta.unmappedPaymentSections,
  dropped: qbo.meta.dropped,
  hundieSplitLegs: legs.length,
};

const outPath = expandHome(argValue("--out")) ?? resolve(process.env.HOME ?? "", `Downloads/GBSL-QB-drift-${to}.html`);
mkdirSync(dirname(resolve(outPath)), { recursive: true });
writeFileSync(resolve(outPath), renderDriftDocument(report));
console.log(`Wrote ${outPath}`);

const jsonPath = expandHome(argValue("--json"));
if (jsonPath) {
  writeFileSync(resolve(jsonPath), JSON.stringify(report, null, 2));
  console.log(`Wrote ${jsonPath}`);
}
const fragmentPath = expandHome(argValue("--fragment"));
if (fragmentPath) {
  writeFileSync(resolve(fragmentPath), renderDriftFragment(report));
  console.log(`Wrote ${fragmentPath}`);
}

const t = report.totals;
console.log(`\nGBSL ↔ QBO drift ${from} → ${to} (slack ±${dateSlack}d, ${qbo.meta.basis ?? "?"} basis)`);
console.log(`  Hundie in scope: ${t.hundie.inScope} rows  (${t.hundie.unreachableRows} on cards QBO does not have)`);
console.log(`  QBO in scope:    ${t.qbo.inScope} rows  (transfer mirrors dropped: ${report.meta.dropped.ownTransferMirror.rows}, unresolved splits: ${report.meta.dropped.unresolvedSplits})`);
console.log(`  Paired: ${t.paired}  agree ${t.buckets.agree} · differ ${t.buckets.differ} · kind ${t.buckets.kindDiffer} · QBO asks ${t.buckets.qboAsks} · Hundie review ${t.buckets.hundieReview}`);
console.log(`  Only in Hundie: ${t.buckets.onlyHundie}   Only in QBO: ${t.buckets.onlyQbo}   cross-account pairs: ${t.accountMismatchPairs}`);
if (report.meta.unmappedQboSections.length) {
  console.log(`  ⚠ Unmapped QBO payment sections (ignored): ${report.meta.unmappedQboSections.join(", ")}`);
}
