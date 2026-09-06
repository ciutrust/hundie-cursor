/** Detect Amazon card descriptors in the ledger. */

const AMAZON_RE =
  /\bamazon\b|\bamzn\.com\b|\bamzn\b|amzn\.com\/bill|amazon\.com/i;

export function isAmazonDescriptor(
  descriptor: string | null | undefined,
  vendor?: string | null,
): boolean {
  const text = `${descriptor ?? ""} ${vendor ?? ""}`;
  return AMAZON_RE.test(text);
}

export function wantsDigitalPurchase(descriptor: string, vendor?: string | null): boolean {
  return /\bdigi/i.test(`${descriptor} ${vendor ?? ""}`);
}

export function wantsPhysicalPurchase(descriptor: string, vendor?: string | null): boolean {
  return /mktpl|mark\*|marke|reta\*|retail/i.test(`${descriptor} ${vendor ?? ""}`);
}

export function orderDetailsUrl(orderId: string): string {
  return `https://www.amazon.com/gp/your-account/order-details?orderID=${encodeURIComponent(orderId)}`;
}

export function asinUrl(asin: string): string | null {
  const cleaned = asin.trim();
  if (!cleaned) return null;
  return `https://www.amazon.com/dp/${cleaned}`;
}
