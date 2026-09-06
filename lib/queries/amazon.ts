import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { isAmazonDescriptor } from "@/lib/amazon/detect";
import type {
  AmazonLedgerCharge,
  ChargeLinkStatus,
  MatchTier,
} from "@/lib/amazon/types";
import { chunk } from "@/lib/supabase/chunk";

/** Untyped client — amazon_* tables aren't in generated DB types yet. */
async function db(): Promise<SupabaseClient> {
  return createClient().then((c) => c as unknown as SupabaseClient);
}

export type AmazonShipmentRow = {
  id: string;
  shipment_key: string;
  order_id: string;
  ship_date: string | null;
  order_date: string | null;
  amounts: Record<string, number>;
  payment_method: string | null;
  last4: string | null;
  store_card: boolean;
  is_digital: boolean;
  order_url: string;
};

export type AmazonShipmentItemRow = {
  id: string;
  shipment_id: string;
  asin: string | null;
  product_name: string;
  quantity: number;
  unit_price_cents: number | null;
  unit_tax_cents: number | null;
  line_total_cents: number | null;
  asin_url: string | null;
  sort_index: number;
};

export type AmazonChargeLinkRow = {
  id: string;
  transaction_id: string;
  shipment_id: string | null;
  match_tier: MatchTier;
  match_hypothesis: string | null;
  date_delta: number | null;
  candidates: Array<{
    shipment_id?: string;
    shipment_key?: string;
    hypothesis: string;
    date_delta: number;
  }>;
  status: ChargeLinkStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
};

export type AmazonImportBatchRow = {
  id: string;
  source: string;
  file_name: string | null;
  item_count: number;
  shipment_count: number;
  uploaded_by: string | null;
  created_at: string;
};

export type AmazonShipmentWithItems = AmazonShipmentRow & {
  items: AmazonShipmentItemRow[];
};

export type AmazonDeskQueueItem = {
  charge: AmazonLedgerCharge;
  link: AmazonChargeLinkRow | null;
  shipment: AmazonShipmentWithItems | null;
  candidateShipments: AmazonShipmentWithItems[];
};

export async function getLatestAmazonImportBatch(): Promise<AmazonImportBatchRow | null> {
  const supabase = await db();
  const { data, error } = await supabase
    .from("amazon_import_batches")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AmazonImportBatchRow | null) ?? null;
}

/** Amazon-like ledger charges (descriptor/vendor heuristic). */
export async function fetchAmazonLedgerCharges(): Promise<AmazonLedgerCharge[]> {
  const supabase = await createClient();

  const { data: txs, error } = await supabase
    .from("transactions")
    .select(
      `
      id,
      transaction_date,
      amount,
      description,
      vendor,
      split_at,
      accounts!inner ( slug, display_name ),
      classifications!inner (
        id,
        entity_id,
        category_id,
        notes,
        entities!inner ( id, slug )
      )
    `,
    )
    .is("plaid_removed_at", null)
    .or(
      "description.ilike.%amazon%,description.ilike.%amzn%,vendor.ilike.%amazon%,vendor.ilike.%amzn%",
    )
    .order("transaction_date", { ascending: false })
    .limit(5000);

  if (error) throw new Error(error.message);

  type Row = {
    id: string;
    transaction_date: string;
    amount: number;
    description: string | null;
    vendor: string | null;
    split_at: string | null;
    accounts: { slug: string; display_name: string } | { slug: string; display_name: string }[];
    classifications:
      | {
          id: string;
          entity_id: string;
          category_id: string | null;
          notes: string | null;
          entities: { id: string; slug: string } | { id: string; slug: string }[];
        }
      | {
          id: string;
          entity_id: string;
          category_id: string | null;
          notes: string | null;
          entities: { id: string; slug: string } | { id: string; slug: string }[];
        }[];
  };

  const out: AmazonLedgerCharge[] = [];
  for (const row of (txs ?? []) as unknown as Row[]) {
    const desc = row.description ?? "";
    if (!isAmazonDescriptor(desc, row.vendor)) continue;
    const account = Array.isArray(row.accounts) ? row.accounts[0] : row.accounts;
    const cls = Array.isArray(row.classifications)
      ? row.classifications[0]
      : row.classifications;
    if (!account || !cls) continue;
    const entity = Array.isArray(cls.entities) ? cls.entities[0] : cls.entities;
    if (!entity) continue;
    out.push({
      transactionId: row.id,
      classificationId: cls.id,
      date: row.transaction_date,
      amount: Number(row.amount),
      descriptor: desc,
      vendor: row.vendor,
      accountSlug: account.slug,
      accountName: account.display_name,
      entityId: entity.id,
      entitySlug: entity.slug,
      categoryId: cls.category_id,
      notes: cls.notes,
      splitAt: row.split_at,
    });
  }
  return out;
}

