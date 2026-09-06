import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("getWalletItems (auth guard)", () => {
  it("returns [] for an unauthenticated caller and never creates the service-role client", async () => {
    let adminCreated = false;
    vi.doMock("@/lib/auth/require-user", () => ({
      requireUser: async () => ({ error: "Not authenticated", user: null, supabase: {} }),
    }));
    vi.doMock("@/lib/supabase/service-role", () => ({
      createServiceRoleClient: () => {
        adminCreated = true;
        return {} as unknown;
      },
    }));
    vi.doMock("@/lib/queries/accounts", () => ({
      getAccountsWithEntities: async () => {
        throw new Error("should not load accounts");
      },
    }));

    const { getWalletItems } = await import("./wallet");
    const res = await getWalletItems();
    expect(res).toEqual([]);
    expect(adminCreated).toBe(false);
  });
});
