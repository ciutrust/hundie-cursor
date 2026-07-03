import { describe, expect, test } from "vitest";
import { capCsvWindowForPlaid } from "../scripts/lib/csv-plaid-cap.mjs";
import { inDateRange } from "../scripts/lib/ledger-import.mjs";
import { loadPlaidCutoverForAccount } from "../scripts/import-cards.mjs";
import { makeFakeSupabase } from "./helpers/fake-supabase.mjs";

describe("C6 — capCsvWindowForPlaid", () => {
  test("linked account: caps requestedTo down to sync_from_date itself (EXCLUSIVE bound)", () => {
    const r = capCsvWindowForPlaid({
      requestedTo: "2026-06-30",
      syncFromDate: "2026-06-01",
      hasPlaidLink: true,
      force: false,
    });
    // dateTo is EXCLUSIVE (inDateRange keeps d < to) and Plaid owns rows >= sync_from_date, so the
    // exclusive cap is sync_from_date ITSELF: keeps everything strictly before the cutover (through
    // sync_from_date - 1) and drops sync_from_date onward. Capping at dayBefore would double-apply the
    // exclusivity and wrongly drop the sync_from_date - 1 seam row.
    expect(r.effectiveTo).toBe("2026-06-01");
    expect(r.capped).toBe(true);
  });

  test("--force bypasses the cap even when linked", () => {
    const r = capCsvWindowForPlaid({
      requestedTo: "2026-06-30",
      syncFromDate: "2026-06-01",
      hasPlaidLink: true,
      force: true,
    });
    expect(r.effectiveTo).toBe("2026-06-30");
    expect(r.capped).toBe(false);
  });

  test("no Plaid link: window is untouched", () => {
    const r = capCsvWindowForPlaid({
      requestedTo: "2026-06-30",
      syncFromDate: null,
      hasPlaidLink: false,
      force: false,
    });
    expect(r.effectiveTo).toBe("2026-06-30");
    expect(r.capped).toBe(false);
  });

  test("linked but no sync_from_date: nothing to cap against", () => {
    const r = capCsvWindowForPlaid({
      requestedTo: "2026-06-30",
      syncFromDate: null,
      hasPlaidLink: true,
      force: false,
    });
    expect(r.effectiveTo).toBe("2026-06-30");
    expect(r.capped).toBe(false);
  });

  test("no requestedTo bound: the cap becomes the bound", () => {
    const r = capCsvWindowForPlaid({
      requestedTo: null,
      syncFromDate: "2026-06-01",
      hasPlaidLink: true,
      force: false,
    });
    expect(r.effectiveTo).toBe("2026-06-01");
    expect(r.capped).toBe(true);
  });

  test("requestedTo already before the cap: keep the tighter requestedTo, not capped", () => {
    const r = capCsvWindowForPlaid({
      requestedTo: "2026-05-15",
      syncFromDate: "2026-06-01",
      hasPlaidLink: true,
      force: false,
    });
    // min(requestedTo, syncFromDate) = min(2026-05-15, 2026-06-01) = 2026-05-15.
    expect(r.effectiveTo).toBe("2026-05-15");
    expect(r.capped).toBe(false);
  });

  test("requestedTo exactly equals the cap: kept, reported as not capped (no change)", () => {
    const r = capCsvWindowForPlaid({
      requestedTo: "2026-06-01",
      syncFromDate: "2026-06-01",
      hasPlaidLink: true,
      force: false,
    });
    expect(r.effectiveTo).toBe("2026-06-01");
    expect(r.capped).toBe(false);
  });
});

// End-to-end boundary: feed the capped effectiveTo through the importer's EXCLUSIVE inDateRange and
// prove the CSV window and Plaid window meet contiguously at the seam. With sync_from_date derived as
// MAX(transaction_date)+1, the day 2026-05-31 (= sync_from_date - 1) is the most likely day to carry
// real CSV rows and is NOT Plaid's — it must be KEPT. 2026-06-01 (the cutover) IS Plaid's — dropped.
// This is the test that would have caught the off-by-one.
describe("C6 — seam is contiguous through inDateRange (regression for the off-by-one)", () => {
  test("sync_from_date - 1 is kept and sync_from_date is dropped by the capped bound", () => {
    const { effectiveTo } = capCsvWindowForPlaid({
      requestedTo: null,
      syncFromDate: "2026-06-01",
      hasPlaidLink: true,
      force: false,
    });
    // The seam row (last CSV-owned day) is kept — it is strictly before the cutover.
    expect(inDateRange("2026-05-31", null, effectiveTo)).toBe(true);
    // The cutover day itself is Plaid's — excluded from the CSV window.
    expect(inDateRange("2026-06-01", null, effectiveTo)).toBe(false);
    // Everything after the cutover is likewise Plaid's — excluded.
    expect(inDateRange("2026-06-02", null, effectiveTo)).toBe(false);
  });
});

// The import-cards write loop loads each account's Plaid cutover via loadPlaidCutoverForAccount and
// feeds it into capCsvWindowForPlaid to bound the CSV window. This exercises that DB-reading loader
// against the fake harness plus the composed cap decision the loop makes per target.
describe("C6 — loadPlaidCutoverForAccount + composed window cap (fake supabase)", () => {
  test("linked account resolves the connection's sync_from_date and caps the window", async () => {
    const sb: any = makeFakeSupabase({
      plaid_account_links: [{ id: "l1", account_id: "acct-1", connection_id: "conn-1" }],
      bank_connections: [{ id: "conn-1", sync_from_date: "2026-06-01" }],
    });
    const cut = await loadPlaidCutoverForAccount(sb, "acct-1");
    expect(cut).toEqual({ hasPlaidLink: true, syncFromDate: "2026-06-01" });
    const capped = capCsvWindowForPlaid({
      requestedTo: "2026-06-30",
      syncFromDate: cut.syncFromDate,
      hasPlaidLink: cut.hasPlaidLink,
      force: false,
    });
    expect(capped).toEqual({ effectiveTo: "2026-06-01", capped: true });
  });

  test("CSV-only account (no Plaid link) leaves the window untouched", async () => {
    const sb: any = makeFakeSupabase({
      plaid_account_links: [{ id: "l1", account_id: "acct-OTHER", connection_id: "conn-1" }],
      bank_connections: [{ id: "conn-1", sync_from_date: "2026-06-01" }],
    });
    const cut = await loadPlaidCutoverForAccount(sb, "acct-1");
    expect(cut).toEqual({ hasPlaidLink: false, syncFromDate: null });
    const capped = capCsvWindowForPlaid({
      requestedTo: "2026-06-30",
      syncFromDate: cut.syncFromDate,
      hasPlaidLink: cut.hasPlaidLink,
      force: false,
    });
    expect(capped).toEqual({ effectiveTo: "2026-06-30", capped: false });
  });
});
