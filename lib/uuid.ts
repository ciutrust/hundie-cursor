/**
 * RFC-4122 UUID (any version) format check. Used by the Plaid API routes (S12) to reject malformed
 * ids with a 400 instead of letting them reach Postgres and surface as a 500. No cross-tenant risk
 * (single-tenant, lookups by id) — this is purely input hygiene / correct status codes.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
