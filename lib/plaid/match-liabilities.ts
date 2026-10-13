/**
 * Pair Plaid /liabilities/get accounts onto existing Hundie liability rows.
 * Never creates a row. Ambiguous pairs are left unmatched.
 */

export type LiabilityRow = {
  id: string;
  type: string;
  name: string;
  plaidAccountId: string | null;
};

export type PlaidLiability = {
  accountId: string;
  name: string;
  mask: string | null;
  institution: string;
  kind: "mortgage" | "credit" | "student";
  balance: number | null;
  apr: number | null;
};

export type LiabilityAssignment = {
  rowId: string;
  plaid: PlaidLiability;
};

const ALIAS_PATTERNS: { key: string; re: RegExp }[] = [
  { key: "chase", re: /\bchase\b/ },
  { key: "first financial", re: /\bfirst financial\b|\b1st financial\b/ },
  { key: "mt", re: /\bm and t\b|\bmt bank\b|\bm t bank\b/ },
  { key: "sps", re: /\bsps\b|\bspservicing\b|\bselect portfolio\b/ },
  { key: "shellpoint", re: /\bshellpoint\b|\bshell point\b/ },
  { key: "ford", re: /\bford\b/ },
  { key: "cnb", re: /\bcnb\b|\bcommunity national\b/ },
  { key: "wells fargo", re: /\bwells fargo\b/ },
  { key: "amex", re: /\bamex\b|\bamerican express\b/ },
  { key: "capital one", re: /\bcapital one\b/ },
  { key: "citi", re: /\bciti\b|\bcitibank\b/ },
  { key: "discover", re: /\bdiscover\b/ },
  { key: "bank of america", re: /\bbank of america\b|\bbofa\b/ },
];

export function normalizeLiabilityText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function aliasKeys(value: string): string[] {
  const text = normalizeLiabilityText(value);
  return ALIAS_PATTERNS.filter((alias) => alias.re.test(text)).map((alias) => alias.key);
}

function sharesAlias(rowName: string, plaid: PlaidLiability): boolean {
  const rowKeys = new Set(aliasKeys(rowName));
  return aliasKeys(`${plaid.institution} ${plaid.name}`).some((key) => rowKeys.has(key));
}

function maskInRow(rowName: string, mask: string | null): boolean {
  if (!mask) return false;
  return normalizeLiabilityText(rowName).includes(mask.toLowerCase());
}

function mentionsHeloc(plaid: PlaidLiability): boolean {
  return /\bheloc\b|\bequity\b|\bline of credit\b|\bhome equity\b/.test(
    normalizeLiabilityText(`${plaid.institution} ${plaid.name}`),
  );
}

function typeCompatible(row: LiabilityRow, plaid: PlaidLiability): boolean {
  if (plaid.kind === "student") return false;
  if (plaid.kind === "mortgage" && row.type === "mortgage") return true;
  if (row.type === "credit_card") return plaid.kind === "credit";
  if (row.type === "heloc") return mentionsHeloc(plaid);
  if (row.type === "auto_loan") {
    const blob = normalizeLiabilityText(`${plaid.institution} ${plaid.name}`);
    return /\bauto\b|\bvehicle\b|\bford\b|\bcar\b/.test(blob);
  }
  return false;
}

function isCandidate(row: LiabilityRow, plaid: PlaidLiability): boolean {
  if (row.plaidAccountId && row.plaidAccountId !== plaid.accountId) return false;
  if (row.plaidAccountId === plaid.accountId) return true;
  if (!typeCompatible(row, plaid)) return false;
  if (maskInRow(row.name, plaid.mask)) return true;
  return sharesAlias(row.name, plaid);
}

/** Assign each Plaid liability to at most one existing row. Ambiguous sets stay unmatched. */
export function matchLiabilities(
  rows: LiabilityRow[],
  incoming: PlaidLiability[],
): { matched: LiabilityAssignment[]; unmatched: PlaidLiability[] } {
  const matched: LiabilityAssignment[] = [];
  const usedRows = new Set<string>();
  const usedPlaid = new Set<string>();

  for (const plaid of incoming) {
    const linked = rows.find((row) => row.plaidAccountId === plaid.accountId);
    if (!linked || usedRows.has(linked.id)) continue;
    matched.push({ rowId: linked.id, plaid });
    usedRows.add(linked.id);
    usedPlaid.add(plaid.accountId);
  }

  const remainingRows = rows.filter((row) => !usedRows.has(row.id) && !row.plaidAccountId);
  const candidates = incoming
    .filter((plaid) => !usedPlaid.has(plaid.accountId))
    .map((plaid) => ({
      plaid,
      rows: remainingRows.filter((row) => isCandidate(row, plaid)),
    }));

  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const entry of candidates) {
      if (usedPlaid.has(entry.plaid.accountId)) continue;
      const open = entry.rows.filter((row) => !usedRows.has(row.id));
      if (open.length !== 1) continue;
      const row = open[0];
      const rivals = candidates.filter(
        (other) =>
          !usedPlaid.has(other.plaid.accountId) &&
          other.rows.some((candidate) => candidate.id === row.id),
      );
      if (rivals.length !== 1) continue;
      matched.push({ rowId: row.id, plaid: entry.plaid });
      usedRows.add(row.id);
      usedPlaid.add(entry.plaid.accountId);
      progressed = true;
    }
  }

  return {
    matched,
    unmatched: incoming.filter((plaid) => !usedPlaid.has(plaid.accountId)),
  };
}

/** Plaid asked for another consent, or this item was never initialized for liabilities. */
export function liabilityErrorNeedsConsent(error: string): boolean {
  return /ADDITIONAL_CONSENT_REQUIRED|INVALID_PRODUCT|PRODUCT_NOT_ENABLED|PRODUCTS_NOT_SUPPORTED/i.test(
    error,
  );
}
