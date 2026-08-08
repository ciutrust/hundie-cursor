import { beforeEach, describe, expect, test, vi } from "vitest";
import { makeFakeSupabase } from "./helpers/fake-supabase.mjs";

// The `ignored` flag this route emits is the ONLY thing that makes an ignore reversible: the panel
// renders its "Track this account again" control from it. Nothing covered it, so flipping it to a
// constant false left the whole suite green while silently removing the un-ignore path from the UI.
const seams = vi.hoisted(() => ({
  admin: null as unknown as ReturnType<typeof makeFakeSupabase>,
  accounts: [] as Array<Record<string, unknown>>,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "operator" } } }) },
  }),
}));
vi.mock("@/lib/plaid/require-mfa", () => ({
  requireSameOrigin: () => null,
  requireMfaStepUp: async () => null,
}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => seams.admin }));
vi.mock("@/lib/crypto/secret-box", () => ({ decryptSecret: () => "access-token" }));
vi.mock("@/lib/aggregator/plaid", () => ({
  PlaidAggregator: class {
    async listAccounts() {
      return { ok: true, data: seams.accounts };
    }
  },
}));

import { POST } from "@/app/api/plaid/connection-accounts/route";

const CONN = "0ce0c0b2-8449-4f99-bf49-3b906e6129aa";
const SAVINGS = "6qYAdMMEokh3w01595jOTxqV8gwbRrFNB931B";
const CHECKING = "QY4DdqqOaVsvpBYj8jROFmoZ0ZX9DPh4BbN6a";

function post(connectionId: string): Request {
  return new Request("http://localhost/api/plaid/connection-accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionId }),
  });
}

const byId = (body: any, id: string) =>
  body.accounts.find((a: any) => a.plaidAccountId === id);

describe("POST /api/plaid/connection-accounts", () => {
  beforeEach(() => {
    // Two real Wells Fargo accounts: one mapped, one the operator marked "don't track".
    seams.accounts = [
      {
        externalId: SAVINGS,
        name: "WAY2SAVE SAVINGS ...1893",
        last4: "1893",
        type: "depository",
        institution: "Wells Fargo",
      },
      {
        externalId: CHECKING,
        name: "BUSINESS CHECKING ...3196",
        last4: "3196",
        type: "depository",
        institution: "Wells Fargo",
      },
    ];
    seams.admin = makeFakeSupabase({
      bank_connections: [
        { id: CONN, institution: "Wells Fargo", access_token_cipher: "cipher", status: "healthy" },
      ],
      accounts: [{ id: "acct-1", display_name: "WF GBSL Checking" }],
      plaid_account_links: [
        { connection_id: CONN, plaid_account_id: CHECKING, account_id: "acct-1" },
      ],
      plaid_ignored_accounts: [
        {
          connection_id: CONN,
          plaid_account_id: SAVINGS,
          reason: "personal savings, not tracked",
        },
      ],
    });
  });

  test("flags an ignored account, and does not flag its siblings", async () => {
    const body = await (await POST(post(CONN))).json();
    expect(byId(body, SAVINGS).ignored).toBe(true);
    expect(byId(body, CHECKING).ignored).toBe(false);
  });

  test("carries the stored reason back so the operator sees their own words", async () => {
    const body = await (await POST(post(CONN))).json();
    expect(byId(body, SAVINGS).ignoredReason).toBe("personal savings, not tracked");
    expect(byId(body, CHECKING).ignoredReason).toBeNull();
  });

  // No assertion on mappedAccountName: the shared fake's project() splits the select string on
  // commas, so "accounts(display_name)" can never resolve as an embed — asserting on it would test
  // the helper, not the route.
  test("a mapped account still reports its ledger account", async () => {
    const body = await (await POST(post(CONN))).json();
    expect(byId(body, CHECKING).mappedAccountId).toBe("acct-1");
    expect(byId(body, SAVINGS).mappedAccountId).toBeNull();
  });

  test("never returns the decrypted access token", async () => {
    const raw = await (await POST(post(CONN))).text();
    expect(raw).not.toContain("access-token");
    expect(raw).not.toContain("cipher");
  });
});
