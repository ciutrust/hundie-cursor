import { callAnthropic } from "@/lib/ai/anthropic";
import { calibrateConfidence } from "@/lib/ai/confidence";
import { AI_BATCH_SIZE } from "@/lib/ai/config";
import type { BacklogTransaction } from "@/lib/ai/vendor-groups";

export type EntityChart = {
  slug: string;
  name: string;
  categoryPaths: string[];
};

export type AiClassifyInput = {
  transactions: BacklogTransaction[];
  entityCharts: EntityChart[];
};

export type AiClassifyResultItem = {
  transaction_id: string;
  entity_slug: string;
  category_path: string | null;
  confidence: "high" | "medium" | "low";
  rationale: string;
};

export type AiClassifyBatchResult = {
  items: AiClassifyResultItem[];
  inputTokens: number;
  outputTokens: number;
  model: string;
};

const SYSTEM_PROMPT = `You classify bank/credit card transactions for a household finance app.
Return ONLY valid JSON — no markdown fences.
For each transaction pick entity_slug and category_path from the provided closed lists.
If unsure, set category_path to null and confidence to "low".
Never invent categories. One short rationale per transaction (max 120 chars).`;

function buildUserPrompt(batch: BacklogTransaction[], entityCharts: EntityChart[]): string {
  const charts = entityCharts
    .map(
      (entity) =>
        `Entity "${entity.slug}" (${entity.name}) categories:\n${entity.categoryPaths.map((p) => `  - ${p}`).join("\n")}`,
    )
    .join("\n\n");

  const txs = batch
    .map(
      (tx) =>
        JSON.stringify({
          transaction_id: tx.id,
          description: tx.description,
          amount: Number(tx.amount),
          account: tx.account_slug,
          default_entity: tx.default_entity_slug,
          current_entity: tx.current_entity_slug,
        }),
    )
    .join("\n");

  return `${charts}

Classify these transactions. Respond with JSON:
{"results":[{"transaction_id":"uuid","entity_slug":"personal","category_path":"Dining & entertainment"|null,"confidence":"high"|"medium"|"low","rationale":"..."}]}

Transactions (one JSON object per line):
${txs}`;
}

function parseModelJson(text: string): { results?: AiClassifyResultItem[] } {
  const trimmed = text.trim();
  const jsonText = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "")
    : trimmed;
  return JSON.parse(jsonText) as { results?: AiClassifyResultItem[] };
}

function validateItem(
  raw: AiClassifyResultItem,
  batch: BacklogTransaction[],
  entityCharts: EntityChart[],
): AiClassifyResultItem {
  const tx = batch.find((row) => row.id === raw.transaction_id);
  const entitySlug =
    entityCharts.find((entity) => entity.slug === raw.entity_slug)?.slug ??
    tx?.current_entity_slug ??
    "personal";

  const chart = entityCharts.find((entity) => entity.slug === entitySlug);
  let categoryPath: string | null = raw.category_path?.trim() || null;

  if (categoryPath && chart && !chart.categoryPaths.includes(categoryPath)) {
    categoryPath = null;
  }

  return {
    transaction_id: raw.transaction_id,
    entity_slug: entitySlug,
    category_path: categoryPath,
    confidence: calibrateConfidence(raw.confidence),
    rationale: (raw.rationale ?? "No rationale provided").slice(0, 200),
  };
}

export async function classifyTransactionBatch(
  input: AiClassifyInput,
): Promise<AiClassifyBatchResult> {
  const { transactions, entityCharts } = input;
  if (transactions.length === 0) {
    return { items: [], inputTokens: 0, outputTokens: 0, model: "" };
  }

  const user = buildUserPrompt(transactions, entityCharts);
  const { text, usage, model } = await callAnthropic(SYSTEM_PROMPT, user);

  let parsed: { results?: AiClassifyResultItem[] };
  try {
    parsed = parseModelJson(text);
  } catch {
    throw new Error("Model returned invalid JSON");
  }

  const rawItems = parsed.results ?? [];
  const items = transactions.map((tx) => {
    const match = rawItems.find((row) => row.transaction_id === tx.id);
    if (!match) {
      return validateItem(
        {
          transaction_id: tx.id,
          entity_slug: tx.current_entity_slug,
          category_path: null,
          confidence: "low",
          rationale: "Model omitted this transaction",
        },
        transactions,
        entityCharts,
      );
    }
    return validateItem(match, transactions, entityCharts);
  });

  return {
    items,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    model,
  };
}

export async function classifyAllTransactions(
  input: AiClassifyInput,
): Promise<AiClassifyBatchResult & { batches: number }> {
  const allItems: AiClassifyResultItem[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let model = "";
  let batches = 0;

  for (let i = 0; i < input.transactions.length; i += AI_BATCH_SIZE) {
    const batch = input.transactions.slice(i, i + AI_BATCH_SIZE);
    const result = await classifyTransactionBatch({ transactions: batch, entityCharts: input.entityCharts });
    allItems.push(...result.items);
    inputTokens += result.inputTokens;
    outputTokens += result.outputTokens;
    model = result.model;
    batches += 1;
  }

  return { items: allItems, inputTokens, outputTokens, model, batches };
}

/** Rough pre-run estimate for UI confirmation. */
export function estimateTokensForBatch(transactionCount: number, categoryCount: number): {
  inputTokens: number;
  outputTokens: number;
} {
  const batches = Math.ceil(transactionCount / AI_BATCH_SIZE);
  const inputPerBatch = 800 + categoryCount * 40 + Math.min(transactionCount, AI_BATCH_SIZE) * 80;
  const outputPerBatch = Math.min(transactionCount, AI_BATCH_SIZE) * 60;
  return {
    inputTokens: inputPerBatch * batches,
    outputTokens: outputPerBatch * batches,
  };
}
