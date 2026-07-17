"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, ImageIcon, Loader2, MapPin, PencilLine, TriangleAlert } from "lucide-react";
import {
  createCapturePhotoUpload,
  createExpenseCapture,
  markCapturePhotoStatus,
  updateExpenseCapture,
} from "@/lib/actions/expense-captures";
import { createExpenseReport } from "@/lib/actions/expense-reports";
import { formatExpenseReportNumber } from "@/lib/date-range";
import { downscaleImage } from "@/lib/receipts/downscale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type OpenReport = { id: string; number: number; name: string };

const BUCKET = "receipts";
const STORAGE_KEY = "hundie.capture.report-id";
/** Sentinel: Radix Select items must carry a non-empty value, so "+ New report" needs one. */
const NEW_REPORT_VALUE = "__new__";

/**
 * How long the save will wait on a fix. NOT the geolocation timeout (that's 8s) — this is the deadline
 * for the fix being on the ROW. The downscale runs concurrently and eats ~200-500ms of it for free, and
 * a cached fix (maximumAge below) returns instantly. Past this the row goes out with nulls: there is no
 * way to attach coordinates afterwards (updateExpenseCapture takes no lat/long), but a receipt with no
 * pin is worth infinitely more than a pin with no receipt.
 */
const GEO_SAVE_DEADLINE_MS = 2500;
/** Waits BEFORE retries 1/2/3 — 4 upload attempts total. */
const UPLOAD_BACKOFF_MS = [1000, 3000, 9000];

type Coords = { latitude: number; longitude: number; accuracyM: number | null };

type GeoState =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "located"; accuracyM: number | null }
  | { status: "none" };

type Busy = "idle" | "processing" | "saving" | "uploading" | "retrying";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fires ONLY from the file `change` handler — never on mount.
 *
 * On iOS a denial is permanent: JS cannot re-prompt, ever. Prompting on page load means he dismisses it
 * while reaching for the camera and location dies for good. Asking mid-shot ties the prompt to an
 * action he just took, which is the only framing where "Allow" is the obvious answer.
 *
 * enableHighAccuracy:false on purpose — high accuracy blocks on a SATELLITE fix that may never arrive
 * inside a restaurant. We want "which restaurant", not which table.
 */
function requestLocation(): Promise<Coords | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyM: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
        }),
      // Denied, unavailable, timed out: all the same non-event. Never surfaces as an error.
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 },
    );
  });
}

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([promise, sleep(ms).then(() => null)]);
}

/**
 * "$47.50" / "R$ 89,90" / "1.234,56" -> a positive number (a receipt total is an outflow).
 *
 * WHY THIS ISN'T `parseFloat(raw.replace(/[^0-9.]/g, ""))`: that reads "47,50" as 4750 — a silent 100x
 * on a money field. AC types on a pt-BR keyboard, where the decimal key IS a comma, and he expenses
 * Brazilian meals. And a wrong amount doesn't just look wrong: getCaptureMatchSuggestion pre-filters
 * candidate charges BY amount, so a 100x capture matches nothing and never reconciles.
 *
 * The rule: the LAST separator wins (that's what tells "1,234.56" from "1.234,56"), and it's a decimal
 * point only if 1-2 digits follow it. Three trailing digits is grouping — "1.234" is 1234, never 1.234,
 * because a receipt for a fifth of a cent doesn't exist.
 */
function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.,]/g, "");
  if (!cleaned) return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  const separatorAt = Math.max(lastComma, lastDot);

  let normalized: string;
  if (separatorAt === -1) {
    normalized = cleaned;
  } else {
    const trailingDigits = cleaned.length - separatorAt - 1;
    const mixedSeparators = lastComma !== -1 && lastDot !== -1;
    const occursOnce = cleaned.indexOf(cleaned[separatorAt]!) === separatorAt;
    const isDecimal = trailingDigits >= 1 && trailingDigits <= 2 && (mixedSeparators || occursOnce);
    normalized = isDecimal
      ? `${cleaned.slice(0, separatorAt).replace(/[.,]/g, "")}.${cleaned.slice(separatorAt + 1)}`
      : cleaned.replace(/[.,]/g, "");
  }

  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100) / 100;
}

