"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2 } from "lucide-react";
import { createCapturePhotoUpload, markCapturePhotoStatus } from "@/lib/actions/expense-captures";
import { downscaleImage } from "@/lib/receipts/downscale";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const BUCKET = "receipts";
/** Waits BEFORE retries 1/2/3 - 4 upload attempts total. Same schedule as the capture form. */
const UPLOAD_BACKOFF_MS = [1000, 3000, 9000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * "Add photo" for a recent capture whose image never made it up (photo_status pending or failed).
 *
 * Mirrors the capture form's replace-photo sequence exactly: downscale first, then RE-MINT a signed
 * upload (the original token may have expired, and minting upserts to the same storage path, so a
 * partial object from the failed attempt can't block the write), upload with the blob's own
 * contentType (downscaleImage hands back the ORIGINAL file when re-encoding wouldn't shrink it, so
 * the blob isn't always a JPEG), then mark the row uploaded/failed. router.refresh() re-renders the
 * server-side strip, which is where the thumb or the amber chip comes from.
 */
export function CapturePhotoRetry({ captureId }: { captureId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function uploadWithBackoff(path: string, token: string, blob: Blob): Promise<boolean> {
    const supabase = createClient();
    for (let attempt = 0; ; attempt++) {
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .uploadToSignedUrl(path, token, blob, {
          contentType: blob.type || "image/jpeg",
        });
      if (!uploadError) return true;

      const wait = UPLOAD_BACKOFF_MS[attempt];
      if (wait === undefined) return false;
      await sleep(wait);
    }
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Same file twice in a row wouldn't re-fire change without this.
    event.target.value = "";
    if (!file || busy) return;

    setError(null);
    setBusy(true);

    try {
      const blob = await downscaleImage(file);
      const minted = await createCapturePhotoUpload(captureId);
      if ("error" in minted) {
        // The row is already pending/failed on the server - nothing to mark, the chip still shows.
        setError(minted.error);
        setBusy(false);
        return;
      }

      const uploaded = await uploadWithBackoff(minted.path, minted.token, blob);
      await markCapturePhotoStatus({ id: captureId, status: uploaded ? "uploaded" : "failed" });
      if (!uploaded) setError("Upload failed. Tap to try again.");
      setBusy(false);
      router.refresh();
    } catch {
      // Downscale or a thrown network error - the row on the server is untouched, so just let
      // him try again rather than leaving the button stuck busy.
      setError("Could not process that photo. Try again.");
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      {/* No `capture` attr: the iOS sheet offers camera AND library, and the missing photo is as
          likely to be sitting in the library as still on the table. */}
      <input
        id={`capture-retry-${captureId}`}
        type="file"
        accept="image/*"
        className="sr-only"
        disabled={busy}
        onChange={handleFile}
      />
      <label
        htmlFor={`capture-retry-${captureId}`}
        className={cn(
          "inline-flex min-h-8 cursor-pointer items-center gap-1 text-xs font-medium underline underline-offset-4",
          busy ? "pointer-events-none text-muted-foreground" : "hover:text-foreground",
        )}
      >
        {busy ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" /> Uploading…
          </>
        ) : (
          <>
            <Camera className="h-3 w-3" /> Add photo
          </>
        )}
      </label>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}
