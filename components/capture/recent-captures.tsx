import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { ImageIcon } from "lucide-react";
import { CapturePhotoRetry } from "@/components/capture/capture-photo-retry";
import { formatExpenseReportNumber } from "@/lib/date-range";
import { signCapturePhotoUrls } from "@/lib/queries/expense-captures";
import { getRecentCaptures } from "@/lib/queries/recent-captures";
import { formatCurrency } from "@/lib/utils";

/**
 * "1m ago" / "2h ago" / "3d ago". Coarse on purpose - this strip answers "did the last few shots
 * save?", not "when exactly". No deps, no client JS.
 */
function relativeTime(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * The last few captures, streamed in below the form. Its own async server component inside
 * <Suspense> so the camera button paints without waiting on this query - the strip is a
 * confirmation glance, never the critical path. A throw during streaming would bubble past the
 * Suspense boundary to the ROOT error page and unmount the half-filled form, so this component
 * swallows its own failures and vanishes instead.
 */
export async function RecentCaptures() {
  let captures;
  let signed;
  try {
    captures = await getRecentCaptures();
    if (captures.length === 0) return null;

    signed = await signCapturePhotoUrls(
      captures
        .filter((row) => row.photo_status === "uploaded" && row.photo_path)
        .map((row) => row.photo_path!),
    );
  } catch (error) {
    // Next's control-flow "errors" (dynamic-server-usage during build prerender, redirects) must
    // pass through, or the framework mis-learns what this route needs.
    unstable_rethrow(error);
    console.error("RecentCaptures failed:", error);
    return null;
  }

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">Recent</h2>
      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {captures.map((row) => {
          const photoUrl = row.photo_path ? signed.get(row.photo_path) : undefined;
          const photoMissing = row.photo_status === "pending" || row.photo_status === "failed";

          return (
            <li key={row.id} className="flex min-h-16 items-center gap-3 p-3">
              {photoUrl ? (
                // Signed Storage URLs are 1h-lived and not a configured next/image host, so a plain img.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photoUrl}
                  alt={`Receipt${row.vendor ? `: ${row.vendor}` : ""}`}
                  className="size-12 shrink-0 rounded-md border border-border object-cover"
                />
              ) : (
                <span className="flex size-12 shrink-0 items-center justify-center rounded-md border border-dashed border-border bg-muted/40">
                  <ImageIcon className="h-4 w-4 text-muted-foreground" />
                </span>
              )}

              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-sm font-medium">{row.vendor ?? "No vendor"}</p>
                  {row.amount != null ? (
                    <p className="shrink-0 text-sm tabular-nums">{formatCurrency(row.amount)}</p>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span>{relativeTime(row.captured_at)}</span>
                  {row.expense_report ? (
                    <Link
                      href={`/expense-reports/${row.expense_report.number}`}
                      className="underline underline-offset-4 hover:text-foreground"
                    >
                      {formatExpenseReportNumber(row.expense_report.number)} ·{" "}
                      {row.expense_report.name}
                    </Link>
                  ) : null}
                  {/* uploaded needs no chip - the thumb speaks for itself. */}
                  {row.photo_status === "none" ? (
                    <span className="rounded-full border border-border px-2 py-0.5">No photo</span>
                  ) : null}
                  {photoMissing ? (
                    <span className="rounded-full border border-amber-600/40 bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-500">
                      Photo missing
                    </span>
                  ) : null}
                  {photoMissing ? <CapturePhotoRetry captureId={row.id} /> : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
