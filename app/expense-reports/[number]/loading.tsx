export default function Loading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <div className="h-4 w-40 animate-pulse rounded bg-muted" />
        <div className="h-9 w-96 max-w-full animate-pulse rounded bg-muted" />
        <div className="h-4 w-64 max-w-full animate-pulse rounded bg-muted" />
      </div>
      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-10 animate-pulse rounded bg-muted" />
        ))}
      </div>
    </div>
  );
}
