"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getAmazonOrderSource } from "@/lib/amazon/source";
import { matchChargesToShipments } from "@/lib/amazon/match";
import { buildAmazonNotes } from "@/lib/amazon/notes";
import { centsToNumber } from "@/lib/money";
import { validateSplit, type SplitLegDraft } from "@/lib/split-validation";
import {
  fetchAmazonLedgerCharges,
  fetchShipmentsByIds,
  fetchShipmentsByKeys,
  shipmentRowToDomain,
} from "@/lib/queries/amazon";
import type { AmazonShipment } from "@/lib/amazon/types";
import { chunk } from "@/lib/supabase/chunk";

async function amazonDb(): Promise<SupabaseClient> {
  return createClient().then((c) => c as unknown as SupabaseClient);
}

function revalidateAmazon() {
  revalidatePath("/amazon");
  revalidatePath("/review");
  revalidatePath("/transactions");
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" as const, user: null, supabase };
  return { error: null, user, supabase };
}

/** Upsert parsed shipments + items for a batch; returns key→id map. */
async function persistShipments(
  supabase: SupabaseClient,
  batchId: string,
  shipments: AmazonShipment[],
): Promise<Map<string, string>> {
  const keyToId = new Map<string, string>();

  for (const part of chunk(shipments, 100)) {
    const rows = part.map((s) => ({
      shipment_key: s.shipmentKey,
      order_id: s.orderId,
      ship_date: s.shipDate,
      order_date: s.orderDate,
      amounts: s.amounts,
      payment_method: s.payment || null,
      last4: s.last4,
      store_card: s.storeCard,
      is_digital: s.digital,
      order_url: s.orderUrl,
      import_batch_id: batchId,
      updated_at: new Date().toISOString(),
    }));

    const { data, error } = await supabase
      .from("amazon_shipments")
      .upsert(rows, { onConflict: "shipment_key" })
      .select("id, shipment_key");
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      keyToId.set(row.shipment_key as string, row.id as string);
    }
  }

  // Replace items for upserted shipments
  const shipmentIds = [...keyToId.values()];
  for (const idPart of chunk(shipmentIds, 200)) {
    const { error: delErr } = await supabase
      .from("amazon_shipment_items")
      .delete()
      .in("shipment_id", idPart);
    if (delErr) throw new Error(delErr.message);
  }

  const itemRows: Array<Record<string, unknown>> = [];
  for (const s of shipments) {
    const id = keyToId.get(s.shipmentKey);
    if (!id) continue;
    s.items.forEach((item, sortIndex) => {
      itemRows.push({
        shipment_id: id,
        asin: item.asin || null,
        product_name: item.product || "",
        quantity: item.quantity,
        unit_price_cents: item.unitPriceCents,
        unit_tax_cents: item.unitTaxCents,
        line_total_cents: item.lineTotalCents,
        asin_url: item.asinUrl,
        sort_index: sortIndex,
      });
    });
  }
  for (const part of chunk(itemRows, 200)) {
    const { error } = await supabase.from("amazon_shipment_items").insert(part);
    if (error) throw new Error(error.message);
  }

  return keyToId;
}

export async function importAmazonExport(formData: FormData): Promise<
  | { success: true; batchId: string; itemCount: number; shipmentCount: number; matched: number }
  | { error: string }
