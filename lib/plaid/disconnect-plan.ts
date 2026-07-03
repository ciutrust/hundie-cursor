/**
 * S7: decide whether the disconnect route may delete the local connection row.
 *
 * Deleting the only copy of the access token while the item is still authorized at Plaid orphans a
 * live bank authorization with no retry path. So we only delete when there is nothing left to revoke
 * (no decryptable token) OR the Plaid revoke succeeded. A failed revoke keeps the row for retry.
 */
export type RevokeOutcome = { ok: boolean };

export function shouldDeleteConnection(revoke: RevokeOutcome | null): boolean {
  // null  → no decryptable token (dead/rotated key): nothing to revoke, safe to delete the row.
  // ok    → revoked at Plaid: delete.
  // !ok   → revoke failed: KEEP the row so the operator can retry (don't orphan the authorization).
  return revoke === null || revoke.ok;
}
