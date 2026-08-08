import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireMfaStepUp, requireSameOrigin } from "@/lib/plaid/require-mfa";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isUuid } from "@/lib/uuid";

export const runtime = "nodejs";

type IgnoreInput = {
  plaidAccountId: string;
  plaidName?: string | null;
  plaidMask?: string | null;
  plaidType?: string | null;
  reason?: string | null;
};

/** Name an account the way the operator sees it in the mapper, so a 409 is actionable. */
function describeAccount(name: unknown, mask: unknown, plaidAccountId: string): string {
  const parts = [
    typeof name === "string" && name !== "" ? name : null,
    typeof mask === "string" && mask !== "" ? `(...${mask})` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : plaidAccountId;
}

const trimmedOrNull = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

/**
 * Mark Plaid accounts as DELIBERATELY NOT TRACKED, or undo that.
 *
 * C2: run-sync holds the forward-only cursor while any incoming Plaid account is unresolved, so a
 * bank whose extra accounts the operator will never track stays pinned at needs_mapping forever.
 * An ignore row RESOLVES that gate. It is not a mapping: an ignored account has no
 * plaid_account_links row, so run-sync's per-account guard still skips it and NOT ONE of its
 * transactions can enter the ledger.
 *
 * This route deliberately never touches sync_cursor, sync_from_date or status — the held cursor is
 * already correctly positioned, and the next sync simply advances from it. Reversible: `unignore`
 * puts the account back under the mapping gate.
 */
export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const mfaError = await requireMfaStepUp(supabase);
  if (mfaError) return mfaError;

  const body = (await request.json().catch(() => null)) as {
    connectionId?: string;
    ignore?: IgnoreInput[];
    unignore?: string[];
  } | null;
  if (!body || !isUuid(body.connectionId)) {
    return NextResponse.json({ error: "Invalid connectionId" }, { status: 400 });
  }
  const connectionId = body.connectionId;
  if (
    (body.ignore !== undefined && !Array.isArray(body.ignore)) ||
    (body.unignore !== undefined && !Array.isArray(body.unignore))
  ) {
    return NextResponse.json({ error: "ignore and unignore must be arrays" }, { status: 400 });
  }

  // Last entry wins per plaid_account_id: Postgres rejects an ON CONFLICT batch that touches the
  // same key twice, so a duplicated entry would fail the whole request.
  const byPlaidId = new Map<string, IgnoreInput>();
  for (const i of body.ignore ?? []) {
    if (!i || typeof i.plaidAccountId !== "string" || i.plaidAccountId.trim() === "") continue;
    byPlaidId.set(i.plaidAccountId, i);
  }
  const toIgnore = [...byPlaidId.values()];

  const toUnignore = [
    ...new Set(
      (body.unignore ?? []).filter(
        (id): id is string => typeof id === "string" && id.trim() !== "",
      ),
    ),
  ];

  // Naming the same account in both lists is a caller bug whose outcome would depend on write
  // order. Refuse rather than silently pick one.
  const contradictory = toUnignore.filter((id) => byPlaidId.has(id));
  if (contradictory.length > 0) {
    return NextResponse.json(
      { error: `Same account in both ignore and unignore: ${contradictory.join(", ")}` },
      { status: 400 },
    );
  }

  const admin = createServiceRoleClient();

  // Defense-in-depth: a stale/forged connection id must 400, not write ignore rows hanging off a
  // connection that doesn't exist.
  const { data: conn } = await admin
    .from("bank_connections")
    .select("id")
    .eq("id", connectionId)
    .single();
  if (!conn) return NextResponse.json({ error: "Unknown connection" }, { status: 400 });

  if (toIgnore.length === 0 && toUnignore.length === 0) {
    return NextResponse.json({ ignored: 0, unignored: 0 });
  }

  // A MAPPED account can't be ignored — that would be an unmap, and it would strand the routing of
  // every transaction already imported through that link. The check is GLOBAL on purpose:
  // plaid_account_id is unique across plaid_account_links, so an account mapped under ANOTHER
  // connection must still be refused. (The writes below are connection-scoped; that difference is
  // intentional.)
  if (toIgnore.length > 0) {
    const { data: mappedRows, error: mErr } = await admin
      .from("plaid_account_links")
      .select("plaid_account_id, plaid_name, plaid_mask")
      .in(
        "plaid_account_id",
        toIgnore.map((i) => i.plaidAccountId),
      );
    if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });
    if ((mappedRows ?? []).length > 0) {
      const labels = (mappedRows ?? [])
        .map((r) => describeAccount(r.plaid_name, r.plaid_mask, r.plaid_account_id))
        .join(", ");
      return NextResponse.json(
        {
          error: `Already mapped to a ledger account: ${labels}. Ignoring is only for accounts that are not tracked at all — unmap it first if that is really what you want.`,
        },
        { status: 409 },
      );
    }
  }

  // plaid_account_id is unique table-wide, so the upsert below would happily re-parent an existing
  // row onto THIS connection. That row would then be invisible to the connection that actually owns
  // the account (the page and the panel both list by connection_id) while still holding its sync
  // gate released. Refuse instead of silently moving someone else's decision.
  if (toIgnore.length > 0) {
    const { data: existingIgnores, error: eoErr } = await admin
      .from("plaid_ignored_accounts")
      .select("plaid_account_id, connection_id")
      .in(
        "plaid_account_id",
        toIgnore.map((i) => i.plaidAccountId),
      );
    if (eoErr) return NextResponse.json({ error: eoErr.message }, { status: 500 });
    const foreign = (existingIgnores ?? []).filter((r) => r.connection_id !== connectionId);
    if (foreign.length > 0) {
      return NextResponse.json(
        {
          error: `Already marked "don't track" under a different connection: ${foreign
            .map((r) => r.plaid_account_id)
            .join(", ")}.`,
        },
        { status: 409 },
      );
    }
  }

  // Un-ignore FIRST. Putting an account back under the mapping gate is the conservative direction
  // (the next sync holds the cursor again), so if the ignore write below fails we have not released
  // a connection the operator was trying to re-block.
  let unignored = 0;
  if (toUnignore.length > 0) {
    // Counted before the delete: the delete builder hands back no rows, and echoing the input would
    // over-report ids that were never ignored.
    const { data: existing, error: exErr } = await admin
      .from("plaid_ignored_accounts")
      .select("plaid_account_id")
      .eq("connection_id", connectionId)
      .in("plaid_account_id", toUnignore);
    if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });
    unignored = (existing ?? []).length;

    if (unignored > 0) {
      const { error: dErr } = await admin
        .from("plaid_ignored_accounts")
        .delete()
        .eq("connection_id", connectionId)
        .in("plaid_account_id", toUnignore);
      if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });
    }
  }

  const rows = toIgnore.map((i) => ({
    connection_id: connectionId,
    plaid_account_id: i.plaidAccountId,
    plaid_name: trimmedOrNull(i.plaidName),
    plaid_mask: trimmedOrNull(i.plaidMask),
    plaid_type: trimmedOrNull(i.plaidType),
    reason: trimmedOrNull(i.reason),
  }));
  if (rows.length > 0) {
    const { error } = await admin
      .from("plaid_ignored_accounts")
      .upsert(rows, { onConflict: "plaid_account_id" });
    if (error) {
      // Report the un-ignores that already landed rather than implying nothing happened.
      return NextResponse.json({ error: error.message, unignored }, { status: 500 });
    }
  }

  // No bank_connections write here, deliberately: sync_cursor / sync_from_date / status stay exactly
  // as run-sync left them, and the next sync advances the held cursor on its own.
  return NextResponse.json({ ignored: rows.length, unignored });
}