function defaultReportName(): string {
  return `${new Date().toLocaleString("en-US", { month: "short", year: "numeric" })} travel`;
}

/**
 * The remembered report, read as an EXTERNAL STORE rather than copied into state by an effect.
 * localStorage doesn't exist during SSR, so the server snapshot is null and the first paint falls back
 * to the newest open report; React then re-reads on the client. Reading it this way keeps the selection
 * a derived value — there's no second source of truth to drift, and no cascading render on mount.
 */
const subscribeToRememberedReport = (onChange: () => void) => {
  // Same-tab writes go through selectReport, which sets the override directly; this only catches a
  // change made in another tab.
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};
const readRememberedReport = () => window.localStorage.getItem(STORAGE_KEY);
const noRememberedReport = () => null;

export function CaptureForm({ reports }: { reports: OpenReport[] }) {
  const router = useRouter();

  const [createdReports, setCreatedReports] = useState<OpenReport[]>([]);
  /** An explicit tap this session. Beats the remembered id; absent, the remembered id wins. */
  const [pickedReportId, setPickedReportId] = useState<string | null>(null);
  const [showNewReport, setShowNewReport] = useState(false);
  const [newReportName, setNewReportName] = useState("");
  const [creatingReport, setCreatingReport] = useState(false);

  const [captureKind, setCaptureKind] = useState<"card" | "cash">("card");
  const [vendor, setVendor] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  /** "No receipt" mode: some spend hands you nothing (a cash tip, a parking meter). */
  const [manualMode, setManualMode] = useState(false);

  const [captureId, setCaptureId] = useState<string | null>(null);
  /** What the committed row actually says, which is NOT the toggle — see the toggle's comment. */
  const [committedKind, setCommittedKind] = useState<"card" | "cash">("card");
  const [busy, setBusy] = useState<Busy>("idle");
  const [geo, setGeo] = useState<GeoState>({ status: "idle" });
  const [photoState, setPhotoState] = useState<"none" | "uploaded" | "failed">("none");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [detailsSaved, setDetailsSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Held so a failed upload can be retried without making him re-shoot the receipt. */
  const pendingPhoto = useRef<{ captureId: string; blob: Blob } | null>(null);

  // createExpenseReport revalidates /transactions and /expense-reports but NOT /capture, so a report
  // made here wouldn't come back in props until a refresh lands. Merging locally means the picker shows
  // it the instant it exists, and the refresh below just converges.
  const openReports = useMemo(() => {
    const byId = new Map<string, OpenReport>();
    for (const report of [...reports, ...createdReports]) byId.set(report.id, report);
    return [...byId.values()].sort((a, b) => b.number - a.number);
  }, [reports, createdReports]);

  const rememberedReportId = useSyncExternalStore(
    subscribeToRememberedReport,
    readRememberedReport,
    noRememberedReport,
  );

  /**
   * Every candidate is validated against the OPEN list: a remembered report that has since been paid
   * must never be written into (createExpenseCapture, unlike addToExpenseReport, does NOT check
   * paid_at), and a deleted one would file receipts nowhere. Falling back to the newest open report is
   * what makes a multi-day trip zero taps after day one.
   */
  const reportId = useMemo(() => {
    const isOpen = (id: string | null) => Boolean(id) && openReports.some((r) => r.id === id);
    if (isOpen(pickedReportId)) return pickedReportId;
    if (isOpen(rememberedReportId)) return rememberedReportId;
    return openReports[0]?.id ?? null;
  }, [pickedReportId, rememberedReportId, openReports]);

  // Revokes the PREVIOUS url when the preview changes, and the last one on unmount.
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function selectReport(id: string) {
    setPickedReportId(id);
    window.localStorage.setItem(STORAGE_KEY, id);
  }

  async function handleCreateReport() {
    const name = newReportName.trim();
    if (!name || creatingReport) return;

    setCreatingReport(true);
    setError(null);
    // An empty report is the point: the receipts land first and the charges get added weeks later,
    // once they actually post.
    const result = await createExpenseReport({ name, transactionIds: [], assignJobW2: false });
    setCreatingReport(false);

    if ("error" in result) {
      setError(result.error);
      return;
    }

    setCreatedReports((current) => [...current, { id: result.id, number: result.number, name }]);
    selectReport(result.id);
    setShowNewReport(false);
    setNewReportName("");
    router.refresh();
  }

  async function uploadPhoto(path: string, token: string, blob: Blob): Promise<boolean> {
    // Dynamic on purpose: supabase-js is only needed once a photo is actually being uploaded, and
    // pulling it out of the initial chunk keeps the counter screen's first paint light.
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    for (let attempt = 0; ; attempt++) {
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .uploadToSignedUrl(path, token, blob, {
          // downscaleImage hands back the ORIGINAL file when re-encoding wouldn't shrink it, so the
          // blob isn't always a JPEG. Declaring the wrong type here is what makes a photo render broken.
          contentType: blob.type || "image/jpeg",
        });
      if (!uploadError) return true;

      const wait = UPLOAD_BACKOFF_MS[attempt];
      if (wait === undefined) return false;
      await sleep(wait);
    }
  }

  async function finishUpload(id: string, path: string, token: string, blob: Blob) {
    const uploaded = await uploadPhoto(path, token, blob);
    await markCapturePhotoStatus({ id, status: uploaded ? "uploaded" : "failed" });
    setPhotoState(uploaded ? "uploaded" : "failed");
    pendingPhoto.current = uploaded ? null : { captureId: id, blob };
    setBusy("idle");
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Same file twice in a row wouldn't re-fire change without this.
    event.target.value = "";
    if (!file || !reportId || busy !== "idle") return;

    // A shot taken while a capture is already committed starts a NEW one — so the last receipt's
    // vendor/amount/note must not ride along onto it.
    const startingFresh = captureId !== null;
    const draft = startingFresh
      ? { vendor: null, amount: null, note: null }
      : { vendor: vendor.trim() || null, amount: parseAmount(amount), note: note.trim() || null };
    if (startingFresh) {
      setVendor("");
      setAmount("");
      setNote("");
    }

    setError(null);
    setDetailsSaved(false);
    setCaptureId(null);
    setPhotoState("none");
    pendingPhoto.current = null;
    setBusy("processing");
    setGeo({ status: "locating" });

    // Both in flight at once: the fix costs nothing it doesn't overlap with the downscale.
    const [blob, coords] = await Promise.all([
      downscaleImage(file),
      withDeadline(requestLocation(), GEO_SAVE_DEADLINE_MS),
    ]);
    // Reports what actually made it onto the row. A fix landing after the deadline is NOT "Located" —
    // saying so would be a lie about the data.
    setGeo(coords ? { status: "located", accuracyM: coords.accuracyM } : { status: "none" });
    setPreviewUrl(URL.createObjectURL(blob));

    setBusy("saving");
    const result = await createExpenseCapture({
      expenseReportId: reportId,
      captureKind,
      vendor: draft.vendor,
      amount: draft.amount,
      note: draft.note,
      latitude: coords?.latitude ?? null,
      longitude: coords?.longitude ?? null,
      locationAccuracyM: coords?.accuracyM ?? null,
      withPhoto: true,
    });

    if ("error" in result) {
      setError(result.error);
      setBusy("idle");
      return;
    }

    // Durable from here. Everything below is the photo, and the UI says so.
    setCaptureId(result.captureId);
    setCommittedKind(captureKind);
    // Back to Card for the NEXT shot. Sticky Cash is a money bug: a card meal left marked cash is
    // terminal, so it never reconciles, and when the charge posts BOTH lines stand and the report reads
    // high. The reverse is harmless — a cash receipt marked card just waits in the queue, visible.
    setCaptureKind("card");
    if (!result.upload) {
      setPhotoState("failed");
      pendingPhoto.current = { captureId: result.captureId, blob };
      setBusy("idle");
      return;
    }

    setBusy("uploading");
    await finishUpload(result.captureId, result.upload.path, result.upload.token, blob);
  }

  /**
   * Re-attach a photo to the capture that already exists, instead of starting a new one.
   *
   * This is the anti-double-count path. Without it, "that shot came out blurry" means tapping the big
   * camera button, which mints a SECOND capture for the same meal — two lines on the report, and the
   * total silently reads high. Re-minting upserts to the same storage path, so the bad photo is
   * replaced rather than orphaned. Deliberately does NOT re-request location: the row's fix is from
   * where the receipt was, and this re-shoot might happen in the hotel that night.
   */
  async function handleReplacePhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !captureId || busy !== "idle") return;

    setError(null);
    setBusy("processing");
    const blob = await downscaleImage(file);
    setPreviewUrl(URL.createObjectURL(blob));

    setBusy("uploading");
    const minted = await createCapturePhotoUpload(captureId);
    if ("error" in minted) {
      setError(minted.error);
      setPhotoState("failed");
      pendingPhoto.current = { captureId, blob };
      setBusy("idle");
      return;
    }
    await finishUpload(captureId, minted.path, minted.token, blob);
  }

  async function handleRetryPhoto() {
    const pending = pendingPhoto.current;
    if (!pending || busy !== "idle") return;

    setError(null);
    setBusy("retrying");
    // Re-mint rather than reuse: the original token may have expired, and this one upserts, so a partial
    // object from the failed attempt can't block the write.
    const minted = await createCapturePhotoUpload(pending.captureId);
    if ("error" in minted) {
      setError(minted.error);
      setBusy("idle");
      return;
    }
    await finishUpload(pending.captureId, minted.path, minted.token, pending.blob);
  }

  /**
   * Log an expense that never had a receipt — a cash tip, a parking meter, a counter that hands you
   * nothing.
   *
   * Deliberately INVERTED from the photo flow. There the photo IS the artifact, so the row is created
   * the instant the shutter fires and the typing is optional enrichment. Here the typing is the only
   * record there will ever be, so a row with nothing on it is worthless: the amount is required and the
   * row is created on save, not before.
   */
  async function handleSaveManual() {
    const parsed = parseAmount(amount);
    if (!reportId || busy !== "idle" || parsed == null || parsed <= 0) return;

    setError(null);
    setBusy("saving");
    setGeo({ status: "locating" });
    // Same rule as the photo path: the fix is requested on the ACTION, never on page load (a reflexive
    // denial is sticky and JS can never re-prompt), and it never blocks the save.
    const coords = await withDeadline(requestLocation(), GEO_SAVE_DEADLINE_MS);
    setGeo(coords ? { status: "located", accuracyM: coords.accuracyM } : { status: "none" });

    const result = await createExpenseCapture({
      expenseReportId: reportId,
      captureKind,
      vendor: vendor.trim() || null,
      amount: parsed,
      note: note.trim() || null,
      latitude: coords?.latitude ?? null,
      longitude: coords?.longitude ?? null,
      locationAccuracyM: coords?.accuracyM ?? null,
      withPhoto: false,
    });
    setBusy("idle");

    if ("error" in result) {
      setError(result.error);
      return;
    }

    setCaptureId(result.captureId);
    setCommittedKind(captureKind);
    setPhotoState("none");
    setPreviewUrl(null);
    setDetailsSaved(true);
    setManualMode(false);
    // Back to Card for the next one — sticky Cash is the money bug documented in handleFile.
    setCaptureKind("card");
  }

  async function handleSaveDetails() {
    if (!captureId || busy !== "idle") return;

    setBusy("saving");
    setError(null);
    // captureKind is deliberately NOT sent: the toggle has already reset to Card for the next shot, so
    // pushing it here would silently flip a committed cash capture to card. Kind is fixed at shot time;
    // correcting it is the match screen's job (markCaptureAsCash).
    const result = await updateExpenseCapture({
      id: captureId,
      vendor: vendor.trim() || null,
      amount: parseAmount(amount),
      note: note.trim() || null,
    });
    setBusy("idle");

    if ("error" in result) {
      setError(result.error);
      return;
    }
    setDetailsSaved(true);
  }

  const working = busy !== "idle";
  const canCapture = Boolean(reportId) && !working;
  // A no-photo capture with no amount is nothing at all — there is no receipt to fall back on and it
  // would land on the report as a $0 phantom line. The photo path has no such gate: there the image
  // carries the vendor and amount even when he never types them.
  const manualAmountValid = (() => {
    const parsed = parseAmount(amount);
    return parsed != null && parsed > 0;
  })();

  /** One definition, rendered by both the post-photo card and the no-receipt card. */
  const detailFields = (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="capture-vendor" className="text-sm">
          Vendor
        </Label>
        <Input
          id="capture-vendor"
          className="min-h-14 text-base"
          placeholder="Where was it"
          value={vendor}
          onChange={(event) => {
            setVendor(event.target.value);
            setDetailsSaved(false);
          }}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="capture-amount" className="text-sm">
          Amount
        </Label>
        {/* No autoFocus anywhere on this screen: the keyboard would cover the camera button. */}
        <Input
          id="capture-amount"
          type="text"
          inputMode="decimal"
          className="min-h-14 text-base tabular-nums"
          placeholder="47.00"
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
            setDetailsSaved(false);
          }}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="capture-note" className="text-sm">
          Note
        </Label>
        <Input
          id="capture-note"
          className="min-h-14 text-base"
          placeholder="Who was there, what for"
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
            setDetailsSaved(false);
          }}
        />
      </div>
    </div>
  );
  const selected = openReports.find((report) => report.id === reportId) ?? null;

  return (
    <div className="space-y-5">
      {/* Report first: it gates the shot, because an unfiled cash capture shows up on no screen at all. */}
      <div className="space-y-2">
        <Label htmlFor="capture-report" className="text-sm">
          Report
        </Label>

        {openReports.length > 0 ? (
          <Select
            value={reportId ?? undefined}
            onValueChange={(value) =>
              value === NEW_REPORT_VALUE ? setShowNewReport(true) : selectReport(value)
            }
          >
            <SelectTrigger id="capture-report" className="min-h-14 text-base">
              <SelectValue placeholder="Pick a report" />
            </SelectTrigger>
            <SelectContent>
              {openReports.map((report) => (
                <SelectItem key={report.id} value={report.id} className="py-3 text-base">
                  {formatExpenseReportNumber(report.number)} · {report.name}
                </SelectItem>
              ))}
              <SelectItem value={NEW_REPORT_VALUE} className="py-3 text-base">
                + New report
              </SelectItem>
            </SelectContent>
          </Select>
        ) : null}

        {showNewReport || openReports.length === 0 ? (
          <div className="space-y-2 rounded-lg border border-border bg-card p-3">
            <Label htmlFor="capture-new-report" className="text-sm">
              New report name
            </Label>
            <Input
              id="capture-new-report"
              className="min-h-14 text-base"
              placeholder="Cursor onsite - Aug"
              value={newReportName}
              onFocus={() => {
                if (!newReportName) setNewReportName(defaultReportName());
              }}
              onChange={(event) => setNewReportName(event.target.value)}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                className="min-h-14 flex-1 text-base"
                disabled={creatingReport || !newReportName.trim()}
                onClick={handleCreateReport}
              >
                {creatingReport ? "Creating…" : "Create report"}
              </Button>
              {openReports.length > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-14 text-base"
                  onClick={() => setShowNewReport(false)}
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {/*
        Card is the default; cash is the one-tap exception. This describes the shot he is ABOUT to take
        and nothing else — it is not an editor for the capture already on screen. Kind is locked in at
        shot time, which is why it resets to Card after every commit.
      */}
      <div className="space-y-2">
        <Label className="text-sm">Paid with</Label>
        <div
          role="radiogroup"
          aria-label="Paid with"
          className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-card p-1"
        >
          {(["card", "cash"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={captureKind === kind}
              onClick={() => setCaptureKind(kind)}
              className={cn(
                "min-h-14 rounded-md text-base font-medium capitalize transition-colors",
                captureKind === kind
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {kind}
            </button>
          ))}
        </div>
        {captureKind === "cash" ? (
          <p className="text-xs text-muted-foreground">
            No charge is coming for cash, so this line stands on its own.
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <input
          id="capture-camera"
          type="file"
          accept="image/*"
          // Opens the camera DIRECTLY on iOS — no "Take Photo / Library" sheet. Worth a tap every time.
          capture="environment"
          className="sr-only"
          disabled={!canCapture}
          onChange={handleFile}
        />
        <label
          htmlFor="capture-camera"
          className={cn(
            "flex min-h-32 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-card text-base font-semibold transition-colors",
            canCapture
              ? "hover:border-primary hover:bg-accent"
              : "pointer-events-none cursor-not-allowed opacity-50",
          )}
        >
          {working ? (
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          ) : (
            <Camera className="h-8 w-8 text-muted-foreground" />
          )}
          <span>
            {busy === "processing"
              ? "Processing…"
              : busy === "saving"
                ? "Saving…"
                : busy === "uploading" || busy === "retrying"
                  ? "Uploading photo…"
                  : captureId
                    ? "Capture next receipt"
                    : "Take photo of receipt"}
          </span>
          {!reportId ? (
            <span className="text-xs font-normal text-muted-foreground">Pick a report first</span>
          ) : selected && !working && !captureId ? (
            <span className="text-xs font-normal text-muted-foreground">
              Into {formatExpenseReportNumber(selected.number)} · {selected.name}
            </span>
          ) : null}
        </label>

        <GeoLine geo={geo} />
      </div>

      {error ? (
        <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}

      {captureId ? (
        <div className="space-y-4 rounded-xl border border-emerald-600/40 bg-emerald-50/60 p-4 dark:bg-emerald-950/20">
          <div className="flex items-start gap-3">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- an object URL, not a remote asset
              <img
                src={previewUrl}
                alt="Receipt just captured"
                className="h-20 w-20 shrink-0 rounded-md border border-border object-cover"
              />
            ) : null}
            <div className="min-w-0 space-y-1">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                {/* Don't claim a receipt he never took: a no-photo capture saved fine, it just has no image. */}
                <Check className="h-4 w-4" /> {previewUrl ? "Receipt saved" : "Expense saved"}
              </p>
              {/* Same wording the report lines use, so the two screens read as one system. */}
              <p className="text-xs text-muted-foreground">
                {committedKind === "cash" ? "Cash" : "Card · awaiting charge"}
              </p>
              <PhotoLine state={photoState} busy={busy} onRetry={handleRetryPhoto} />
              {/* No `capture` attr: the iOS sheet offers re-shoot AND library, and on the rare bad
                  photo that extra tap is worth having both. */}
              <input
                id="capture-replace"
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={working}
                onChange={handleReplacePhoto}
              />
              <label
                htmlFor="capture-replace"
                className={cn(
                  "inline-block cursor-pointer text-xs text-muted-foreground underline underline-offset-4",
                  working ? "pointer-events-none opacity-50" : "hover:text-foreground",
                )}
              >
                {/* handleReplacePhoto keys off captureId, so a no-photo capture can gain one later for free. */}
                {previewUrl ? "Replace photo" : "Add a photo"}
              </label>
            </div>
          </div>

          {/* Optional, and it says so: the row is already durable, this is just what makes it readable. */}
          {detailFields}

          <Button
            type="button"
            variant="outline"
            className="min-h-14 w-full text-base"
            disabled={working}
            onClick={handleSaveDetails}
          >
            {busy === "saving" ? "Saving…" : detailsSaved ? "Details saved" : "Save details"}
          </Button>
        </div>
      ) : null}

      {/* No receipt: the fields ARE the record here, so nothing is written until he taps Save. */}
      {manualMode && !captureId ? (
        <div className="space-y-4 rounded-xl border border-border bg-card p-4">
          <div className="space-y-1">
            <p className="text-sm font-semibold">Log it without a photo</p>
            <p className="text-xs text-muted-foreground">
              For spend that never gives you a receipt. The amount is what puts it on the report, so
              it is required here.
            </p>
          </div>

          {detailFields}

          <div className="flex gap-2">
            <Button
              type="button"
              className="min-h-14 flex-1 text-base"
              disabled={working || !manualAmountValid}
              onClick={handleSaveManual}
            >
              {busy === "saving" ? "Saving…" : "Save expense"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-14 text-base"
              disabled={working}
              onClick={() => setManualMode(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      <div>
        <input
          id="capture-library"
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={!canCapture}
          onChange={handleFile}
        />
        <label
          htmlFor="capture-library"
          className={cn(
            "flex min-h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-lg text-sm text-muted-foreground",
            canCapture ? "hover:text-foreground" : "pointer-events-none opacity-50",
          )}
        >
          <ImageIcon className="h-4 w-4" />
          {/* Says "new" once a capture is on screen, so it can't be mistaken for Replace photo above. */}
          {captureId ? "New capture from library" : "Choose from library"}
        </label>

        {/* Secondary on purpose: most spend hands you a receipt, so the camera stays the primary
            action. Hidden while the no-receipt card is already open, and while a capture is on screen
            (tapping it there would start a second line for the same spend). */}
        {!manualMode && !captureId ? (
          <button
            type="button"
            disabled={!canCapture}
            onClick={() => setManualMode(true)}
            className={cn(
              "flex min-h-14 w-full items-center justify-center gap-2 rounded-lg text-sm text-muted-foreground",
              canCapture ? "hover:text-foreground" : "pointer-events-none opacity-50",
            )}
          >
            <PencilLine className="h-4 w-4" />
            No receipt? Log it without a photo
          </button>
        ) : null}
      </div>
    </div>
  );
}

function GeoLine({ geo }: { geo: GeoState }) {
  if (geo.status === "idle") return null;

  const text =
    geo.status === "locating"
      ? "Locating…"
      : geo.status === "located"
        ? geo.accuracyM
          ? `Located (±${Math.round(geo.accuracyM)}m)`
          : "Located"
        : "No location";

  return (
    <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
      <MapPin className="h-3 w-3" />
      {text}
    </p>
  );
}

function PhotoLine({
  state,
  busy,
  onRetry,
}: {
  state: "none" | "uploaded" | "failed";
  busy: Busy;
  onRetry: () => void;
}) {
  if (busy === "uploading" || busy === "retrying") {
    return <p className="text-xs text-muted-foreground">Uploading photo… you can walk away.</p>;
  }
  if (state === "uploaded") {
    return <p className="text-xs text-muted-foreground">Photo attached.</p>;
  }
  if (state === "failed") {
    return (
      <div className="space-y-1">
        {/* Never "the capture failed" — it didn't. Only the image is missing. */}
        <p className="text-xs text-amber-700 dark:text-amber-500">
          Photo didn&apos;t upload. The receipt itself is saved.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="text-xs font-medium underline underline-offset-4"
        >
          Retry photo
        </button>
      </div>
    );
  }
  return null;
}
