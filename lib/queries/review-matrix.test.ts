import { describe, expect, it, vi } from "vitest";

// review.ts imports the server client at module load; mock it so the node test can import the
// pure exported buildMonthlyRow without pulling next/headers into the test runtime.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { buildMonthlyRow } from "@/lib/queries/review";
import { needsReviewCategory } from "@/lib/category-review";

const tx = (amount: number, categoryId: string | null, fullPath: string | null) =>
  ({
    amount,
    transaction_date: "2026-03-15",
    classification: {
      entity_id: "e1",
      category_id: categoryId,
      category: fullPath ? { id: categoryId ?? "x", full_path: fullPath } : null,
    },
  }) as any;

const AMA_ID = "ama-id";
const cpaReviewIds = new Set([AMA_ID]);

const rows = [
  tx(1000, "rent", "Rent Expense"),
  tx(250, "meals", "Meals"),
  tx(-100, "meals", "Meals"), // refund
  tx(500, AMA_ID, "Ask My Accountant"), // AMA review
  tx(300, null, null), // uncategorized review
  tx(800, "owner", "Owner Distribution"), // funding
  tx(-2000, "memb", "Membership Income"), // income
];

describe("buildMonthlyRow QA-04 (no entity/backlog double-count)", () => {
  it("entity expense row nets the refund and excludes AMA + uncategorized", () => {
    const entityRow = buildMonthlyRow("e1", "Entity One", rows, { expenseOnly: true });
    expect(entityRow.ytd).toBe(1150); // 1000 + 250 - 100
  });

  it("backlog row sums gross-positive review dollars (AMA + uncategorized)", () => {
    const reviewRows = rows.filter((r) =>
      needsReviewCategory(r.classification.category_id, cpaReviewIds),
    );
    const backlogRow = buildMonthlyRow("unclassified", "Review backlog", reviewRows, {
      isUnclassified: true,
    });
    expect(backlogRow.ytd).toBe(800); // AMA 500 + uncategorized 300
  });

  it("the AMA $500 lands in the backlog row only, never the entity row (no overlap)", () => {
    const entityRow = buildMonthlyRow("e1", "Entity One", rows, { expenseOnly: true });
    const reviewRows = rows.filter((r) =>
      needsReviewCategory(r.classification.category_id, cpaReviewIds),
    );
    const backlogRow = buildMonthlyRow("unclassified", "Review backlog", reviewRows, {
      isUnclassified: true,
    });
    // Removing the AMA row drops the backlog by 500 but leaves the entity row unchanged.
    const withoutAma = rows.filter((r) => r.classification.category_id !== AMA_ID);
    const entityWithoutAma = buildMonthlyRow("e1", "Entity One", withoutAma, { expenseOnly: true });
    const backlogWithoutAma = buildMonthlyRow(
      "unclassified",
      "Review backlog",
      withoutAma.filter((r) => needsReviewCategory(r.classification.category_id, cpaReviewIds)),
      { isUnclassified: true },
    );
    expect(entityWithoutAma.ytd).toBe(entityRow.ytd); // 1150, unaffected
    expect(backlogRow.ytd - backlogWithoutAma.ytd).toBe(500); // AMA only in backlog
  });
});
