import { describe, expect, it } from "vitest";
import { isAmazonDescriptor, orderDetailsUrl } from "@/lib/amazon/detect";
import { matchChargesToShipments } from "@/lib/amazon/match";
import { buildAmazonNotes } from "@/lib/amazon/notes";
import {
  groupShipments,
  parseAmazonDate,
  parseMoneyToCents,
  parseOrderHistoryCsv,
} from "@/lib/amazon/parse";
import type { AmazonLedgerCharge, AmazonOrderItem, AmazonShipment } from "@/lib/amazon/types";

describe("amazon parse helpers", () => {
  it("parses money with currency noise", () => {
    expect(parseMoneyToCents("$12.34")).toBe(1234);
    expect(parseMoneyToCents("USD 12.34")).toBe(1234);
    expect(parseMoneyToCents("'-1.79'")).toBe(-179);
    expect(parseMoneyToCents("")).toBeNull();
  });

  it("parses Amazon ISO and US dates", () => {
    expect(parseAmazonDate("2019-05-04T15:31:57Z")).toBe("2019-05-04");
    expect(parseAmazonDate("5/4/2019")).toBe("2019-05-04");
  });

  it("detects Amazon descriptors", () => {
    expect(isAmazonDescriptor("AMAZON MKTPL*ABC SEATTLE WA")).toBe(true);
    expect(isAmazonDescriptor("AMZN.COM/BILL WA")).toBe(true);
    expect(isAmazonDescriptor("STARBUCKS")).toBe(false);
  });
});

describe("groupShipments", () => {
  it("groups items by order_id + ship_date and builds amount hypotheses", () => {
    const items: AmazonOrderItem[] = [
      {
        orderId: "111-1",
        orderDate: "2026-01-01",
        shipDate: "2026-01-03",
        asin: "A1",
        product: "Widget",
        quantity: 1,
        unitPriceCents: 1000,
        unitTaxCents: 83,
        totalOwedCents: 1083,
        shippingCents: 0,
        discountsCents: 0,
        shipSubtotalCents: 1000,
        shipSubtotalTaxCents: 83,
        payment: "Visa - 1234",
        last4: "1234",
        status: "Closed",
      },
      {
        orderId: "111-1",
        orderDate: "2026-01-01",
        shipDate: "2026-01-03",
        asin: "A2",
        product: "Gadget",
        quantity: 2,
        unitPriceCents: 500,
        unitTaxCents: 40,
        totalOwedCents: 1080,
        shippingCents: 0,
        discountsCents: 0,
        shipSubtotalCents: 1000,
        shipSubtotalTaxCents: 80,
        payment: "Visa - 1234",
        last4: "1234",
        status: "Closed",
      },
    ];
    const ships = groupShipments(items);
    expect(ships).toHaveLength(1);
    expect(ships[0]!.shipmentKey).toBe("111-1|2026-01-03");
    expect(ships[0]!.items).toHaveLength(2);
    expect(ships[0]!.amounts.line_total).toBe(1000 + 83 + 1000 + 80);
    expect(ships[0]!.amounts.owed_sum).toBe(1083 + 1080);
    expect(ships[0]!.orderUrl).toContain("orderID=111-1");
  });

  it("does not invent owed_sum when Total Amount is repeated on every line", () => {
    const items: AmazonOrderItem[] = [
      {
        orderId: "333",
        orderDate: "2026-01-01",
        shipDate: "2026-01-02",
        asin: "A",
        product: "One",
        quantity: 1,
        unitPriceCents: 500,
        unitTaxCents: 0,
        totalOwedCents: 1000,
        shippingCents: 0,
        discountsCents: 0,
        shipSubtotalCents: 500,
        shipSubtotalTaxCents: 0,
        payment: "Visa - 1111",
        last4: "1111",
        status: "Closed",
      },
      {
        orderId: "333",
        orderDate: "2026-01-01",
        shipDate: "2026-01-02",
        asin: "B",
        product: "Two",
        quantity: 1,
        unitPriceCents: 500,
        unitTaxCents: 0,
        totalOwedCents: 1000,
        shippingCents: 0,
        discountsCents: 0,
        shipSubtotalCents: 500,
        shipSubtotalTaxCents: 0,
        payment: "Visa - 1111",
        last4: "1111",
        status: "Closed",
      },
    ];
    const amounts = groupShipments(items)[0]!.amounts;
    expect(amounts.owed_repeated).toBe(1000);
    expect(amounts.owed_sum).toBeUndefined();
  });

  it("marks Amazon store-card payments", () => {
    const items: AmazonOrderItem[] = [
      {
        orderId: "222",
        orderDate: "2026-02-01",
        shipDate: "2026-02-02",
        asin: "X",
        product: "Thing",
        quantity: 1,
        unitPriceCents: 500,
        unitTaxCents: 0,
        totalOwedCents: 500,
        shippingCents: 0,
        discountsCents: 0,
        shipSubtotalCents: 500,
        shipSubtotalTaxCents: 0,
        payment: "Amazon Store Card - 9999",
        last4: "9999",
        status: "Closed",
      },
    ];
    expect(groupShipments(items)[0]!.storeCard).toBe(true);
  });
});

