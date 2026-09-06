#!/usr/bin/env node
/**
 * One-time backfill of hundie-amazon-match review decisions into the Amazon desk.
 *
 * Ledger entity/category (and splits) were often already applied via SQL. This
 * script links those charges to shipments, writes item-summary + order-URL
 * notes, and marks amazon_charge_links confirmed so they leave the Open queue.
 *
 * Does not commit Order History / decisions JSON into this repo.
 *
 * Usage:
 *   node scripts/backfill-amazon-decisions.mjs --dry-run
 *   node scripts/backfill-amazon-decisions.mjs --apply
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const envPath = resolve(root, ".env.local");
const defaultReady = resolve(root, "../hundie-amazon-match/data/import_ready.json");
const defaultMatches = resolve(root, "../hundie-amazon-match/data/matches.json");

function loadEnv() {
  if (!existsSync(envPath)) {
    console.error("Missing .env.local");
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

function argValue(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function chunk(items, size = 100) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function orderDetailsUrl(orderId) {
  return `https://www.amazon.com/gp/your-account/order-details?orderID=${encodeURIComponent(orderId)}`;
}

function notesFromShipment(shipment, extra) {
  const items = shipment?.items ?? [];
  const labels = items
    .map((i) => String(i.product ?? "").trim())
    .filter(Boolean)
    .map((p) => (p.length > 60 ? `${p.slice(0, 57)}…` : p));
  const orderId = shipment?.order_id;
  const url = shipment?.order_url || (orderId ? orderDetailsUrl(orderId) : null);
  let summary;
  if (labels.length === 0) {
    summary = orderId ? `Amazon order ${orderId}` : null;
  } else if (labels.length <= 4) {
    summary = labels.join("; ");
  } else {
    summary = `${labels.slice(0, 4).join("; ")} (+${labels.length - 4} more)`;
  }
  const auto = [summary, url].filter(Boolean).join("\n");
  const extraText = extra?.trim() || "";
  if (extraText && auto) return `${extraText}\n${auto}`;
  return extraText || auto || null;
}

function alreadyHasOrderUrl(notes) {
  return /amazon\.com\/gp\/your-account\/order-details/i.test(notes ?? "");
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const dryRun = !apply;
const readyPath = argValue("--file") ?? defaultReady;
const matchesPath = argValue("--matches") ?? defaultMatches;

if (!existsSync(readyPath)) {
  console.error(`Missing decisions file: ${readyPath}`);
  process.exit(1);
}

const bundle = JSON.parse(readFileSync(readyPath, "utf8"));
const matches = existsSync(matchesPath)
  ? JSON.parse(readFileSync(matchesPath, "utf8"))
  : { results: [] };

const matchByTxn = new Map();
const shipmentsByKey = new Map();
for (const row of matches.results ?? []) {
  matchByTxn.set(row.txn_id, row);
  for (const ship of row.matched ?? []) {
    if (ship?.shipment_key) shipmentsByKey.set(ship.shipment_key, ship);
  }
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const supabase = createClient(url, serviceKey);

const decisions = bundle.decisions ?? [];
const kept = bundle.reviewed_no_change ?? [];
console.log(
  `${dryRun ? "DRY-RUN" : "APPLY"} ${decisions.length} decisions + ${kept.length} reviewed-no-change from ${readyPath}`,
);
console.log(`Unique matched shipments in matches.json: ${shipmentsByKey.size}`);

const shipRows = [...shipmentsByKey.values()].map((s) => ({
  shipment_key: s.shipment_key,
  order_id: s.order_id,
  ship_date: s.ship_date || null,
  order_date: s.order_date || null,
  amounts: s.amounts ?? {},
  payment_method: s.payment || null,
  last4: s.last4 || null,
  store_card: Boolean(s.store_card),
  is_digital: Boolean(s.digital),
  order_url: s.order_url || orderDetailsUrl(s.order_id),
}));

if (apply && shipRows.length) {
  const { data: batch, error: batchErr } = await supabase
    .from("amazon_import_batches")
    .insert({
      source: "personal_export",
      file_name: "hundie-amazon-match backfill",
      item_count: shipRows.reduce((n, s) => n + (shipmentsByKey.get(s.shipment_key)?.items?.length ?? 0), 0),
      shipment_count: shipRows.length,
      uploaded_by: "amazon-desk-backfill",
    })
    .select("id")
    .single();
  if (batchErr || !batch) {
    console.error("Failed to create import batch", batchErr?.message);
    process.exit(1);
  }

  const keyToId = new Map();
  for (const part of chunk(shipRows, 80)) {
    const rows = part.map((s) => ({ ...s, import_batch_id: batch.id, updated_at: new Date().toISOString() }));
    const { data, error } = await supabase
      .from("amazon_shipments")
      .upsert(rows, { onConflict: "shipment_key" })
      .select("id, shipment_key");
    if (error) {
      console.error("Shipment upsert failed", error.message);
      process.exit(1);
    }
    for (const row of data ?? []) keyToId.set(row.shipment_key, row.id);
  }

  const shipmentIds = [...keyToId.values()];
  for (const idPart of chunk(shipmentIds, 200)) {
    const { error } = await supabase.from("amazon_shipment_items").delete().in("shipment_id", idPart);
    if (error) {
      console.error("Item delete failed", error.message);
      process.exit(1);
    }
  }

  const itemRows = [];
  for (const s of shipmentsByKey.values()) {
    const id = keyToId.get(s.shipment_key);
    if (!id) continue;
    (s.items ?? []).forEach((item, sortIndex) => {
      itemRows.push({
        shipment_id: id,
        asin: item.asin || null,
        product_name: item.product || "",
        quantity: item.quantity ?? 1,
        unit_price_cents: item.unit_price_cents ?? null,
        unit_tax_cents: null,
        line_total_cents:
          item.unit_price_cents != null ? item.unit_price_cents * (item.quantity ?? 1) : null,
        asin_url: item.url || (item.asin ? `https://www.amazon.com/dp/${item.asin}` : null),
        sort_index: sortIndex,
      });
    });
  }
  for (const part of chunk(itemRows, 200)) {
    const { error } = await supabase.from("amazon_shipment_items").insert(part);
    if (error) {
      console.error("Item insert failed", error.message);
      process.exit(1);
    }
  }
  console.log(`Imported ${shipRows.length} shipments (${itemRows.length} items) as batch ${batch.id}`);
} else if (dryRun) {
  console.log(`Would import ${shipRows.length} shipments (from matches.json).`);
}

const { data: existingShips, error: existShipErr } = await supabase
  .from("amazon_shipments")
  .select("id, shipment_key");
if (existShipErr) {
  console.error(existShipErr.message);
  process.exit(1);
}
const liveKeyToId = new Map((existingShips ?? []).map((r) => [r.shipment_key, r.id]));

function resolveShipment(decision, txnId) {
  const key =
    decision.evidence?.shipment_key ||
    matchByTxn.get(txnId)?.matched?.[0]?.shipment_key ||
    null;
  const orderId = decision.evidence?.order_ids?.[0] ?? matchByTxn.get(txnId)?.matched?.[0]?.order_id;
  const fromMatch = (key && shipmentsByKey.get(key)) || matchByTxn.get(txnId)?.matched?.[0] || null;
  const shipmentId = key ? liveKeyToId.get(key) ?? null : null;
  return { key, orderId, shipment: fromMatch, shipmentId };
}

const stats = {
  wholeAlready: 0,
  wholeWouldUpdate: 0,
  splitAlready: 0,
  splitWouldApply: 0,
  notesWouldWrite: 0,
  links: 0,
  missingTxn: 0,
  kept: 0,
};

async function loadLedger(txnIds) {
  const map = new Map();
  for (const part of chunk(txnIds, 200)) {
    const { data, error } = await supabase
      .from("transactions")
      .select("id, amount, split_at, classifications ( id, entity_id, category_id, notes )")
      .in("id", part);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const cls = Array.isArray(row.classifications) ? row.classifications[0] : row.classifications;
      map.set(row.id, { ...row, classification: cls });
    }
  }
  return map;
}

const allIds = [...decisions.map((d) => d.transaction_id), ...kept.map((d) => d.transaction_id)];
const ledger = await loadLedger(allIds);

const classificationUpdates = [];
const noteUpdates = [];
const splitJobs = [];
const links = [];

for (const dec of decisions) {
  const txn = ledger.get(dec.transaction_id);
  if (!txn?.classification) {
    stats.missingTxn += 1;
    continue;
  }
  const { key, orderId, shipment, shipmentId } = resolveShipment(dec, dec.transaction_id);
  const extra = dec.note || null;
  const nextNotes = notesFromShipment(shipment ?? { order_id: orderId, order_url: orderId ? orderDetailsUrl(orderId) : null, items: [] }, extra);

  if (dec.mode === "split") {
    if (txn.split_at) stats.splitAlready += 1;
    else {
      stats.splitWouldApply += 1;
      splitJobs.push({
        transactionId: dec.transaction_id,
        parentAmount: Number(txn.amount),
        legs: dec.splits,
      });
    }
  } else {
    const same =
      txn.classification.entity_id === dec.entity_id &&
      txn.classification.category_id === dec.category_id;
    if (same) stats.wholeAlready += 1;
    else {
      stats.wholeWouldUpdate += 1;
      classificationUpdates.push({
        id: txn.classification.id,
        entity_id: dec.entity_id,
        category_id: dec.category_id,
      });
    }
  }

  if (nextNotes && !alreadyHasOrderUrl(txn.classification.notes)) {
    stats.notesWouldWrite += 1;
    noteUpdates.push({ id: txn.classification.id, notes: nextNotes });
  }

  stats.links += 1;
  links.push({
    transaction_id: dec.transaction_id,
    shipment_id: shipmentId,
    match_tier: dec.evidence?.match_tier === "A" || key ? "A" : "manual",
    match_hypothesis: key ?? null,
    status: "confirmed",
    reviewed_by: dec.reviewer ?? "amazon-desk-backfill",
    reviewed_at: dec.decided_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
    candidates: [],
  });
}

for (const dec of kept) {
  const txn = ledger.get(dec.transaction_id);
  if (!txn?.classification) {
    stats.missingTxn += 1;
    continue;
  }
  stats.kept += 1;
  const { key, orderId, shipment, shipmentId } = resolveShipment(dec, dec.transaction_id);
  const nextNotes = notesFromShipment(
    shipment ?? { order_id: orderId, order_url: orderId ? orderDetailsUrl(orderId) : null, items: [] },
    null,
  );
  if (nextNotes && !alreadyHasOrderUrl(txn.classification.notes)) {
    stats.notesWouldWrite += 1;
    noteUpdates.push({ id: txn.classification.id, notes: nextNotes });
  }
  stats.links += 1;
  links.push({
    transaction_id: dec.transaction_id,
    shipment_id: shipmentId,
    match_tier: key ? "A" : "manual",
    match_hypothesis: key ?? "reviewed_no_change",
    status: "confirmed",
    reviewed_by: dec.reviewer ?? "amazon-desk-backfill",
    reviewed_at: dec.reviewed_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
    candidates: [],
  });
}

console.log(stats);
if (dryRun) {
  console.log("Re-run with --apply to write shipments, notes, and confirmed charge links.");
  process.exit(0);
}

for (const u of classificationUpdates) {
  const { error } = await supabase
    .from("classifications")
    .update({
      entity_id: u.entity_id,
      category_id: u.category_id,
      classified_by: "amazon-desk-backfill",
      classified_at: new Date().toISOString(),
    })
    .eq("id", u.id);
  if (error) {
    console.error("Classification update failed", u.id, error.message);
    process.exit(1);
  }
}

for (const job of splitJobs) {
  const sign = job.parentAmount < 0 ? -1 : 1;
  const { error } = await supabase.rpc("apply_transaction_split", {
    p_transaction_id: job.transactionId,
    p_legs: job.legs.map((l) => ({
      entity_id: l.entity_id,
      category_id: l.category_id,
      amount: sign * Math.abs(Number(l.amount)),
    })),
  });
  if (error) {
    console.error("Split failed", job.transactionId, error.message);
    process.exit(1);
  }
}

for (const u of noteUpdates) {
  const { error } = await supabase
    .from("classifications")
    .update({ notes: u.notes })
    .eq("id", u.id);
  if (error) {
    console.error("Notes update failed", u.id, error.message);
    process.exit(1);
  }
}

for (const part of chunk(links, 80)) {
  const { error } = await supabase.from("amazon_charge_links").upsert(part, { onConflict: "transaction_id" });
  if (error) {
    console.error("Charge link upsert failed", error.message);
    process.exit(1);
  }
}

console.log("Backfill applied.");
