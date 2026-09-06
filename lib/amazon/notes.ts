import type { AmazonShipment } from "@/lib/amazon/types";

/** Build classification notes: short item summary + order URL. */
export function buildAmazonNotes(shipment: AmazonShipment, maxItems = 4): string {
  const labels = shipment.items
    .map((i) => i.product.trim())
    .filter(Boolean)
    .map((p) => (p.length > 60 ? `${p.slice(0, 57)}…` : p));

  let summary: string;
  if (labels.length === 0) {
    summary = `Amazon order ${shipment.orderId}`;
  } else if (labels.length <= maxItems) {
    summary = labels.join("; ");
  } else {
    summary = `${labels.slice(0, maxItems).join("; ")} (+${labels.length - maxItems} more)`;
  }

  return `${summary}\n${shipment.orderUrl}`;
}
