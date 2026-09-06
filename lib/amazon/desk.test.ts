import { describe, expect, it } from "vitest";
import {
  amazonDeskBucket,
  isAmazonCardPaymentCategory,
  parseAmazonDeskStatus,
} from "@/lib/amazon/desk";

describe("isAmazonCardPaymentCategory", () => {
  it("drops checking-side Amazon card pays", () => {
    expect(isAmazonCardPaymentCategory("Credit card payment")).toBe(true);
    expect(isAmazonCardPaymentCategory("Keller Credit card payment")).toBe(true);
  });

  it("keeps Amazon purchases and refunds", () => {
    expect(isAmazonCardPaymentCategory("Job Supplies Expense")).toBe(false);
    expect(isAmazonCardPaymentCategory("Refund / credit")).toBe(false);
    expect(isAmazonCardPaymentCategory(null)).toBe(false);
  });
});

describe("amazonDeskBucket", () => {
  it("archives confirmed matches", () => {
    expect(
      amazonDeskBucket({ linkStatus: "confirmed", categoryFullPath: "Job Supplies" }),
    ).toBe("done");
  });

  it("splits unmatched into needs-category vs needs-match", () => {
    expect(amazonDeskBucket({ linkStatus: null, categoryFullPath: null })).toBe("uncategorized");
    expect(
      amazonDeskBucket({ linkStatus: "suggested", categoryFullPath: "Ask My Accountant" }),
    ).toBe("uncategorized");
    expect(
      amazonDeskBucket({ linkStatus: "rejected", categoryFullPath: "Job Supplies Expense" }),
    ).toBe("skipped");
    expect(
      amazonDeskBucket({ linkStatus: "rejected", categoryFullPath: "Fraudulent charge" }),
    ).toBe("skipped");
    expect(amazonDeskBucket({ linkStatus: "rejected", categoryFullPath: null })).toBe(
      "uncategorized",
    );
  });
});

describe("parseAmazonDeskStatus", () => {
  it("maps legacy query values", () => {
    expect(parseAmazonDeskStatus("open")).toBe("uncategorized");
    expect(parseAmazonDeskStatus("confirmed")).toBe("done");
    expect(parseAmazonDeskStatus("rejected")).toBe("skipped");
    expect(parseAmazonDeskStatus(undefined)).toBe("uncategorized");
  });
});
