export type CategorySuggestion = {
  categoryId: string;
  fullPath: string;
  count: number;
  source: "qb_training" | "confirmed_history" | "blended" | "amount_match" | "ai_llm";
  confidence: "high" | "medium" | "low";
  /** Set when amount bucket re-ranking applied (exact or nearest prior amount). */
  amountMatchType?: "exact" | "nearest";
  /** One-line explanation when source is ai_llm. */
  rationale?: string;
  /** Proposed entity when AI suggests reclassification. */
  suggestedEntitySlug?: string;
};

export type CategorySuggestionInput = {
  description: string;
  vendor: string | null;
  entitySlug: string;
  amount?: number;
};

export type BulkCategorySuggestionInput = {
  transactions: Array<{ description: string; vendor: string | null; amount?: number }>;
  entitySlug: string;
};

type TransactionLike = Pick<BulkCategorySuggestionInput["transactions"][number], "description" | "vendor">;

type TrainingRow = {
  category_id: string | null;
  category_name: string;
};

const STOP_WORDS = new Set([
  "payment",
  "purchase",
  "online",
  "pos",
  "debit",
  "credit",
  "card",
  "thank",
  "you",
  "autopay",
  "mobile",
  "transfer",
  "withdrawal",
  "deposit",
  "check",
  "ach",
  "fee",
  "the",
  "and",
  "for",
  "from",
  "ref",
]);

const TAIL_STOP_WORDS = new Set(["com", "net", "org", "edu", "ca", "us", "inc", "llc"]);

