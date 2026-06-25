export type CategorySuggestion = {
  categoryId: string;
  fullPath: string;
  count: number;
  source: "qb_training";
};

export type CategorySuggestionInput = {
  description: string;
  vendor: string | null;
  entitySlug: string;
};

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

export function extractSearchTokens(description: string, vendor: string | null): string[] {
  const tokens = new Set<string>();
  const vendorSource = vendor?.trim() || extractVendor(description);
  const normalizedVendor = normalizeText(vendorSource);

  if (normalizedVendor.length >= 3) {
    const vendorWords = normalizedVendor
      .split(" ")
      .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));

    if (vendorWords.length > 0) {
      tokens.add(vendorWords.slice(0, 2).join(" "));
      vendorWords.slice(0, 3).forEach((word) => tokens.add(word));
    }
  }

  normalizeText(description)
    .split(" ")
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word))
    .slice(0, 4)
    .forEach((word) => tokens.add(word));

  return [...tokens].filter((token) => token.length >= 3).slice(0, 5);
}

export function escapeIlikePattern(token: string): string {
  return token.replace(/[%_\\]/g, "");
}

export function rankCategorySuggestions(rows: TrainingRow[]): CategorySuggestion[] {
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

  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((entry) => ({
      categoryId: entry.categoryId,
      fullPath: entry.fullPath,
      count: entry.count,
      source: "qb_training" as const,
    }));
}

export function shouldSuggestCategories(input: CategorySuggestionInput): boolean {
  return input.entitySlug === "gbsl" && extractSearchTokens(input.description, input.vendor).length > 0;
}
