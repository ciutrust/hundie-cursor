import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireMfaStepUp, requireSameOrigin } from "@/lib/plaid/require-mfa";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isUuid } from "@/lib/uuid";

export const runtime = "nodejs";

const ACCOUNT_TYPES = ["credit_card", "checking", "savings"] as const;
type AccountType = (typeof ACCOUNT_TYPES)[number];

// Mirrors the seeded slugs (lowercase, dash-separated). A caller-supplied slug must already be in
// this shape — we validate rather than rewrite it, so the stored slug is never a silent surprise.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function deriveSlug(displayName: string): string {
  return displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Create one ledger `accounts` row so an unmapped Plaid account has something to map to.
 * unique(account_id) on plaid_account_links means every existing account is already linked, so the
 * mapper has nothing to offer without this. Insert goes through the service-role client because
 * `accounts` has read/update policies but no authenticated INSERT policy.
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
    displayName?: unknown;
    accountType?: unknown;
    defaultEntityId?: unknown;
    issuerParser?: unknown;
    slug?: unknown;
  } | null;
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  if (!displayName) return NextResponse.json({ error: "Display name is required" }, { status: 400 });

  if (!ACCOUNT_TYPES.includes(body.accountType as AccountType)) {
    return NextResponse.json(
      { error: `Account type must be one of: ${ACCOUNT_TYPES.join(", ")}` },
      { status: 400 },
    );
  }
  const accountType = body.accountType as AccountType;

  const issuerParser = typeof body.issuerParser === "string" ? body.issuerParser.trim() : "";
  if (!issuerParser) {
    return NextResponse.json({ error: "Issuer parser is required" }, { status: 400 });
  }

  // Entity assignment drives tax treatment, so it is the operator's explicit choice — never
  // defaulted here. A missing/malformed entity is a hard 400, not a fallback.
  if (!isUuid(body.defaultEntityId)) {
    return NextResponse.json({ error: "Select an entity for this account" }, { status: 400 });
  }
  const defaultEntityId = body.defaultEntityId;

  const slug =
    typeof body.slug === "string" && body.slug.trim() !== ""
      ? body.slug.trim()
      : deriveSlug(displayName);
  if (!SLUG_RE.test(slug)) {
    return NextResponse.json(
      { error: "Slug must be lowercase letters, numbers and single dashes (e.g. wf-checking-5435)" },
      { status: 400 },
    );
  }

  const admin = createServiceRoleClient();

  // Defense-in-depth: never trust the client's entity id. A stale/forged id would otherwise land as
  // an FK 500 (or, worse, on the wrong entity if it ever pointed at a real row we didn't intend).
  // is_classifiable matters as much as existence: the dormant/trust entities are deliberately absent
  // from every classify + CPA-report surface (they iterate getClassifiableEntities), so an account
  // pointed at one would route its transactions somewhere they'd never be seen again.
  const { data: entity } = await admin
    .from("entities")
    .select("id")
    .eq("id", defaultEntityId)
    .eq("is_classifiable", true)
    .maybeSingle();
  if (!entity) {
    return NextResponse.json(
      { error: "Unknown entity, or an entity that can't hold classified transactions" },
      { status: 400 },
    );
  }

  // Report the collision instead of suffixing: a silently altered slug would diverge from what the
  // operator sees, and slugs are how date_rules / reports refer to accounts.
  const { data: clash } = await admin
    .from("accounts")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  const slugTaken = `An account with the slug "${slug}" already exists. Choose a different name or slug.`;
  if (clash) return NextResponse.json({ error: slugTaken }, { status: 409 });

  const { data: created, error } = await admin
    .from("accounts")
    .insert({
      display_name: displayName,
      slug,
      account_type: accountType,
      issuer_parser: issuerParser,
      default_entity_id: defaultEntityId,
      date_rules: [],
      mixed_use: false,
      is_active: true,
    })
    .select("id, display_name, slug")
    .single();

  if (error || !created) {
    // The pre-check above can still lose a race; surface the constraint in operator language.
    if (error?.message?.includes("accounts_slug_key")) {
      return NextResponse.json({ error: slugTaken }, { status: 409 });
    }
    return NextResponse.json(
      { error: error?.message ?? "Failed to create account" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    id: created.id as string,
    displayName: created.display_name as string,
    slug: created.slug as string,
  });
}
