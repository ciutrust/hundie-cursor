import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    connectionId?: string;
    links?: LinkInput[];
  } | null;
  if (!body?.connectionId || !Array.isArray(body.links)) {
    return NextResponse.json({ error: "Missing connectionId or links" }, { status: 400 });
  }

  const valid = body.links.filter(
    (l) => l && typeof l.plaidAccountId === "string" && typeof l.accountId === "string" && l.accountId,
  );
  if (valid.length === 0) return NextResponse.json({ linked: 0 });

  const admin = createServiceRoleClient();
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
  return NextResponse.json({ linked: rows.length });
}
