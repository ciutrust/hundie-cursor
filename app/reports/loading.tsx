export default function Loading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <div className="h-4 w-20 animate-pulse rounded bg-muted" />
        <div className="h-9 w-64 animate-pulse rounded bg-muted" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded bg-muted" />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {Array.from({ length: 15 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg border border-border bg-card" />
        ))}
      </div>
    </div>
  );
}