> {
  const auth = await requireUser();
  if (auth.error || !auth.user) return { error: auth.error ?? "Not authenticated" };

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "Choose a Your Orders .zip or Order History .csv" };
  if (file.size > 80 * 1024 * 1024) return { error: "File too large (max 80MB)" };

  const bytes = new Uint8Array(await file.arrayBuffer());
  let parsed;
  try {
    parsed = await getAmazonOrderSource("personal_export").parse(bytes, file.name);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to parse export" };
  }

  if (parsed.shipments.length === 0) {
    return {
      error:
        parsed.skippedNotes.join("; ") ||
        "No order shipments found. Upload the Your Orders zip (needs Order History.csv).",
    };
  }

  const MAX_SHIPMENTS = 25_000;
  if (parsed.shipments.length > MAX_SHIPMENTS) {
    return {
      error: `Export has ${parsed.shipments.length} shipments (max ${MAX_SHIPMENTS}). Narrow the date range in Amazon’s request.`,
    };
  }

  const supabase = await amazonDb();
  const { data: batch, error: batchErr } = await supabase
    .from("amazon_import_batches")
    .insert({
      source: "personal_export",
      file_name: file.name,
      item_count: parsed.itemCount,
      shipment_count: parsed.shipments.length,
      uploaded_by: auth.user.email ?? auth.user.id,
    })
    .select("id")
    .single();
  if (batchErr || !batch) return { error: batchErr?.message ?? "Failed to create import batch" };

  try {
    await persistShipments(supabase, batch.id as string, parsed.shipments);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to save shipments" };
  }

  revalidateAmazon();

  const rematch = await rematchAmazonCharges();
  if ("error" in rematch) {
    return {
      error: `Import saved (${parsed.shipments.length} shipments) but rematch failed: ${rematch.error}`,
    };
  }

  return {
    success: true,
    batchId: batch.id as string,
    itemCount: parsed.itemCount,
    shipmentCount: parsed.shipments.length,
    matched: rematch.matched,
  };
}

export async function rematchAmazonCharges(): Promise<
  { success: true; matched: number; ambiguous: number; unmatched: number } | { error: string }