export async function fetchShipmentsByKeys(
  keys: string[],
): Promise<Map<string, AmazonShipmentRow & { items: AmazonShipmentItemRow[] }>> {
  const map = new Map<string, AmazonShipmentRow & { items: AmazonShipmentItemRow[] }>();
  if (keys.length === 0) return map;
  const supabase = await db();

  for (const part of chunk(keys, 200)) {
    const { data: ships, error } = await supabase
      .from("amazon_shipments")
      .select("*")
      .in("shipment_key", part);
    if (error) throw new Error(error.message);
    const rows = (ships ?? []) as AmazonShipmentRow[];
    const ids = rows.map((r) => r.id);
    const itemsByShip = new Map<string, AmazonShipmentItemRow[]>();
    if (ids.length) {
      for (const idPart of chunk(ids, 200)) {
        const { data: items, error: itemErr } = await supabase
          .from("amazon_shipment_items")
          .select("*")
          .in("shipment_id", idPart)
          .order("sort_index", { ascending: true });
        if (itemErr) throw new Error(itemErr.message);
        for (const item of (items ?? []) as AmazonShipmentItemRow[]) {
          const list = itemsByShip.get(item.shipment_id) ?? [];
          list.push(item);
          itemsByShip.set(item.shipment_id, list);
        }
      }
    }
    for (const row of rows) {
      map.set(row.shipment_key, {
        ...row,
        amounts: (row.amounts ?? {}) as Record<string, number>,
        items: itemsByShip.get(row.id) ?? [],
      });
    }
  }
  return map;
}

export async function fetchShipmentsByIds(
  ids: string[],
): Promise<Map<string, AmazonShipmentRow & { items: AmazonShipmentItemRow[] }>> {
  const map = new Map<string, AmazonShipmentRow & { items: AmazonShipmentItemRow[] }>();
  if (ids.length === 0) return map;
  const supabase = await db();
  for (const part of chunk(ids, 200)) {
    const { data: ships, error } = await supabase
      .from("amazon_shipments")
      .select("*")
      .in("id", part);
    if (error) throw new Error(error.message);
    const rows = (ships ?? []) as AmazonShipmentRow[];
    const itemsByShip = new Map<string, AmazonShipmentItemRow[]>();
    if (rows.length) {
      const { data: items, error: itemErr } = await supabase
        .from("amazon_shipment_items")
        .select("*")
        .in(
          "shipment_id",
          rows.map((r) => r.id),
        )
        .order("sort_index", { ascending: true });
      if (itemErr) throw new Error(itemErr.message);
      for (const item of (items ?? []) as AmazonShipmentItemRow[]) {
        const list = itemsByShip.get(item.shipment_id) ?? [];
        list.push(item);
        itemsByShip.set(item.shipment_id, list);
      }
    }
    for (const row of rows) {
      map.set(row.id, {
        ...row,
        amounts: (row.amounts ?? {}) as Record<string, number>,
        items: itemsByShip.get(row.id) ?? [],
      });
    }
  }
  return map;
}

export async function fetchChargeLinksByTransactionIds(
  txnIds: string[],
): Promise<Map<string, AmazonChargeLinkRow>> {
  const map = new Map<string, AmazonChargeLinkRow>();
  if (txnIds.length === 0) return map;
  const supabase = await db();
  for (const part of chunk(txnIds, 200)) {
    const { data, error } = await supabase
      .from("amazon_charge_links")
      .select("*")
      .in("transaction_id", part);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as AmazonChargeLinkRow[]) {
      map.set(row.transaction_id, {
        ...row,
        candidates: (row.candidates ?? []) as AmazonChargeLinkRow["candidates"],
      });
    }
  }
  return map;
}

