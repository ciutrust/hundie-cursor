import { describe, expect, test } from "vitest";
import { flagIntercompanyMatches } from "./intercompany";

const row = (entitySlug: string, transactionDate: string, amount: number) => ({
  entitySlug,
  transactionDate,
  amount,
  categoryPath: "Rent Expense",
  description: "lease",
});

describe("flagIntercompanyMatches", () => {
  test("flags a same-amount, same-date pair across DIFFERENT entities (potential double-count)", () => {
    const rows = [row("gbsl", "2026-03-01", 2500), row("acaa-austin", "2026-03-01", 2500)];
    const flagged = flagIntercompanyMatches(rows);
    expect(flagged.every((r) => r.potentialMirror)).toBe(true);
  });

  test("does NOT flag same amount+date within the SAME entity", () => {
    const rows = [row("gbsl", "2026-03-01", 2500), row("gbsl", "2026-03-01", 2500)];
    expect(flagIntercompanyMatches(rows).some((r) => r.potentialMirror)).toBe(false);
  });

  test("matches on absolute amount so a refund mirror is caught", () => {
    const rows = [row("gbsl", "2026-03-01", 2500), row("personal", "2026-03-01", -2500)];
    expect(flagIntercompanyMatches(rows).every((r) => r.potentialMirror)).toBe(true);
  });

  test("leaves unique legs unflagged", () => {
    const rows = [row("gbsl", "2026-03-01", 2500), row("acaa-austin", "2026-04-01", 999)];
    expect(flagIntercompanyMatches(rows).some((r) => r.potentialMirror)).toBe(false);
  });

  test("nets the 136 Anita lease across GBSL expense and ACAA income legs (ACCT-07)", () => {
    // The two legs carry DIFFERENT category paths (expense leg vs income leg) but the same
    // date + |amount| across DIFFERENT entities, so both come back flagged as a potential mirror.
    const rows = [
      {
        entitySlug: "gbsl",
        transactionDate: "2026-03-01",
        amount: 2500,
        categoryPath: "Intercompany — 136 Anita",
        description: "lease to ACAA",
      },
      {
        entitySlug: "acaa-austin",
        transactionDate: "2026-03-01",
        amount: -2500,
        categoryPath: "Intercompany — 136 Anita (income)",
        description: "lease from GBSL",
      },
    ];
    const flagged = flagIntercompanyMatches(rows);
    expect(flagged.every((r) => r.potentialMirror)).toBe(true);
  });
});
