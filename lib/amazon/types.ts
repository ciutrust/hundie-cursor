/** Amazon desk domain types (not yet in generated Supabase types). */

export type AmazonImportSource = "personal_export" | "business_api";

export type MatchTier = "A" | "B" | "C" | "manual";

export type ChargeLinkStatus = "suggested" | "confirmed" | "rejected";

export type AmazonOrderItem = {
  orderId: string;
  orderDate: string | null;
  shipDate: string | null;
  asin: string;
  product: string;
  quantity: number;
  unitPriceCents: number | null;
  unitTaxCents: number | null;
  totalOwedCents: number | null;
  shippingCents: number | null;
  discountsCents: number | null;
  shipSubtotalCents: number | null;
  shipSubtotalTaxCents: number | null;
  payment: string;
  last4: string | null;
  status: string;
};

export type AmazonShipment = {
  shipmentKey: string;
  orderId: string;
  shipDate: string | null; // YYYY-MM-DD
  orderDate: string | null;
  /** Competing reconstructions of card charge in integer cents. */
  amounts: Record<string, number>;
  payment: string;
  last4: string | null;
  storeCard: boolean;
  digital: boolean;
  orderUrl: string;
  items: Array<{
    asin: string;
    product: string;
    quantity: number;
    unitPriceCents: number | null;
    unitTaxCents: number | null;
    lineTotalCents: number | null;
    asinUrl: string | null;
  }>;
};

export type AmazonLedgerCharge = {
  transactionId: string;
  classificationId: string;
  date: string; // YYYY-MM-DD
  /** Signed ledger amount (expenses usually negative). Matching uses abs cents. */
  amount: number;
  descriptor: string;
  vendor: string | null;
  accountSlug: string;
  accountName: string;
  entityId: string;
  entitySlug: string;
  categoryId: string | null;
  notes: string | null;
  splitAt: string | null;
};

export type MatchCandidate = {
  shipmentKey: string;
  hypothesis: string;
  dateDelta: number;
};

export type ChargeMatchResult = {
  transactionId: string;
  tier: MatchTier;
  /** Best / unique shipment when tier A; null for C; first candidate for B. */
  shipmentKey: string | null;
  hypothesis: string | null;
  dateDelta: number | null;
  candidates: MatchCandidate[];
};

export type ParsedAmazonExport = {
  shipments: AmazonShipment[];
  itemCount: number;
  skippedNotes: string[];
};
