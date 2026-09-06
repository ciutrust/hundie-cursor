/**
 * Parse Amazon "Your Orders" personal data export (CSV or zip).
 * Ported from hundie-amazon-match/match.py — shipment = (order_id, ship_date).
 */

import { unzipSync, strFromU8 } from "fflate";
import { asinUrl, orderDetailsUrl } from "@/lib/amazon/detect";
import type { AmazonOrderItem, AmazonShipment, ParsedAmazonExport } from "@/lib/amazon/types";

const STORE_CARD = /amazonplcc|store\s*card/i;
const PREFER = /order[\s._-]*history/i;
const EXCLUDE =
  /return|refund|cancel|wishlist|registry|review|browse|search|pageview|advertis|subscription|kindle|audible|prime.?video|watch|cart|delivery.?photo|borrowed|rental|payment.?plan/i;

const COLUMN_ALIASES: Record<string, string[]> = {
  order_id: ["orderid", "amazonorderid", "orderidentifier"],
  order_date: ["orderdate", "orderplaceddate"],
  ship_date: ["shipdate", "shipmentdate"],
  asin: ["asin", "asinisbn", "asinisbn13"],
  product: ["productname", "title", "itemname"],
  quantity: ["originalquantity", "quantity", "qty", "quantityshipped"],
  unit_price: ["unitprice", "perunitprice", "itemprice"],
  unit_tax: ["unitpricetax", "itempricetax"],
  total_owed: ["totalamount", "totalowed", "totalchargedtocard", "ordertotal"],
  shipment_subtotal: ["shipmentitemsubtotal", "itemsubtotal"],
  shipment_subtotal_tax: ["shipmentitemsubtotaltax", "itemsubtotaltax"],
  payment: ["paymentmethodtype", "paymentinstrumenttype", "paymentmethod"],
  shipping: ["shippingcharge"],
  discounts: ["totaldiscounts"],
  status: ["orderstatus", "shipmentstatus"],
};

function normHeader(name: string): string {
  return (name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildColumnMap(fieldnames: string[]): Record<string, string> {
  const normalized = new Map(fieldnames.map((f) => [normHeader(f), f]));
  const mapping: Record<string, string> = {};
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const alias of aliases) {
      const real = normalized.get(alias);
      if (real) {
        mapping[key] = real;
        break;
      }
    }
  }
  return mapping;
}

export function parseMoneyToCents(value: unknown): number | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const cleaned = text.replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === "." || cleaned === "-.") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function parseAmazonDate(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const day = text.split(/[T ]/)[0] ?? "";
  const iso = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = day.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (us) {
    const mm = us[1]!.padStart(2, "0");
    const dd = us[2]!.padStart(2, "0");
    let yyyy = us[3]!;
    if (yyyy.length === 2) yyyy = `20${yyyy}`;
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.length > 0)) rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    if (row.some((c) => c.length > 0)) rows.push(row);
  }
  if (rows.length === 0) return [];
  const headers = rows[0]!.map((h) => h.replace(/^\uFEFF/, ""));
  return rows.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]!] = cells[i] ?? "";
    }
    return obj;
  });
}

function preferOrderHistoryPaths(paths: string[]): { chosen: string[]; ignored: string[] } {
  const preferred = paths.filter((p) => PREFER.test(p.split("/").pop() ?? ""));
  if (preferred.length) {
    return { chosen: preferred, ignored: paths.filter((p) => !preferred.includes(p)) };
  }
  const chosen = paths.filter((p) => !EXCLUDE.test(p.split("/").pop() ?? ""));
  return { chosen, ignored: paths.filter((p) => !chosen.includes(p)) };
}

function get(row: Record<string, string>, cols: Record<string, string>, key: string): string {
  const col = cols[key];
  return col ? (row[col] ?? "") : "";
}