> {
  const auth = await requireUser();
  if (auth.error || !auth.user) return { error: auth.error ?? "Not authenticated" };

  const supabase = await amazonDb();
  const { data: shipRows, error: shipErr } = await supabase.from("amazon_shipments").select("*");
  if (shipErr) return { error: shipErr.message };

  type ShipDb = {
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

  const dbShips = (shipRows ?? []) as ShipDb[];
  if (dbShips.length === 0) {
    return { success: true, matched: 0, ambiguous: 0, unmatched: 0 };
  }

  const ids = dbShips.map((s) => s.id);
  const itemsByShip = new Map<string, Array<{ asin: string | null; product_name: string; quantity: number; unit_price_cents: number | null; unit_tax_cents: number | null; line_total_cents: number | null; asin_url: string | null }>>();
  for (const part of chunk(ids, 200)) {
    const { data: items, error } = await supabase
      .from("amazon_shipment_items")
      .select("*")
      .in("shipment_id", part);
    if (error) return { error: error.message };
    for (const item of items ?? []) {
      const list = itemsByShip.get(item.shipment_id as string) ?? [];
      list.push(item as never);
      itemsByShip.set(item.shipment_id as string, list);
    }
  }

  const shipments: AmazonShipment[] = dbShips.map((s) =>
    shipmentRowToDomain({
      ...s,
      amounts: (s.amounts ?? {}) as Record<string, number>,
      items: (itemsByShip.get(s.id) ?? []).map((i, sort_index) => ({
        id: "",
        shipment_id: s.id,
        asin: i.asin,
        product_name: i.product_name,
        quantity: i.quantity,
        unit_price_cents: i.unit_price_cents,
        unit_tax_cents: i.unit_tax_cents,
        line_total_cents: i.line_total_cents,
        asin_url: i.asin_url,
        sort_index,
      })),
    }),
  );

  const keyToId = new Map(dbShips.map((s) => [s.shipment_key, s.id]));
  const charges = await fetchAmazonLedgerCharges();

  // Preserve confirmed + rejected links; don't reassign shipments already confirmed elsewhere.
  const { data: existing } = await supabase
    .from("amazon_charge_links")
    .select("transaction_id, shipment_id, status")
    .in("status", ["confirmed", "rejected"]);
  const skipTxn = new Set<string>();
  const takenShipIds = new Set<string>();
  for (const row of (existing ?? []) as Array<{
    transaction_id: string;
    shipment_id: string | null;
    status: string;
  }>) {
    skipTxn.add(row.transaction_id);
    if (row.status === "confirmed" && row.shipment_id) takenShipIds.add(row.shipment_id);
  }

  const available = shipments.filter((s) => {
    const id = keyToId.get(s.shipmentKey);
    return id ? !takenShipIds.has(id) : true;
  });

  const toMatch = charges.filter((c) => !skipTxn.has(c.transactionId));
  const results = matchChargesToShipments(toMatch, available);

  let matched = 0;
  let ambiguous = 0;
  let unmatched = 0;

  const upserts = results.map((r) => {
    if (r.tier === "A") matched += 1;
    else if (r.tier === "B") ambiguous += 1;
    else unmatched += 1;

    const candidates = r.candidates.map((c) => ({
      shipment_key: c.shipmentKey,
      shipment_id: keyToId.get(c.shipmentKey),
      hypothesis: c.hypothesis,
      date_delta: c.dateDelta,
    }));

    return {
      transaction_id: r.transactionId,
      shipment_id: r.shipmentKey ? keyToId.get(r.shipmentKey) ?? null : null,
      match_tier: r.tier,
      match_hypothesis: r.hypothesis,
      date_delta: r.dateDelta,
      candidates,
      status: "suggested" as const,
      updated_at: new Date().toISOString(),
    };
  });

  for (const part of chunk(upserts, 100)) {
    const { error } = await supabase
      .from("amazon_charge_links")
      .upsert(part, { onConflict: "transaction_id" });
    if (error) return { error: error.message };
  }

  revalidateAmazon();
  return { success: true, matched, ambiguous, unmatched };
}

export type ConfirmAmazonWholeInput = {
  transactionId: string;
  shipmentId: string;
  entityId: string;
  categoryId: string;
  entitySlug: string;
  /** Extra note text prepended before auto summary+URL. */
  extraNotes?: string | null;
};

export async function confirmAmazonWhole(
  input: ConfirmAmazonWholeInput,
): Promise<{ success: true } | { error: string }> {
  const auth = await requireUser();
  if (auth.error || !auth.user) return { error: auth.error ?? "Not authenticated" };

  const shipMap = await fetchShipmentsByIds([input.shipmentId]);
  const shipRow = shipMap.get(input.shipmentId);
  if (!shipRow) return { error: "Shipment not found" };

  const { data: txRaw, error: txErr } = await auth.supabase
    .from("transactions")
    .select("id, split_at, classifications!inner ( id )")
    .eq("id", input.transactionId)
    .maybeSingle();
  if (txErr) return { error: txErr.message };
  const tx = txRaw as {
    id: string;
    split_at: string | null;
    classifications: { id: string } | { id: string }[];
  } | null;
  if (!tx) return { error: "Transaction not found" };
  if (tx.split_at) return { error: "Charge is already split — unsplit first or use split confirm" };

  const cls = Array.isArray(tx.classifications) ? tx.classifications[0] : tx.classifications;
  if (!cls) return { error: "Classification missing" };

  const { data: category, error: catErr } = await auth.supabase
    .from("categories")
    .select("entity_id")
    .eq("id", input.categoryId)
    .maybeSingle();
  if (catErr) return { error: catErr.message };
  if (!category || category.entity_id !== input.entityId) {
    return { error: "Category does not belong to the selected entity" };
  }

  const domain = shipmentRowToDomain(shipRow);
  const autoNotes = buildAmazonNotes(domain);
  const notes = input.extraNotes?.trim()
    ? `${input.extraNotes.trim()}\n${autoNotes}`
    : autoNotes;

  const { error: updErr } = await auth.supabase
    .from("classifications")
    .update({
      entity_id: input.entityId,
      category_id: input.categoryId,
      notes,
      classified_by: auth.user.email ?? auth.user.id,
      classified_at: new Date().toISOString(),
    })
    .eq("id", cls.id);
  if (updErr) return { error: updErr.message };

  const supabase = await amazonDb();
  const { error: linkErr } = await supabase
    .from("amazon_charge_links")
    .upsert(
      {
        transaction_id: input.transactionId,
        shipment_id: input.shipmentId,
        match_tier: "manual",
        status: "confirmed",
        reviewed_by: auth.user.email ?? auth.user.id,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "transaction_id" },
    );
  if (linkErr) return { error: linkErr.message };

  revalidateAmazon();
  revalidatePath(`/review/${input.entitySlug}`);
  return { success: true };
}

export type ConfirmAmazonSplitLeg = {
  entityId: string;
  categoryId: string;
  /** Decimal amount string matching parent sign convention. */
  amount: string;
  label?: string;
};

export type ConfirmAmazonSplitInput = {
  transactionId: string;
  shipmentId: string;
  entitySlug: string;
  legs: ConfirmAmazonSplitLeg[];
  extraNotes?: string | null;
};

export async function confirmAmazonSplit(
  input: ConfirmAmazonSplitInput,
): Promise<{ success: true } | { error: string }> {
  const auth = await requireUser();
  if (auth.error || !auth.user) return { error: auth.error ?? "Not authenticated" };

  const shipMap = await fetchShipmentsByIds([input.shipmentId]);
  const shipRow = shipMap.get(input.shipmentId);
  if (!shipRow) return { error: "Shipment not found" };

  const { data: tx, error: txErr } = await auth.supabase
    .from("transactions")
    .select("id, amount, classifications!inner ( id )")
    .eq("id", input.transactionId)
    .maybeSingle();
  if (txErr) return { error: txErr.message };
  if (!tx) return { error: "Transaction not found" };

  const cls = Array.isArray(tx.classifications) ? tx.classifications[0] : tx.classifications;
  if (!cls) return { error: "Classification missing" };

  const drafts: SplitLegDraft[] = input.legs.map((l) => ({
    entityId: l.entityId,
    categoryId: l.categoryId,
    amount: l.amount,
  }));
  const validated = validateSplit(drafts, Number(tx.amount));
  if (!validated.ok) return { error: validated.error };

  const domain = shipmentRowToDomain(shipRow);
  const autoNotes = buildAmazonNotes(domain);
  const notes = input.extraNotes?.trim()
    ? `${input.extraNotes.trim()}\n${autoNotes}`
    : autoNotes;

  // Notes on parent classification first (split legs have no notes column).
  const { error: noteErr } = await auth.supabase
    .from("classifications")
    .update({
      notes,
      classified_by: auth.user.email ?? auth.user.id,
      classified_at: new Date().toISOString(),
    })
    .eq("id", cls.id);
  if (noteErr) return { error: noteErr.message };

  const admin = createServiceRoleClient();
  const { error: splitErr } = await admin.rpc("apply_transaction_split", {
    p_transaction_id: input.transactionId,
    p_legs: validated.legs.map((l) => ({
      entity_id: l.entityId,
      category_id: l.categoryId,
      amount: centsToNumber(l.amountCents),
    })),
  });
  if (splitErr) return { error: splitErr.message };

  const supabase = await amazonDb();
  const { error: linkErr } = await supabase
    .from("amazon_charge_links")
    .upsert(
      {
        transaction_id: input.transactionId,
        shipment_id: input.shipmentId,
        match_tier: "manual",
        status: "confirmed",
        reviewed_by: auth.user.email ?? auth.user.id,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "transaction_id" },
    );
  if (linkErr) return { error: linkErr.message };

  revalidateAmazon();
  revalidatePath(`/review/${input.entitySlug}`);
  return { success: true };
}

export async function rejectAmazonMatch(
  transactionId: string,
): Promise<{ success: true } | { error: string }> {
  const auth = await requireUser();
  if (auth.error || !auth.user) return { error: auth.error ?? "Not authenticated" };

  const supabase = await amazonDb();
  const { error } = await supabase
    .from("amazon_charge_links")
    .upsert(
      {
        transaction_id: transactionId,
        shipment_id: null,
        match_tier: "C",
        status: "rejected",
        reviewed_by: auth.user.email ?? auth.user.id,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        candidates: [],
      },
      { onConflict: "transaction_id" },
    );
  if (error) return { error: error.message };
  revalidateAmazon();
  return { success: true };
}

/** Resolve shipment by key for UI candidate picking (after rematch stores keys). */
export async function resolveShipmentIdByKey(
  shipmentKey: string,
): Promise<string | null> {
  const map = await fetchShipmentsByKeys([shipmentKey]);
  return map.get(shipmentKey)?.id ?? null;
}
