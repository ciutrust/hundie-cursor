/** Reject open redirects; allow same-origin relative paths only. */
export function safeRedirectPath(value: string | null | undefined, fallback = "/review") {
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}
