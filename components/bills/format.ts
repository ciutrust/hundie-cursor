/** Format an ISO date (YYYY-MM-DD) as a short "Jul 15" label, timezone-safe. */
export function formatBillDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