export async function getAmazonDeskQueue(filter: {
  status?: "open" | "suggested" | "confirmed" | "all";
}): Promise<{
  items: AmazonDeskQueueItem[];
  counts: { open: number; suggested: number; confirmed: number; total: number };
  lastBatch: AmazonImportBatchRow | null;
}> {
  const [charges, lastBatch] = await Promise.all([
    fetchAmazonLedgerCharges(),
    getLatestAmazonImportBatch(),
  ]);
  const links = await fetchChargeLinksByTransactionIds(charges.map((c) => c.transactionId));

  const shipmentIds = new Set<string>();
  const shipmentKeys = new Set<string>();
  for (const link of links.values()) {
    if (link.shipment_id) shipmentIds.add(link.shipment_id);
    if (link.match_hypothesis) shipmentKeys.add(link.match_hypothesis);
    for (const c of link.candidates) {
      if (c.shipment_id) shipmentIds.add(c.shipment_id);
      if (c.shipment_key) shipmentKeys.add(c.shipment_key);
    }
  }

  const [byId, byKey] = await Promise.all([
    fetchShipmentsByIds([...shipmentIds]),
    fetchShipmentsByKeys([...shipmentKeys]),
  ]);

  const items: AmazonDeskQueueItem[] = charges.map((charge) => {
    const link = links.get(charge.transactionId) ?? null;
    let shipment: (AmazonShipmentRow & { items: AmazonShipmentItemRow[] }) | null = null;
    if (link?.shipment_id) shipment = byId.get(link.shipment_id) ?? null;
    if (!shipment && link?.match_hypothesis) {
      shipment = byKey.get(link.match_hypothesis) ?? null;
    }

    const candidateShipments: AmazonShipmentWithItems[] = [];
    if (link) {
      for (const c of link.candidates) {
        const s =
          (c.shipment_id ? byId.get(c.shipment_id) : null) ??
          (c.shipment_key ? byKey.get(c.shipment_key) : null);
        if (s && !candidateShipments.some((x) => x.id === s.id)) {
          candidateShipments.push(s);
        }
      }
    }

    return { charge, link, shipment, candidateShipments };
  });

  const counts = {
    open: 0,
    suggested: 0,
    confirmed: 0,
    total: items.length,
  };
  for (const item of items) {
    if (!item.link || item.link.status === "rejected") counts.open += 1;
    else if (item.link.status === "suggested") counts.suggested += 1;
    else if (item.link.status === "confirmed") counts.confirmed += 1;
  }

  const status = filter.status ?? "open";
  const filtered =
    status === "all"
      ? items
      : status === "open"
        ? items.filter((i) => !i.link || i.link.status === "rejected" || i.link.status === "suggested")
        : items.filter((i) => i.link?.status === status);

  // Prefer unmatched / suggested first, then newest charge.
  filtered.sort((a, b) => {
    const rank = (i: AmazonDeskQueueItem) => {
      if (!i.link || i.link.status === "rejected") return 0;
      if (i.link.status === "suggested") return 1;
      return 2;
    };
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    return b.charge.date.localeCompare(a.charge.date);
  });

  return { items: filtered, counts, lastBatch };
}

export function shipmentRowToDomain(
  row: AmazonShipmentRow & { items: AmazonShipmentItemRow[] },
) {
  return {
    shipmentKey: row.shipment_key,
    orderId: row.order_id,
    shipDate: row.ship_date,
    orderDate: row.order_date,
    amounts: row.amounts,
    payment: row.payment_method ?? "",
    last4: row.last4,
    storeCard: row.store_card,
    digital: row.is_digital,
    orderUrl: row.order_url,
    items: row.items.map((i) => ({
      asin: i.asin ?? "",
      product: i.product_name,
      quantity: i.quantity,
      unitPriceCents: i.unit_price_cents,
      unitTaxCents: i.unit_tax_cents,
      lineTotalCents: i.line_total_cents,
      asinUrl: i.asin_url,
    })),
  };
}
