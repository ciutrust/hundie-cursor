-- Revoke the reconcile RPCs from authenticated — finish what 20260714121000 started.
--
-- That migration revoked reconcile_capture/unreconcile_capture from public+anon believing that made
-- them service-role-only. It didn't: Supabase's default privileges grant EXECUTE to authenticated
-- DIRECTLY, not just through public, and that direct grant survives a revoke from public — the live
-- DB confirms has_function_privilege('authenticated', ..., 'EXECUTE') = true for both. They are
-- SECURITY DEFINER, so an authenticated browser session could call them via supabase.rpc() and walk
-- straight past the intended service-role-only boundary. Revoking from authenticated closes that
-- door; the server's service-role client keeps EXECUTE and stays the only caller.

revoke execute on function reconcile_capture(uuid, uuid) from authenticated;
revoke execute on function unreconcile_capture(uuid) from authenticated;
