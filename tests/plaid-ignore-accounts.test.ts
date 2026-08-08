import { beforeEach, describe, expect, test, vi } from "vitest";
import { makeFakeSupabase } from "./helpers/fake-supabase.mjs";

// The route's only untestable seams are auth: same-origin, the session lookup and the MFA step-up.
// Stub exactly those and let the real guard order, the real 409 check and the real writes run
// against the fake ledger — the DB composition is what has to be right here.
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

import { POST } from "@/app/api/plaid/ignore-accounts/route";

const CONN_A = "a49c4bac-502a-46fc-82fd-ffaa3f6751f0";
const CONN_B = "0ce0c0b2-8449-4f99-bf49-3b906e6129aa";

// The real connection state the two Wells Fargo rows are pinned in: a held cursor, a real cutover,
// a frozen last_synced_at. Every field here must survive an ignore untouched.
const HELD = {
  sync_cursor: "cursor-held-2026-06-29",
  sync_from_date: "2026-01-01",
  status: "needs_mapping",
  last_synced_at: "2026-06-29T00:00:00.000Z",
};

function seed(opts: {
  links?: Array<Record<string, unknown>>;
  ignored?: Array<Record<string, unknown>>;
}) {
  return makeFakeSupabase({
    bank_connections: [
      { id: CONN_A, institution: "Wells Fargo", ...HELD },
      { id: CONN_B, institution: "Wells Fargo", ...HELD },
    ],
    plaid_account_links: opts.links ?? [],
    plaid_ignored_accounts: opts.ignored ?? [],
  });
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/plaid/ignore-accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const conn = (sb: any, id: string) => sb.db.bank_connections.find((c: any) => c.id === id);
const ignoredIds = (sb: any) =>
  (sb.db.plaid_ignored_accounts ?? []).map((r: any) => r.plaid_account_id).sort();

describe("POST /api/plaid/ignore-accounts", () => {
  let sb: any;
  beforeEach(() => {
    sb = seed({});
    seams.admin = sb;
  });

  test("writes an ignore row carrying the posted connection_id and the Plaid snapshot", async () => {
    const res = await POST(
      post({
        connectionId: CONN_A,
        ignore: [
          {
            plaidAccountId: "plaid-4013",
            plaidName: "WELLS FARGO SIGNIFY BUSINESS CASH CARD ...4013",
            plaidMask: "4013",
            plaidType: "credit",
            reason: "  not ready to track this card  ",
          },
        ],
      }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ignored: 1, unignored: 0 });

    const row = sb.db.plaid_ignored_accounts[0];
    expect(row.connection_id).toBe(CONN_A);
    expect(row.plaid_account_id).toBe("plaid-4013");
    expect(row.plaid_mask).toBe("4013");
    expect(row.reason).toBe("not ready to track this card"); // trimmed
  });

  // THE money invariant. run-sync holds the cursor deliberately and it is already parked in the
  // right place; the next sync advances from it. If this route ever writes bank_connections, a
  // window of transactions is skipped or replayed. Nothing about the connection may move.
  test("never touches sync_cursor, sync_from_date, status or last_synced_at", async () => {
    const before = { ...conn(sb, CONN_A) };
    const res = await POST(
      post({
        connectionId: CONN_A,
        ignore: [{ plaidAccountId: "plaid-1893" }, { plaidAccountId: "plaid-5435" }],
      }),
    );
    expect(res.status).toBe(200);
    expect(conn(sb, CONN_A)).toEqual(before);
    expect(conn(sb, CONN_A).sync_cursor).toBe(HELD.sync_cursor);
    expect(conn(sb, CONN_A).sync_from_date).toBe(HELD.sync_from_date);
    expect(conn(sb, CONN_A).status).toBe("needs_mapping");
  });

  // A mapped account has transactions routed through its link. Ignoring it would be an unmap, which
  // strands that routing — and it must be refused no matter WHICH connection holds the link, since
  // plaid_account_id is unique table-wide.
  test("409s a mapped account and writes nothing, even when the link is on another connection", async () => {
    sb = seed({
      links: [
        {
          plaid_account_id: "plaid-MAPPED",
          account_id: "acct-1",
          connection_id: CONN_B,
          plaid_name: "EVERYDAY CHECKING ...1622",
          plaid_mask: "1622",
        },
      ],
    });
    seams.admin = sb;

    const res = await POST(
      post({
        connectionId: CONN_A,
        ignore: [{ plaidAccountId: "plaid-MAPPED" }, { plaidAccountId: "plaid-FREE" }],
      }),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("EVERYDAY CHECKING ...1622");
    // All-or-nothing: the innocent id in the same batch must not slip through.
    expect(ignoredIds(sb)).toEqual([]);
  });

  test("unignore deletes only the listed ids on that connection, and reports the real count", async () => {
    sb = seed({
      ignored: [
        { plaid_account_id: "plaid-GO", connection_id: CONN_A },
        { plaid_account_id: "plaid-STAY", connection_id: CONN_A },
        { plaid_account_id: "plaid-OTHER-CONN", connection_id: CONN_B },
      ],
    });
    seams.admin = sb;

    const res = await POST(
      // "plaid-OTHER-CONN" is named but belongs to CONN_B: the write is connection-scoped, so it
      // must survive and must not be counted.
      post({ connectionId: CONN_A, unignore: ["plaid-GO", "plaid-OTHER-CONN", "plaid-NEVER"] }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ignored: 0, unignored: 1 });
    expect(ignoredIds(sb)).toEqual(["plaid-OTHER-CONN", "plaid-STAY"]);
    expect(conn(sb, CONN_A).sync_cursor).toBe(HELD.sync_cursor);
  });

  test("un-ignores before it ignores, so one save can re-map an account and drop another", async () => {
    sb = seed({ ignored: [{ plaid_account_id: "plaid-BACK-ON", connection_id: CONN_A }] });
    seams.admin = sb;

    const res = await POST(
      post({
        connectionId: CONN_A,
        ignore: [{ plaidAccountId: "plaid-NEW-OFF" }],
        unignore: ["plaid-BACK-ON"],
      }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ignored: 1, unignored: 1 });
    expect(ignoredIds(sb)).toEqual(["plaid-NEW-OFF"]);
  });

  test("400s a connection that does not exist, before any write", async () => {
    const res = await POST(
      post({
        connectionId: "11111111-2222-3333-4444-555555555555",
        ignore: [{ plaidAccountId: "plaid-X" }],
      }),
    );
    expect(res.status).toBe(400);
    expect(ignoredIds(sb)).toEqual([]);
  });

  test("400s a non-uuid connectionId", async () => {
    const res = await POST(post({ connectionId: "not-a-uuid", ignore: [] }));
    expect(res.status).toBe(400);
  });

  // Naming one account on both sides has no defined outcome — it depends on write order. Refuse.
  test("400s the same account in both ignore and unignore, writing nothing", async () => {
    sb = seed({ ignored: [{ plaid_account_id: "plaid-BOTH", connection_id: CONN_A }] });
    seams.admin = sb;

    const res = await POST(
      post({
        connectionId: CONN_A,
        ignore: [{ plaidAccountId: "plaid-BOTH" }],
        unignore: ["plaid-BOTH"],
      }),
    );
    expect(res.status).toBe(400);
    expect(ignoredIds(sb)).toEqual(["plaid-BOTH"]); // untouched
  });

  test("a duplicated plaidAccountId collapses to one row (ON CONFLICT can't take a key twice)", async () => {
    const res = await POST(
      post({
        connectionId: CONN_A,
        ignore: [
          { plaidAccountId: "plaid-DUP", reason: "first" },
          { plaidAccountId: "plaid-DUP", reason: "second" },
        ],
      }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ignored: 1, unignored: 0 });
    expect(sb.db.plaid_ignored_accounts).toHaveLength(1);
    expect(sb.db.plaid_ignored_accounts[0].reason).toBe("second"); // last entry wins
  });
});
