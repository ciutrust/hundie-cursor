type PgLikeError =
  | { message?: string | null; code?: string | null; details?: string | null; hint?: string | null }
  | null
  | undefined;

/**
 * Compose a non-empty, structured message from a PostgREST/Supabase error, whose `.message` is
 * frequently an empty string (E1). A raw `throw error` of such an object logs as `{ message: '' }` —
 * exactly the ×463 sidebar burst that made a 2-day production incident unrecoverable from the logs.
 */
export function pgErrorMessage(e: PgLikeError): string {
  if (!e) return "unknown error";
  const parts = [
    e.message,
    e.code ? `code=${e.code}` : null,
    e.details,
    e.hint ? `hint=${e.hint}` : null,
  ].filter((p): p is string => Boolean(p && String(p).trim()));
  return parts.length > 0
    ? parts.join(" · ")
    : "unknown PostgREST error (empty message/code/details/hint)";
}

/** An Error carrying a structured message, with the original error preserved as `cause`. */
export function pgError(context: string, e: PgLikeError): Error {
  return new Error(`${context}: ${pgErrorMessage(e)}`, { cause: e ?? undefined });
}