describe("parseOrderHistoryCsv", () => {
  it("parses a minimal Order History CSV", () => {
    const csv = [
      "ASIN,Order Date,Order ID,Order Status,Original Quantity,Payment Method Type,Product Name,Ship Date,Shipment Item Subtotal,Shipment Item Subtotal Tax,Shipping Charge,Total Amount,Total Discounts,Unit Price,Unit Price Tax",
      "B00X,2026-03-01T00:00:00Z,111-AAA,Closed,1,Visa - 5494,Dove Body Wash,2026-03-02T00:00:00Z,10.00,0.83,0,10.83,0,10.00,0.83",
    ].join("\n");
    const parsed = parseOrderHistoryCsv(csv);
    expect(parsed.itemCount).toBe(1);
    expect(parsed.shipments).toHaveLength(1);
    expect(parsed.shipments[0]!.orderId).toBe("111-AAA");
    expect(parsed.shipments[0]!.last4).toBe("5494");
    expect(parsed.shipments[0]!.amounts.owed_first).toBe(1083);
  });

  it("skips cancelled orders", () => {
    const csv = [
      "ASIN,Order Date,Order ID,Order Status,Original Quantity,Payment Method Type,Product Name,Ship Date,Total Amount,Unit Price,Unit Price Tax",
      "B00X,2026-03-01T00:00:00Z,111-AAA,Cancelled,1,Visa - 5494,Thing,2026-03-02T00:00:00Z,10.00,10.00,0",
    ].join("\n");
    expect(parseOrderHistoryCsv(csv).itemCount).toBe(0);
  });
});

describe("matchChargesToShipments", () => {
  const shipment = (overrides: Partial<AmazonShipment> = {}): AmazonShipment => ({
    shipmentKey: "111|2026-04-01",
    orderId: "111",
    shipDate: "2026-04-01",
    orderDate: "2026-03-30",
    amounts: { owed_sum: 2599 },
    payment: "Visa - 1234",
    last4: "1234",
    storeCard: false,
    digital: false,
    orderUrl: orderDetailsUrl("111"),
    items: [
      {
        asin: "A",
        product: "Protein powder",
        quantity: 1,
        unitPriceCents: 2400,
        unitTaxCents: 199,
        lineTotalCents: 2599,
        asinUrl: null,
      },
    ],
    ...overrides,
  });

  const charge = (overrides: Partial<AmazonLedgerCharge> = {}): AmazonLedgerCharge => ({
    transactionId: "tx-1",
    classificationId: "cl-1",
    date: "2026-04-02",
    amount: -25.99,
    descriptor: "AMAZON MKTPL*XYZ",
    vendor: null,
    accountSlug: "amex-alex",
    accountName: "Amex",
    entityId: "ent-1",
    entitySlug: "personal",
    categoryId: null,
    notes: null,
    splitAt: null,
    ...overrides,
  });

  it("assigns tier A for a unique amount+date match", () => {
    const results = matchChargesToShipments([charge()], [shipment()]);
    expect(results[0]!.tier).toBe("A");
    expect(results[0]!.shipmentKey).toBe("111|2026-04-01");
  });

  it("assigns tier C when nothing matches", () => {
    const results = matchChargesToShipments(
      [charge({ amount: -99.99 })],
      [shipment()],
    );
    expect(results[0]!.tier).toBe("C");
  });

  it("skips store-card shipments", () => {
    const results = matchChargesToShipments(
      [charge()],
      [shipment({ storeCard: true })],
    );
    expect(results[0]!.tier).toBe("C");
  });

  it("prefers digital shipments for DIGI descriptors", () => {
    const digi = shipment({
      shipmentKey: "DIGITAL|111|2026-04-01",
      digital: true,
      amounts: { owed_sum: 999 },
    });
    const physical = shipment({
      shipmentKey: "222|2026-04-01",
      orderId: "222",
      amounts: { owed_sum: 999 },
    });
    const results = matchChargesToShipments(
      [
        charge({
          transactionId: "tx-d",
          amount: -9.99,
          descriptor: "AMAZON DIGI*ABC",
        }),
      ],
      [digi, physical],
    );
    expect(results[0]!.tier).toBe("A");
    expect(results[0]!.shipmentKey).toBe("DIGITAL|111|2026-04-01");
  });
});

describe("buildAmazonNotes", () => {
  it("includes item summary and order URL", () => {
    const notes = buildAmazonNotes({
      shipmentKey: "1|2026-01-01",
      orderId: "111-XYZ",
      shipDate: "2026-01-01",
      orderDate: "2026-01-01",
      amounts: {},
      payment: "",
      last4: null,
      storeCard: false,
      digital: false,
      orderUrl: orderDetailsUrl("111-XYZ"),
      items: [
        {
          asin: "A",
          product: "Short item",
          quantity: 1,
          unitPriceCents: 100,
          unitTaxCents: 0,
          lineTotalCents: 100,
          asinUrl: null,
        },
      ],
    });
    expect(notes).toContain("Short item");
    expect(notes).toContain("orderID=111-XYZ");
  });
});
