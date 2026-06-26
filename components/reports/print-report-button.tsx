"use client";

export function PrintReportButton({ title }: { title: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        document.title = title;
        window.print();
      }}
      className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-muted"
    >
      Print / Save PDF
    </button>
  );
}
