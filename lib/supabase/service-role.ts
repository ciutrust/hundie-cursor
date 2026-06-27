import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for SERVER-ONLY privileged work:
 *   - reading/writing the Plaid tables (bank_connections, plaid_account_links), which have
 *     no anon/authenticated RLS policies, and
 *   - writing ledger rows from the Plaid sync route (there is no authenticated INSERT policy
 *     on transactions/classifications — creation has always been service-role only).
 *
 * It bypasses RLS, so NEVER import this into a Client Component or expose the key. The key is
 * read from SUPABASE_SERVICE_ROLE_KEY (not NEXT_PUBLIC_), so it is never bundled to the browser.
 * Untyped on purpose so `.from("bank_connections")` works without the generated Database type.
 */
export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Service-role client requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
