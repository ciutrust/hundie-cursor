import { beforeEach, describe, expect, test, vi } from "vitest";
import { makeFakeSupabase } from "./helpers/fake-supabase.mjs";

// Invariant: mapped and ignored are mutually exclusive, in BOTH directions. ignore-accounts already
// refused an account that has a link; this pins the reverse. It matters because a link WINS in
// run-sync (accountIdByPlaid is what routes transactions), so a link landing on an account the
// operator marked "don't track" would quietly feed the ledger — and the CPA reports — while the
// ignore row became invisible in the UI and un-deletable through the API.
const seams = vi.hoisted(() => ({ admin: null as unknown as ReturnType<typeof makeFakeSupabase> }));
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

import { POST } from "@/app/api/plaid/map-accounts/route";

const CONN = "0ce0c0b2-8449-4f99-bf49-3b906e6129aa";
const IGNORED_PLAID = "6qYAdMMEokh3w01595jOTxqV8gwbRrFNB931B";
const FREE_PLAID = "dYkZwbbBvesKEa4oZoDxigzp4Rma7buQm1dJv";
const ACCT = "11111111-1111-4111-8111-111111111111";

function post(links: Array<Record<string, unknown>>): Request {
  return new Request("http://localhost/api/plaid/map-accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionId: CONN, links }),
  });
}

describe("POST /api/plaid/map-accounts — the don't-track guard", () => {
  beforeEach(() => {
    seams.admin = makeFakeSupabase({
      bank_connections: [
        { id: CONN, institution: "Wells Fargo", sync_cursor: "held", sync_from_date: "2026-06-01" },
      ],
      accounts: [{ id: ACCT, is_active: true, display_name: "WF Savings" }],
      // One pre-existing link, so this is a re-map: shouldPersistCutover stays false and the
      // established 2026-06-01 cutover must not move.
      plaid_account_links: [
        { connection_id: CONN, plaid_account_id: "already-mapped", account_id: "other-acct" },
      ],
      plaid_ignored_accounts: [
        {
          connection_id: CONN,
          plaid_account_id: IGNORED_PLAID,
          plaid_name: "WAY2SAVE SAVINGS ...1893",
          reason: "personal savings, not tracked",
        },
      ],
      transactions: [],
    });
  });

  test("refuses to map an account marked don't-track, and writes nothing", async () => {
    const res = await POST(post([{ plaidAccountId: IGNORED_PLAID, accountId: ACCT }]));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/don't track/i);
    // Names the offender so the operator knows which one to un-ignore.
    expect(body.error).toContain("WAY2SAVE SAVINGS ...1893");

    // Fails closed: no link written, and the connection is untouched.
    const links = (seams.admin as any).db.plaid_account_links;
    expect(links.some((l: any) => l.plaid_account_id === IGNORED_PLAID)).toBe(false);
    expect(links).toHaveLength(1);
    const conn = (seams.admin as any).db.bank_connections[0];
    expect(conn.sync_cursor).toBe("held");
    expect(conn.sync_from_date).toBe("2026-06-01");
  });

  test("does not over-fire: an account with no ignore row still maps", async () => {
    const res = await POST(post([{ plaidAccountId: FREE_PLAID, accountId: ACCT }]));
    expect(res.status).toBe(200);
    const links = (seams.admin as any).db.plaid_account_links;
    expect(links.some((l: any) => l.plaid_account_id === FREE_PLAID)).toBe(true);
  });

  test("one ignored account in a batch blocks the whole batch", async () => {
    const res = await POST(
      post([
        { plaidAccountId: FREE_PLAID, accountId: ACCT },
        { plaidAccountId: IGNORED_PLAID, accountId: ACCT },
      ]),
    );
    expect(res.status).toBe(409);
    // The clean sibling must not be half-written — the guard runs before any mutation.
    const links = (seams.admin as any).db.plaid_account_links;
    expect(links.some((l: any) => l.plaid_account_id === FREE_PLAID)).toBe(false);
  });
});
