import { describe, expect, test } from "vitest";
import { capCsvWindowForPlaid, dayBefore } from "../scripts/lib/csv-plaid-cap.mjs";
import { loadPlaidCutoverForAccount } from "../scripts/import-cards.mjs";
import { makeFakeSupabase } from "./helpers/fake-supabase.mjs";

describe("C6 — dayBefore (UTC, no off-by-one)", () => {
  test("returns the calendar day before an ISO date", () => {
    expect(dayBefore("2026-06-01")).toBe("2026-05-31");
  });
  test("crosses a year boundary", () => {
    expect(dayBefore("2026-01-01")).toBe("2025-12-31");
  });
});

describe("C6 — capCsvWindowForPlaid", () => {
  test("linked account: caps requestedTo down to the day before sync_from_date", () => {
    const r = capCsvWindowForPlaid({
      requestedTo: "2026-06-30",
      syncFromDate: "2026-06-01",
      hasPlaidLink: true,
      force: false,
    });
    // dateTo is EXCLUSIVE, so the effective upper bound is sync_from_date's day-before to keep no
    // CSV row on/after the cutover. dayBefore(2026-06-01) = 2026-05-31.
    expect(r.effectiveTo).toBe("2026-05-31");
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
    expect(r.effectiveTo).toBe("2026-05-31");
    expect(r.capped).toBe(true);
  });

  test("requestedTo already before the cap: keep the tighter requestedTo, not capped", () => {
    const r = capCsvWindowForPlaid({
      requestedTo: "2026-05-15",
      syncFromDate: "2026-06-01",
      hasPlaidLink: true,
      force: false,
    });
    // min(requestedTo, dayBefore(syncFromDate)) = min(2026-05-15, 2026-05-31) = 2026-05-15.
    expect(r.effectiveTo).toBe("2026-05-15");
    expect(r.capped).toBe(false);
  });

  test("requestedTo exactly equals the cap: kept, reported as not capped (no change)", () => {
    const r = capCsvWindowForPlaid({
      requestedTo: "2026-05-31",
      syncFromDate: "2026-06-01",
      hasPlaidLink: true,
      force: false,
    });
    expect(r.effectiveTo).toBe("2026-05-31");
    expect(r.capped).toBe(false);
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
    expect(capped).toEqual({ effectiveTo: "2026-05-31", capped: true });
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
