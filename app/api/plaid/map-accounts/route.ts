import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deriveCutoverDate } from "@/lib/plaid/cutover";
import { requireMfaStepUp, requireSameOrigin } from "@/lib/plaid/require-mfa";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

type LinkInput = {
  plaidAccountId: string;
  accountId: string;
  plaidName?: string | null;
  plaidMask?: string | null;
  plaidType?: string | null;
};

/** Save the operator-confirmed Plaid account → Hundie account links. */
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
    links?: LinkInput[];
    cutoverDate?: string | null;
  } | null;
  if (!body?.connectionId || !Array.isArray(body.links)) {
    return NextResponse.json({ error: "Missing connectionId or links" }, { status: 400 });
  }

  const valid = body.links.filter(
    (l) => l && typeof l.plaidAccountId === "string" && typeof l.accountId === "string" && l.accountId,
  );
  if (valid.length === 0) return NextResponse.json({ linked: 0 });

  const admin = createServiceRoleClient();

  // Defense-in-depth: confirm the connection exists and each target is an active seeded account,
  // so a bad/stale payload can't link Plaid accounts to the wrong (or inactive) Hundie account.
  const { data: conn } = await admin
    .from("bank_connections")
    .select("id")
    .eq("id", body.connectionId)
    .single();
  if (!conn) return NextResponse.json({ error: "Unknown connection" }, { status: 400 });

  const accountIds = [...new Set(valid.map((l) => l.accountId))];
  const { data: accts } = await admin
    .from("accounts")
    .select("id")
    .eq("is_active", true)
    .in("id", accountIds);
  const activeIds = new Set((accts ?? []).map((a) => a.id));
  const unknown = accountIds.filter((id) => !activeIds.has(id));
  if (unknown.length > 0) {
    return NextResponse.json(
      { error: "One or more target accounts are not active accounts" },
      { status: 400 },
    );
  }

  // C3: the CSV→Plaid cutover. An explicit operator override wins; otherwise derive it from the
  // ledger as MAX(transaction_date)+1 of the mapped accounts so the gap between the CSV's last row
  // and the Plaid link date is not silently dropped.
  let cutoverDate: string | null =
    typeof body.cutoverDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.cutoverDate)
      ? body.cutoverDate
      : null;
  if (!cutoverDate) {
    cutoverDate = await deriveCutoverDate(admin, accountIds);
  }

  const rows = valid.map((l) => ({
    connection_id: body.connectionId,
    account_id: l.accountId,
    plaid_account_id: l.plaidAccountId,
    plaid_name: l.plaidName ?? null,
    plaid_mask: l.plaidMask ?? null,
    plaid_type: l.plaidType ?? null,
  }));

  const { error } = await admin
    .from("plaid_account_links")
    .upsert(rows, { onConflict: "plaid_account_id" });
  if (error) {
    // unique(account_id) violation => operator mapped two Plaid accounts to one Hundie account
    const msg = error.message?.includes("plaid_account_links_account_id_key")
      ? "Each Hundie account can map to only one Plaid account."
      : error.message;
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // C3: persist the cutover only when currently null, so re-mapping never silently moves an
  // established cutover (an operator must clear it or pass an explicit override to change it).
  if (cutoverDate) {
    await admin
      .from("bank_connections")
      .update({ sync_from_date: cutoverDate, updated_at: new Date().toISOString() })
      .eq("id", body.connectionId)
      .is("sync_from_date", null);
  }
  // C2: a link added after an earlier sync can't recover already-passed transactions unless the
  // forward-only cursor is reset. Null it so the next sync re-pulls from sync_from_date.
  await admin
    .from("bank_connections")
    .update({ sync_cursor: null, updated_at: new Date().toISOString() })
    .eq("id", body.connectionId);

  return NextResponse.json({ linked: rows.length, cutoverDate });
}
