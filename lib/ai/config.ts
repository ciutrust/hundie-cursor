export const AI_BACKLOG_START = "2025-01-01";
export const AI_BACKLOG_END = "2027-01-01";
export const AI_BATCH_SIZE = 25;
export const AI_ENTITY_SLUG = "personal";

/** Sonnet pricing (USD per 1M tokens) — update if model changes. */
export const AI_INPUT_USD_PER_M = 3;
export const AI_OUTPUT_USD_PER_M = 15;

export function getAiModel(): string {
  return process.env.AI_MODEL?.trim() || "claude-sonnet-4-20250514";
}

export function getAnthropicApiKey(): string | null {
  return process.env.ANTHROPIC_API_KEY?.trim() || null;
}

export function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * AI_INPUT_USD_PER_M + (outputTokens / 1_000_000) * AI_OUTPUT_USD_PER_M;
}