function rowToItem(row: Record<string, string>, cols: Record<string, string>): AmazonOrderItem | null {
  const orderId = get(row, cols, "order_id").trim();
  if (!orderId) return null;
  const status = get(row, cols, "status").trim();
  if (/cancel/i.test(status)) return null;

  const shipDate = parseAmazonDate(get(row, cols, "ship_date"));
  const orderDate = parseAmazonDate(get(row, cols, "order_date"));
  const qtyRaw = get(row, cols, "quantity").trim() || "1";
  const quantity = Math.max(1, Math.round(Number(qtyRaw)) || 1);
  const payment = get(row, cols, "payment").trim();
  const last4Match = payment.match(/(\d{4})\s*$/);

  return {
    orderId,
    orderDate,
    shipDate: shipDate ?? orderDate,
    asin: get(row, cols, "asin").trim(),
    product: get(row, cols, "product").trim(),
    quantity,
    unitPriceCents: parseMoneyToCents(get(row, cols, "unit_price")),
    unitTaxCents: parseMoneyToCents(get(row, cols, "unit_tax")),
    totalOwedCents: parseMoneyToCents(get(row, cols, "total_owed")),
    shippingCents: parseMoneyToCents(get(row, cols, "shipping")),
    discountsCents: parseMoneyToCents(get(row, cols, "discounts")),
    shipSubtotalCents: parseMoneyToCents(get(row, cols, "shipment_subtotal")),
    shipSubtotalTaxCents: parseMoneyToCents(get(row, cols, "shipment_subtotal_tax")),
    payment,
    last4: last4Match?.[1] ?? null,
    status,
  };
}

export function groupShipments(items: AmazonOrderItem[]): AmazonShipment[] {
  const groups = new Map<string, AmazonOrderItem[]>();
  for (const item of items) {
    const key = `${item.orderId}|${item.shipDate ?? ""}`;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }

  const shipments: AmazonShipment[] = [];
  for (const [shipmentKey, group] of groups) {
    const owed = group.map((i) => i.totalOwedCents).filter((v): v is number => v != null);
    const subtotals = group.map((i) => i.shipSubtotalCents).filter((v): v is number => v != null);
    const subtotalTaxes = group
      .map((i) => i.shipSubtotalTaxCents)
      .filter((v): v is number => v != null);

    let lineTotal = 0;
    for (const i of group) {
      if (i.unitPriceCents != null) {
        lineTotal += i.unitPriceCents * i.quantity;
        if (i.unitTaxCents != null) lineTotal += i.unitTaxCents * i.quantity;
      }
    }
    // Shipping is often repeated on every line; take max abs as the shipment shipping charge.
    const shipCharges = group
      .map((i) => i.shippingCents)
      .filter((v): v is number => v != null && v !== 0);
    const shippingCents = shipCharges.length
      ? Math.max(...shipCharges.map((c) => Math.abs(c))) * Math.sign(shipCharges[0]!)
      : 0;
    const discountCents = group.reduce((s, i) => s + (i.discountsCents ?? 0), 0);

    const amounts: Record<string, number> = {};
    if (owed.length) {
      amounts.owed_first = owed[0]!;
      // When Total Amount is repeated on every row, summing invents phantom charges.
      if (owed.length > 1 && new Set(owed).size === 1) {
        amounts.owed_repeated = owed[0]!;
      } else if (owed.length > 1) {
        amounts.owed_sum = owed.reduce((a, b) => a + b, 0);
      }
    }
    if (subtotals.length) {
      amounts.subtotal_sum =
        subtotals.reduce((a, b) => a + b, 0) + subtotalTaxes.reduce((a, b) => a + b, 0);
    }
    if (lineTotal) {
      amounts.line_total = lineTotal;
      if (shippingCents || discountCents) {
        amounts.line_total_net = lineTotal + shippingCents + discountCents;
      }
    }

    const last4s = new Set(group.map((i) => i.last4).filter(Boolean) as string[]);
    const first = group[0]!;

    shipments.push({
      shipmentKey,
      orderId: first.orderId,
      shipDate: first.shipDate,
      orderDate: first.orderDate,
      amounts,
      payment: first.payment,
      last4: last4s.size === 1 ? [...last4s][0]! : null,
      storeCard: STORE_CARD.test(first.payment),
      digital: false,
      orderUrl: orderDetailsUrl(first.orderId),
      items: group.map((i) => {
        const line =
          i.unitPriceCents != null
            ? i.unitPriceCents * i.quantity + (i.unitTaxCents ?? 0) * i.quantity
            : i.totalOwedCents;
        return {
          asin: i.asin,
          product: i.product,
          quantity: i.quantity,
          unitPriceCents: i.unitPriceCents,
          unitTaxCents: i.unitTaxCents,
          lineTotalCents: line,
          asinUrl: asinUrl(i.asin),
        };
      }),
    });
  }
  return shipments;
}

