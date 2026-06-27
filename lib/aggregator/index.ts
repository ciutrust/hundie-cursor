import { PlaidAggregator } from "./plaid";
import type { Aggregator } from "./types";

/**
 * Single place that picks the active aggregator. Swap the implementation here
 * (Plaid → Teller / SimpleFIN) without touching the rest of the app.
 */
export const aggregator: Aggregator = new PlaidAggregator();

export * from "./types";
