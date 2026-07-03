import { callAnthropic } from "@/lib/ai/anthropic";
import { calibrateConfidence } from "@/lib/ai/confidence";
import { AI_BATCH_SIZE } from "@/lib/ai/config";
import type { EntityChart } from "@/lib/ai/preclassify";
import type { VendorGroupPackage } from "@/lib/ai/vendor-group-packages";

export type VendorGroupClassifyResult = {
  vendor_key: string;
  entity_slug: string;
  category_path: string | null;
  confidence: "high" | "medium" | "low";
  rationale: string;
};

export type VendorGroupClassifyBatchResult = {
  items: VendorGroupClassifyResult[];
  inputTokens: number;
  outputTokens: number;
  model: string;
};

const SYSTEM_PROMPT = `You classify bank/credit card vendor groups for a household finance app.
Each item is a summarized vendor group (not individual transactions). One classification applies to all transactions in the group.
Return ONLY valid JSON — no markdown fences.
Pick entity_slug and category_path from the provided closed lists.
If unsure, set category_path to null and confidence to "low".
Never invent categories. One short rationale per vendor group (max 120 chars).`;

function buildUserPrompt(packages: VendorGroupPackage[], entityCharts: EntityChart[]): string {
  const charts = entityCharts
    .map(
      (entity) =>
        `Entity "${entity.slug}" (${entity.name}) categories:\n${entity.categoryPaths.map((p) => `  - ${p}`).join("\n")}`,
    )
    .join("\n\n");

  const groups = packages
    .map((pkg) =>
      JSON.stringify({
        vendor_key: pkg.vendor_key,
        count: pkg.count,
        sample_description: pkg.sample_description,
        amount_min: pkg.amount_min,
        amount_max: pkg.amount_max,
        amount_typical: pkg.amount_typical,
        account: pkg.account_slug,
        date_first: pkg.date_first,
        date_last: pkg.date_last,
        current_entity: pkg.current_entity,
      }),
    )
    .join("\n");

  return `${charts}

Classify these vendor groups. Respond with JSON:
{"results":[{"vendor_key":"...","entity_slug":"personal","category_path":"Dining & entertainment"|null,"confidence":"high"|"medium"|"low","rationale":"..."}]}

Vendor groups (one JSON object per line):
${groups}`;
}

export function parseModelJson(text: string): { results?: VendorGroupClassifyResult[] } {
  const trimmed = text.trim();
  const jsonText = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "")
    : trimmed;
  return JSON.parse(jsonText) as { results?: VendorGroupClassifyResult[] };
}

export function validateGroupResult(
  raw: VendorGroupClassifyResult,
  pkg: VendorGroupPackage,
  entityCharts: EntityChart[],
): VendorGroupClassifyResult {
  const entitySlug =
    entityCharts.find((entity) => entity.slug === raw.entity_slug)?.slug ?? pkg.current_entity;

  const chart = entityCharts.find((entity) => entity.slug === entitySlug);
  let categoryPath: string | null = raw.category_path?.trim() || null;

  if (categoryPath && chart && !chart.categoryPaths.includes(categoryPath)) {
    categoryPath = null;
  }

  return {
    vendor_key: pkg.vendor_key,
    entity_slug: entitySlug,
    category_path: categoryPath,
    confidence: calibrateConfidence(raw.confidence),
    rationale: (raw.rationale ?? "No rationale provided").slice(0, 200),
  };
}

export async function classifyVendorGroupBatch(
  packages: VendorGroupPackage[],
  entityCharts: EntityChart[],
): Promise<VendorGroupClassifyBatchResult> {
  if (packages.length === 0) {
    return { items: [], inputTokens: 0, outputTokens: 0, model: "" };
  }

  const user = buildUserPrompt(packages, entityCharts);
  const { text, usage, model } = await callAnthropic(SYSTEM_PROMPT, user);

  let parsed: { results?: VendorGroupClassifyResult[] };
  try {
    parsed = parseModelJson(text);
  } catch {
    throw new Error("Model returned invalid JSON");
  }

  const rawItems = parsed.results ?? [];
  const items = packages.map((pkg) => {
    const match = rawItems.find((row) => row.vendor_key === pkg.vendor_key);
    if (!match) {
      return validateGroupResult(
        {
          vendor_key: pkg.vendor_key,
          entity_slug: pkg.current_entity,
          category_path: null,
          confidence: "low",
          rationale: "Model omitted this vendor group",
        },
        pkg,
        entityCharts,
      );
    }
    return validateGroupResult(match, pkg, entityCharts);
  });

  return {
    items,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    model,
  };
}

export async function classifyAllVendorGroups(
  packages: VendorGroupPackage[],
  entityCharts: EntityChart[],
): Promise<VendorGroupClassifyBatchResult & { batches: number; failedBatches: number }> {
  const allItems: VendorGroupClassifyResult[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let model = "";
  let batches = 0;
  let failedBatches = 0;

  for (let i = 0; i < packages.length; i += AI_BATCH_SIZE) {
    const batch = packages.slice(i, i + AI_BATCH_SIZE);
    batches += 1;
    // T4: a single bad batch (invalid JSON / exhausted retries) must NOT discard the batches that
    // already succeeded (paid tokens). Record the failure and keep going; the caller decides what to
    // do with a partial result.
    try {
      const result = await classifyVendorGroupBatch(batch, entityCharts);
      allItems.push(...result.items);
      inputTokens += result.inputTokens;
      outputTokens += result.outputTokens;
      if (result.model) model = result.model;
    } catch (err) {
      failedBatches += 1;
      console.error(
        `AI batch ${batches} failed (${batch.length} vendor groups): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { items: allItems, inputTokens, outputTokens, model, batches, failedBatches };
}

/** Rough pre-run estimate for vendor-group classification. */
export function estimateTokensForVendorGroups(groupCount: number, categoryCount: number): {
  inputTokens: number;
  outputTokens: number;
} {
  const batches = Math.ceil(groupCount / AI_BATCH_SIZE);
  const inputPerBatch = 800 + categoryCount * 40 + Math.min(groupCount, AI_BATCH_SIZE) * 120;
  const outputPerBatch = Math.min(groupCount, AI_BATCH_SIZE) * 70;
  return {
    inputTokens: inputPerBatch * batches,
    outputTokens: outputPerBatch * batches,
  };
}
