import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("getConnections (S3 auth guard)", () => {
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
    vi.doMock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));

    const { getConnections } = await import("@/lib/queries/connections");
    const res = await getConnections();

    expect(res).toEqual([]);
    expect(adminCreated).toBe(false); // the sensitive read was never reached
  });
});
