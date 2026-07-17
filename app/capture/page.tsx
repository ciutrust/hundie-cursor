import { CaptureForm } from "@/components/capture/capture-form";
import { getOpenExpenseReports } from "@/lib/queries/expense-reports";

/**
 * The counter screen. Open reports only: a paid report has already been filed and reimbursed, so a
 * receipt dropped into one would never be claimed — and unlike addToExpenseReport, createExpenseCapture
 * doesn't check paid_at, so this list IS the guard.
 */
export default async function CapturePage() {
  const reports = await getOpenExpenseReports();

  return (
    <div className="mx-auto w-full max-w-md space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Capture receipt</h1>
        <p className="text-sm text-muted-foreground">
          Shoot it now, sort it later. The receipt is saved before the photo finishes uploading.
        </p>
      </div>

      <CaptureForm reports={reports} />
    </div>
  );
}
