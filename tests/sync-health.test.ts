import { describe, expect, test } from "vitest";
import { summarizeConnections } from "../lib/queries/sync-health";
import type { ConnectionView } from "../lib/queries/connections";

const conn = (over: Partial<ConnectionView>): ConnectionView => ({
  id: "c",
  institution: "Bank",
  status: "healthy",
  lastSyncedAt: null,
  syncFromDate: null,
  links: [],
  ...over,
});

// #5 — the sync-health card's pure fold: which connections are unhealthy + the freshest sync time.
describe("summarizeConnections", () => {
  test("flags every non-healthy connection", () => {
    const { unhealthy } = summarizeConnections([
      conn({ id: "1", institution: "Chase", status: "healthy" }),
      conn({ id: "2", institution: "Amex", status: "needs_reauth" }),
      conn({ id: "3", institution: "BofA", status: "error" }),
    ]);
    expect(unhealthy).toEqual([
      { institution: "Amex", status: "needs_reauth" },
      { institution: "BofA", status: "error" },
    ]);
  });

  test("all healthy -> no unhealthy entries", () => {
    const { unhealthy } = summarizeConnections([
      conn({ status: "healthy" }),
      conn({ status: "healthy" }),
    ]);
    expect(unhealthy).toEqual([]);
  });

  test("lastSyncedAt is the most recent across connections (ISO string max)", () => {
    const { lastSyncedAt } = summarizeConnections([
      conn({ lastSyncedAt: "2026-06-01T10:00:00.000Z" }),
      conn({ lastSyncedAt: "2026-07-03T08:30:00.000Z" }),
      conn({ lastSyncedAt: "2026-06-15T22:00:00.000Z" }),
      conn({ lastSyncedAt: null }),
    ]);
    expect(lastSyncedAt).toBe("2026-07-03T08:30:00.000Z");
  });

  test("never-synced connections -> lastSyncedAt null", () => {
    const { lastSyncedAt } = summarizeConnections([conn({ lastSyncedAt: null })]);
    expect(lastSyncedAt).toBeNull();
  });
});