function loadDigitalFromCsvText(text: string): AmazonShipment[] {
  const rows = parseCsv(text);
  const groups = new Map<string, Array<{ asin: string; product: string; amount: number }>>();
  for (const row of rows) {
    const orderId = (row["Order ID"] ?? "").trim();
    const when = parseAmazonDate(row["Order Date"]);
    if (!orderId || !when) continue;
    const status = (row["Order Status"] ?? "").trim().toUpperCase();
    if (status && status !== "SUCCESS") continue;
    let amount = parseMoneyToCents(row["Transaction Amount"]);
    if (amount == null) {
      amount = (parseMoneyToCents(row["Price"]) ?? 0) + (parseMoneyToCents(row["Price Tax"]) ?? 0);
    }
    const key = `${orderId}|${when}`;
    const list = groups.get(key) ?? [];
    list.push({
      asin: (row["ASIN"] ?? "").trim(),
      product: (row["Product Name"] ?? "").trim(),
      amount: amount ?? 0,
    });
    groups.set(key, list);
  }

  const shipments: AmazonShipment[] = [];
  for (const [key, group] of groups) {
    const total = group.reduce((a, i) => a + i.amount, 0);
    if (!total) continue;
    const [orderId, when] = key.split("|");
    shipments.push({
      shipmentKey: `DIGITAL|${key}`,
      orderId: orderId!,
      shipDate: when!,
      orderDate: when!,
      amounts: { owed_sum: total },
      payment: "Digital order",
      last4: null,
      storeCard: false,
      digital: true,
      orderUrl: orderDetailsUrl(orderId!),
      items: group.map((i) => ({
        asin: i.asin,
        product: i.product,
        quantity: 1,
        unitPriceCents: i.amount,
        unitTaxCents: null,
        lineTotalCents: i.amount,
        asinUrl: asinUrl(i.asin),
      })),
    });
  }
  return shipments;
}

function itemsFromOrderHistoryCsv(text: string): { items: AmazonOrderItem[]; error?: string } {
  const rows = parseCsv(text);
  if (rows.length === 0) return { items: [], error: "empty CSV" };
  const cols = buildColumnMap(Object.keys(rows[0]!));
  if (!cols.order_id) return { items: [], error: "no Order ID column" };
  const items: AmazonOrderItem[] = [];
  for (const row of rows) {
    const item = rowToItem(row, cols);
    if (item) items.push(item);
  }
  return { items };
}

/** Parse a single Order History CSV string. */
export function parseOrderHistoryCsv(text: string): ParsedAmazonExport {
  const { items, error } = itemsFromOrderHistoryCsv(text);
  const skippedNotes = error ? [error] : [];
  return {
    shipments: groupShipments(items),
    itemCount: items.length,
    skippedNotes,
  };
}

/**
 * Parse an uploaded Amazon export: either a bare Order History CSV, or a
 * "Your Orders" zip containing Order History (+ optional Digital Content Orders).
 */
export function parseAmazonExportBytes(
  bytes: Uint8Array,
  fileName: string,
): ParsedAmazonExport {
  const lower = fileName.toLowerCase();
  const skippedNotes: string[] = [];

  if (lower.endsWith(".csv")) {
    const text = strFromU8(bytes);
    return parseOrderHistoryCsv(text);
  }

  if (!lower.endsWith(".zip")) {
    throw new Error("Upload a .zip (Your Orders export) or Order History .csv");
  }

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("Could not read zip — is this a valid Amazon Your Orders export?");
  }

  const csvPaths = Object.keys(files)
    .filter((p) => p.toLowerCase().endsWith(".csv") && !p.includes("__MACOSX"))
    .sort();
  const { chosen, ignored } = preferOrderHistoryPaths(csvPaths);
  if (ignored.length) {
    skippedNotes.push(`${ignored.length} other CSV(s) in the export (not order history)`);
  }

  const items: AmazonOrderItem[] = [];
  for (const path of chosen) {
    const text = strFromU8(files[path]!);
    const { items: part, error } = itemsFromOrderHistoryCsv(text);
    if (error) skippedNotes.push(`${path.split("/").pop()}: ${error}`);
    items.push(...part);
  }

  const shipments = groupShipments(items);

  for (const path of csvPaths) {
    const base = path.split("/").pop() ?? "";
    if (/digital.*order/i.test(base)) {
      shipments.push(...loadDigitalFromCsvText(strFromU8(files[path]!)));
    }
  }

  return {
    shipments,
    itemCount: items.length,
    skippedNotes,
  };
}
