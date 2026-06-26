"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type AppError = Error & { digest?: string };

export default function Error({ error, reset }: { error: AppError; reset: () => void }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Mirror the error into the browser console as well.
    console.error("App error boundary:", error);
  }, [error]);

  const details = [
    error.digest ? `digest:  ${error.digest}` : null,
    error.name ? `name:    ${error.name}` : null,
    error.message ? `message: ${error.message}` : null,
    error.stack ? `\n${error.stack}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  async function copyDetails() {
    try {
      await navigator.clipboard.writeText(details || "(no client-visible details)");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be unavailable; ignore
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-8">
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <p className="text-sm text-muted-foreground">
        An error occurred while rendering this page. Use &ldquo;Try again&rdquo; to re-render, or
        expand the log entry for the message and trace.
      </p>

      <Button type="button" variant="outline" onClick={() => reset()}>
        Try again
      </Button>

      <div className="rounded-lg border border-border bg-card">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <span>{open ? "Log entry expanded" : "Log entry collapsed"}</span>
          <span aria-hidden className="text-xs">
            {open ? "▾ Hide" : "▸ Show"}
          </span>
        </button>

        {open ? (
          <div className="space-y-3 border-t border-border p-4">
            {details ? (
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/30 p-3 text-xs leading-relaxed text-foreground/90">
                {details}
              </pre>
            ) : (
              <p className="text-xs text-muted-foreground">No client-visible details available.</p>
            )}

            {error.digest ? (
              <p className="text-[11px] leading-relaxed text-muted-foreground/70">
                In production, Next.js omits the server error message and stack from the browser. The
                full trace lives server-side — match this{" "}
                <code className="rounded bg-muted/40 px-1">digest</code> in Vercel &rarr; Logs (or
                your <code className="rounded bg-muted/40 px-1">npm run dev</code> terminal) to find
                it. The complete message and stack show here automatically in development.
              </p>
            ) : null}

            <Button type="button" variant="ghost" size="sm" onClick={copyDetails}>
              {copied ? "Copied" : "Copy details"}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
