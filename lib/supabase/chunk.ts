/**
 * Split an array into consecutive sub-arrays of at most `size`.
 *
 * supabase-js encodes `.in()` / `.eq()` filters into the request URL for GET/PATCH/DELETE (only
 * insert/upsert payloads travel in the body). A large id list therefore overflows the gateway URL
 * limit (~16KB ≈ 420 uuids) and hard-fails with a 400/414 — the "bad request with 1000+ rows" bug.
 * Chunk URL-side `.in()` writes/reads at ~200 ids (≈8KB) to stay well under it.
 */
export function chunk<T>(items: readonly T[], size = 200): T[][] {
  if (size < 1) throw new Error("chunk size must be >= 1");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
