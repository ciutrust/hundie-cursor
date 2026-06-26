/**
 * Accept-rate by suggestion source — the measurement the review asks for before
 * tuning the deterministic weights or deciding "is the LLM better than the engine?".
 * Pure so it can be unit-tested; the query layer feeds it suggestion_events rows.
 */
export type AcceptanceEvent = { event_type: string; suggestion_source: string | null };

export type AcceptanceBySource = {
  source: string;
  shown: number;
  accepted: number;
  rejected: number;
  accept_rate: number;
};

export function acceptanceBySource(events: AcceptanceEvent[]): AcceptanceBySource[] {
  const buckets = new Map<string, { shown: number; accepted: number; rejected: number }>();

  for (const event of events) {
    const source = event.suggestion_source?.trim() || "manual";
    const bucket = buckets.get(source) ?? { shown: 0, accepted: 0, rejected: 0 };
    bucket.shown += 1;
    if (event.event_type === "accept") bucket.accepted += 1;
    else if (event.event_type === "reject") bucket.rejected += 1;
    buckets.set(source, bucket);
  }

  return [...buckets.entries()]
    .map(([source, stats]) => ({
      source,
      shown: stats.shown,
      accepted: stats.accepted,
      rejected: stats.rejected,
      accept_rate: stats.shown > 0 ? stats.accepted / stats.shown : 0,
    }))
    .sort((a, b) => b.shown - a.shown);
}
