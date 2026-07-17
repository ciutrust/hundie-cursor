export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-md space-y-6" aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-4 w-72 max-w-full animate-pulse rounded bg-muted" />
      </div>
      <div className="h-64 animate-pulse rounded-xl border border-border bg-card" />
      <div className="space-y-3">
        <div className="h-10 animate-pulse rounded-lg bg-muted" />
        <div className="h-10 animate-pulse rounded-lg bg-muted" />
      </div>
    </div>
  );
}
