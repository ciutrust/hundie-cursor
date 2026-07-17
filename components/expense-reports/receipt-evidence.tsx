import { cn } from "@/lib/utils";

/**
 * The receipt riding on a line: photo, what he wrote, and where he was.
 *
 * Deliberately ONE component for both shapes. A standalone capture and a charge that a capture has
 * been reconciled into carry identical evidence — the whole point of the feature is that "SQ *XXXX
 * 4471" ends up looking exactly as informative as the receipt he snapped at the counter.
 */
export function ReceiptEvidence({
  photoPath,
  photoStatus,
  note,
  latitude,
  longitude,
  photoUrls,
  className,
}: {
  photoPath: string | null;
  photoStatus: string;
  note: string | null;
  latitude: number | null;
  longitude: number | null;
  /** path -> short-lived signed URL. The bucket is private; the page signs them in one batch. */
  photoUrls: Record<string, string>;
  className?: string;
}) {
  const photoUrl = photoPath ? photoUrls[photoPath] : undefined;
  const hasCoords = latitude !== null && longitude !== null;
  const mapsHref = hasCoords
    ? `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`
    : null;

  if (!photoUrl && !note && !mapsHref && photoStatus !== "failed" && photoStatus !== "pending") {
    return null;
  }

  return (
    <div className={cn("flex items-start gap-3", className)}>
      {photoUrl ? (
        <a
          href={photoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-md border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="Open the receipt full size"
        >
          {/* Signed Storage URLs are 1h-lived and not a configured next/image host, so a plain img. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photoUrl}
            alt={`Receipt${note ? `: ${note}` : ""}`}
            className="size-14 rounded-md object-cover"
          />
        </a>
      ) : photoStatus === "failed" ? (
        <span className="shrink-0 rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground">
          Photo failed
        </span>
      ) : photoStatus === "pending" && photoPath ? (
        <span className="shrink-0 rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground">
          Photo uploading
        </span>
      ) : null}

      <div className="min-w-0 space-y-1 text-xs">
        {note ? <p className="text-muted-foreground">{note}</p> : null}
        {mapsHref ? (
          <a
            href={mapsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex text-primary hover:underline print:hidden"
          >
            Where I was ↗
          </a>
        ) : null}
      </div>
    </div>
  );
}