/** Too broad alone — fine inside multi-word phrases like "google ads". */
const GENERIC_SINGLE_WORDS = new Set([
  ...TAIL_STOP_WORDS,
  "google",
  "amazon",
  "apple",
  "microsoft",
  "paypal",
  "square",
  "stripe",
  "zelle",
  "venmo",
]);

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Same vendor extraction as Wells Fargo import parsers. */
export function extractVendor(description: string): string {
  const cleaned = description.replace(/\s+/g, " ").trim();
  const match = cleaned.match(/^([A-Z0-9*][A-Z0-9* .&'-]{2,40})/i);
  return match ? match[1].trim() : cleaned.slice(0, 80);
}

function isMostlyDigits(token: string): boolean {
  if (/^\d+[a-z]*$/i.test(token)) return true;
  const digits = token.replace(/\D/g, "").length;
  return digits > 0 && digits / token.length >= 0.6;
}

function isUsefulToken(token: string): boolean {
  if (token.length < 3 || isMostlyDigits(token)) return false;
  if (STOP_WORDS.has(token)) return false;
  if (token.includes(" ")) {
    return token.split(" ").every((word) => word.length >= 2 && !STOP_WORDS.has(word));
  }
  return !GENERIC_SINGLE_WORDS.has(token);
}

/** Strip card ref numbers, email domains, and state codes from a vendor string. */
export function extractVendorSearchKey(description: string, vendor: string | null): string {
  let text = (vendor?.trim() || extractVendor(description)).toLowerCase();
  text = text.replace(/@.+$/g, "");
  text = text.replace(/\d{4,}[a-z]*/gi, " ");
  text = text.replace(/[^\w\s]/g, " ");
  text = text.replace(/\s+/g, " ").trim();

  const words = text.split(" ").filter((word) => word.length >= 2);
  const uniqueWords: string[] = [];
  for (const word of words) {
    if (!uniqueWords.includes(word)) {
      uniqueWords.push(word);
    }
  }

  while (uniqueWords.length > 1 && TAIL_STOP_WORDS.has(uniqueWords[uniqueWords.length - 1])) {
    uniqueWords.pop();
  }

  return uniqueWords.slice(0, 3).join(" ");
}

function buildTokensFromVendorKey(vendorKey: string): string[] {
  const tokens = new Set<string>();

  if (isUsefulToken(vendorKey)) {
    tokens.add(vendorKey);
  }

  const words = vendorKey.split(" ").filter((word) => word.length >= 2);
  if (words.length >= 2) {
    const phrase = words.slice(0, 2).join(" ");
    if (isUsefulToken(phrase)) {
      tokens.add(phrase);
    }
  }

  for (const word of words) {
    if (word.length >= 4 && isUsefulToken(word)) {
      tokens.add(word);
    }
  }

  return [...tokens].slice(0, 5);
}

export function extractSearchTokens(description: string, vendor: string | null): string[] {
  const vendorKey = extractVendorSearchKey(description, vendor);
  const tokens = new Set<string>(buildTokensFromVendorKey(vendorKey));

  normalizeText(description)
    .split(" ")
    .filter((word) => word.length >= 4 && isUsefulToken(word))
    .slice(0, 2)
    .forEach((word) => tokens.add(word));

  return [...tokens].slice(0, 5);
}

function rankTokenCounts(tokenCounts: Map<string, number>): string[] {
  return [...tokenCounts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .map(([token]) => token)
    .filter(isUsefulToken);
}

export function extractSearchTokensFromTransactions(transactions: TransactionLike[]): string[] {
  if (transactions.length === 0) {
    return [];
  }

  const vendorKeys = transactions.map((transaction) =>
    extractVendorSearchKey(transaction.description, transaction.vendor),
  );

  const keyCounts = new Map<string, number>();
  for (const key of vendorKeys) {
    if (!key) continue;
    keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
  }

  const majorityThreshold = Math.ceil(transactions.length * 0.5);
  const sortedKeys = [...keyCounts.entries()].sort((a, b) => b[1] - a[1]);
  const [topKey, topCount] = sortedKeys[0] ?? [];

  if (topKey && topCount >= majorityThreshold) {
    return buildTokensFromVendorKey(topKey);
  }

  const prefixCounts = new Map<string, number>();
  for (const key of vendorKeys) {
    const prefix = key.split(" ").slice(0, 2).join(" ");
    if (!prefix) continue;
    prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
  }

  const sortedPrefixes = [...prefixCounts.entries()].sort((a, b) => b[1] - a[1]);
  const [topPrefix, prefixCount] = sortedPrefixes[0] ?? [];

  if (topPrefix && prefixCount >= majorityThreshold) {
    return buildTokensFromVendorKey(topPrefix);
  }

  const tokenCounts = new Map<string, number>();
  for (const key of vendorKeys) {
    for (const token of buildTokensFromVendorKey(key)) {
      tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
    }
  }

  return rankTokenCounts(tokenCounts).slice(0, 5);
}

export function sanitizeOrToken(token: string): string {
  return token.replace(/[%_\\(),.]/g, "");
}

export function computeSuggestionConfidence(
  count: number,
  totalMatches: number,
  rank: number,
): CategorySuggestion["confidence"] {
  if (rank > 0) {
    if (count >= 3 && count / Math.max(totalMatches, 1) >= 0.4) return "medium";
    return "low";
  }

  const share = count / Math.max(totalMatches, 1);
  if (count >= 5 && share >= 0.55) return "high";
  if (count >= 2 && share >= 0.35) return "medium";
  return "low";
}

export function rankCategorySuggestions(
  rows: TrainingRow[],
  source: CategorySuggestion["source"] = "qb_training",
): CategorySuggestion[] {
  const counts = new Map<
    string,
    { categoryId: string; fullPath: string; count: number }
  >();

  for (const row of rows) {
    if (!row.category_id) continue;

    const existing = counts.get(row.category_id);
    if (existing) {
      existing.count += 1;
      continue;
    }

    counts.set(row.category_id, {
      categoryId: row.category_id,
      fullPath: row.category_name,
      count: 1,
    });
  }

  const totalMatches = rows.filter((row) => row.category_id).length;
  const ranked = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 3);

  return ranked.map((entry, index) => ({
    categoryId: entry.categoryId,
    fullPath: entry.fullPath,
    count: entry.count,
    source,
    confidence: computeSuggestionConfidence(entry.count, totalMatches, index),
  }));
}

type ConfirmedHistoryRow = {
  category_id: string | null;
  category: { id: string; full_path: string } | null;
};

export function rankConfirmedHistorySuggestions(rows: ConfirmedHistoryRow[]): CategorySuggestion[] {
  const counts = new Map<string, { categoryId: string; fullPath: string; count: number }>();

  for (const row of rows) {
    const categoryId = row.category_id ?? row.category?.id;
    const fullPath = row.category?.full_path;
    if (!categoryId || !fullPath) continue;

    const existing = counts.get(categoryId);
    if (existing) {
      existing.count += 1;
      continue;
    }

    counts.set(categoryId, { categoryId, fullPath, count: 1 });
  }

  const totalMatches = rows.filter((row) => (row.category_id ?? row.category?.id)).length;
  const ranked = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 3);

  return ranked.map((entry, index) => ({
    categoryId: entry.categoryId,
    fullPath: entry.fullPath,
    count: entry.count,
    source: "confirmed_history" as const,
    confidence: computeSuggestionConfidence(entry.count, totalMatches, index),
  }));
}

const SUGGESTION_ENTITIES = new Set(["gbsl", "personal", "acaa-austin", "pflugerville", "keller"]);

export function shouldSuggestCategories(input: CategorySuggestionInput): boolean {
  return SUGGESTION_ENTITIES.has(input.entitySlug) && extractSearchTokens(input.description, input.vendor).length > 0;
}

export function shouldSuggestBulkCategories(input: BulkCategorySuggestionInput): boolean {
  return SUGGESTION_ENTITIES.has(input.entitySlug) && extractSearchTokensFromTransactions(input.transactions).length > 0;
}
