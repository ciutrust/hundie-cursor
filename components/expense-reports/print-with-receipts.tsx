"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";

/**
 * "Print with receipts": one printable artifact - the trip sheet plus every receipt photo appended -
 * so AC files a single PDF at work instead of submitting the photos separately.
 *
 * The appendix only enters the DOM on click, and it portals to document.body for two reasons:
 * 1. The button sits in the header's actions row, which is print:hidden - a child can never undo an
 *    ancestor's display:none, so the appendix must not live under it.
 * 2. Body-end placement guarantees the receipts paginate AFTER the trip sheet, wherever the button is.
 */

export type PrintReceipt = {
  /** Signed URL the page already minted in its one batch - this component never signs anything. */
  url: string;
  vendor: string;
  amount: number;
  /** YYYY-MM-DD, the same string the line shows. */
  date: string;
};

export function PrintWithReceipts({ receipts }: { receipts: PrintReceipt[] }) {
  const [show, setShow] = useState(false);
  const appendixRef = useRef<HTMLDivElement | null>(null);

  // Put the appendix away once the dialog closes - afterprint fires on print AND on cancel.
  // iOS standalone PWAs are the wrinkle: window.print() can be a no-op there and afterprint never
  // fires, which would wedge the button at "Preparing…" until a reload. The matchMedia("print")
  // listener is a second signal, and the 15s failsafe guarantees the button always comes back.
  useEffect(() => {
    if (!show) return;
    const done = () => setShow(false);

    const media = window.matchMedia("print");
    const onMedia = (event: MediaQueryListEvent) => {
      if (!event.matches) done();
    };

    window.addEventListener("afterprint", done);
    media.addEventListener("change", onMedia);
    const failsafe = window.setTimeout(done, 15_000);

    return () => {
      window.removeEventListener("afterprint", done);
      media.removeEventListener("change", onMedia);
      window.clearTimeout(failsafe);
    };
  }, [show]);

  // The appendix just mounted: wait until every image is decodable, capped at 4s, then print. The
  // cap means one dead signed URL degrades to "that receipt prints blank" instead of hanging forever.
  useEffect(() => {
    if (!show) return;
    let cancelled = false;

    const imgs = Array.from(appendixRef.current?.querySelectorAll("img") ?? []);
    // decode() waits for the in-flight fetch, then the decode; allSettled swallows dead URLs.
    const allReady = Promise.allSettled(imgs.map((img) => img.decode()));
    const cap = new Promise<void>((resolve) => {
      window.setTimeout(resolve, 4000);
    });

    void Promise.race([allReady, cap]).then(() => {
      if (!cancelled) window.print();
    });

    return () => {
      cancelled = true;
    };
  }, [show]);

  if (receipts.length === 0) return null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setShow(true)}
        disabled={show}
      >
        <Printer className="h-4 w-4" />
        {show ? "Preparing…" : "Print with receipts"}
      </Button>

      {show
        ? createPortal(
            // On screen this flashes briefly at the very bottom of the page while the dialog opens -
            // the border-t + padding keep it reading as a detached appendix rather than broken layout.
            // Dark-only app, white paper: the print: overrides force legibility regardless of theme,
            // since the .dark token values (near-white text) survive into @media print otherwise.
            <div
              ref={appendixRef}
              className="mt-10 border-t border-border px-6 py-6 print:m-0 print:break-before-page print:border-0 print:bg-white print:p-0 print:text-black"
            >
              <h2 className="text-lg font-semibold print:text-black">Receipts</h2>
              <div className="mt-4 space-y-6">
                {receipts.map((receipt) => (
                  <figure key={receipt.url} className="break-inside-avoid space-y-2">
                    {/* Short-lived signed Storage URL, not a configured next/image host - plain img. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={receipt.url}
                      alt={`Receipt: ${receipt.vendor}`}
                      className="max-h-[9in] max-w-full rounded-md border border-border object-contain print:border-neutral-300"
                    />
                    <figcaption className="text-sm text-muted-foreground print:text-black">
                      {`${receipt.vendor} - ${formatCurrency(receipt.amount)} - ${receipt.date}`}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
