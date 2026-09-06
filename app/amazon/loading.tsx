export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <div className="h-3 w-16 animate-pulse rounded bg-muted" />
        <div className="h-9 w-48 animate-pulse rounded bg-muted" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded bg-muted" />
      </div>
      <div className="h-24 animate-pulse rounded-xl border border-border bg-card" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-[50vh] animate-pulse rounded-xl border border-border bg-card" />
        <div className="h-[50vh] animate-pulse rounded-xl border border-border bg-card" />
      </div>
    </div>
  );
}
