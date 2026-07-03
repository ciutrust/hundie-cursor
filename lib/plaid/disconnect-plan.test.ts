import { describe, expect, it } from "vitest";
import { shouldDeleteConnection } from "@/lib/plaid/disconnect-plan";

describe("shouldDeleteConnection (S7)", () => {
  it("deletes when there is no decryptable token to revoke (null)", () => {
    expect(shouldDeleteConnection(null)).toBe(true);
  });

  it("deletes when the Plaid revoke succeeded", () => {
    expect(shouldDeleteConnection({ ok: true })).toBe(true);
  });

  it("KEEPS the row when the Plaid revoke failed (no orphaned authorization)", () => {
    expect(shouldDeleteConnection({ ok: false })).toBe(false);
  });
});
