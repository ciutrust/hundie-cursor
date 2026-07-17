/**
 * Shrink a phone photo before upload.
 *
 * WHY: a 12MP iPhone shot is 3-12MB. Over a basement-restaurant connection (~200kbps) 8MB is roughly
 * FIVE MINUTES; ~800KB is ~30s. That is the difference between this working at the counter and not.
 * Two freebies come along: the canvas re-encode normalizes iOS HEIC -> JPEG (killing a whole class of
 * "the image won't render"), and 1600px on the long edge keeps receipt text ~100-150 DPI — readable by
 * eye and good enough for a future OCR pass, where 1024 starts smearing faded thermal print.
 *
 * The canvas work can't be unit-tested (no DOM), so the arithmetic lives in a pure function and the
 * canvas call is the thin shell around it — same split as the rest of lib/.
 */

export const MAX_EDGE = 1600;
export const JPEG_QUALITY = 0.8;
/** Second pass if the first is still huge. */
const RETRY_QUALITY = 0.6;
const RETRY_OVER_BYTES = 2 * 1024 * 1024;

export type TargetSize = { width: number; height: number };

/** Fit within `maxEdge` on the long side, preserving aspect. Never upscales. */
export function computeTargetSize(width: number, height: number, maxEdge = MAX_EDGE): TargetSize {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 0, height: 0 };
  }
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width: Math.round(width), height: Math.round(height) };

  const scale = maxEdge / longest;
  return {
    // A landscape 4032x3024 -> 1600x1200. Guard the short edge against rounding to 0 on extreme ratios.
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/**
 * Browser-only. Returns a JPEG Blob, or the original file if shrinking it wouldn't help.
 *
 * `imageOrientation: "from-image"` is load-bearing: the canvas re-encode strips EXIF, so without it
 * every photo comes out rotated. It also decodes off the main thread, so the UI doesn't jank.
 */
export async function downscaleImage(file: File, maxEdge = MAX_EDGE): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const target = computeTargetSize(bitmap.width, bitmap.height, maxEdge);
    if (target.width === 0) return file;

    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, target.width, target.height);
    bitmap.close();

    let blob = await canvasToBlob(canvas, JPEG_QUALITY);
    if (blob && blob.size > RETRY_OVER_BYTES) {
      blob = (await canvasToBlob(canvas, RETRY_QUALITY)) ?? blob;
    }
    if (!blob) return file;

    // An already-small (or already-compressed) image can come out BIGGER after re-encoding.
    return blob.size < file.size ? blob : file;
  } catch {
    // A codec we can't decode shouldn't cost him the capture — send the original and let the
    // bucket's 5MB limit be the backstop.
    return file;
  }
}
