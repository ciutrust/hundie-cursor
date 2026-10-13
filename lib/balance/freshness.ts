const STALE_AFTER_MS = 90 * 24 * 60 * 60 * 1000;

/** Calendar date in Central time, plus a stale flag after 90 days. */
export function freshness(iso: string | null | undefined): { label: string; stale: boolean } {
  if (!iso) return { label: "Never updated", stale: true };
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { label: "Never updated", stale: true };
  const formatted = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Chicago",
  });
  return {
    label: `Updated ${formatted}`,
    stale: Date.now() - date.getTime() > STALE_AFTER_MS,
  };
}
