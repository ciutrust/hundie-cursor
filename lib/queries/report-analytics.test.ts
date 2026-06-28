import { describe, expect, it, vi } from "vitest";

// report-analytics.ts imports the server client at module load; mock it so the node test can
// import the pure exported helper without pulling next/headers into the test runtime.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { uncategorizedDaysOld } from "@/lib/queries/report-analytics";

describe("uncategorizedDaysOld (BUG-11)", () => {
  it("clamps a same-day row to 0 even when now is before its noon anchor", () => {
    expect(uncategorizedDaysOld("2026-06-28", new Date("2026-06-28T06:00:00"))).toBe(0);
  });
  it("counts whole elapsed days", () => {
    expect(uncategorizedDaysOld("2026-06-20", new Date("2026-06-28T12:00:00"))).toBe(8);
  });
  it("never goes negative for a future-dated row", () => {
    expect(uncategorizedDaysOld("2026-07-01", new Date("2026-06-28T12:00:00"))).toBe(0);
  });
});
