import { parseUsDate, parseAmount, normalizeDescription } from "./csv-utils.mjs";

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

function parseSheetDate(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  const fromUs = parseUsDate(trimmed);
  if (fromUs) return fromUs;
  const num = Number(trimmed);
  if (Number.isFinite(num) && num > 40000 && num < 60000) {
    const d = new Date(EXCEL_EPOCH_MS + num * 86400000);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

function parseSheetAmount(value) {
  if (value === undefined || value === null || value === "") return null;
  const amount = parseAmount(String(value).replace(/,/g, ""));
  if (amount === null) return null;
  return Math.abs(amount);
}

const TAB_CONFIG = {
  "AMEX - TD": { headerRow: 7, date: "Date", amount: "Amount", description: "Description" },
  "Citi AA (2025)": { headerRow: 3, date: "Date", amount: "Debit", description: "Description" },
  "CapOneAlex 2025": { headerRow: 1, date: "Transaction Date", amount: "Debit", description: "Description" },
  "Claudia CITI": { headerRow: 1, date: "Date", amount: "Debit", description: "Description" },
  "Chase 2025": { headerRow: 1, date: "Transaction Date", amount: "Amount", description: "Description" },
  "WF Personal 2025": {
    headerRow: 1,
    date: "Date",
    amount: "Amount",
    description: "Description",
    format: "quicken",
  },
};

export function parseBusinessSheetTab(tabName, records) {
  const cfg = TAB_CONFIG[tabName];
  if (!cfg) throw new Error(`Unknown sheet tab: ${tabName}`);

  const parsed = [];

  for (const rec of records) {
    const date = parseSheetDate(rec[cfg.date]);
    const amount = parseSheetAmount(rec[cfg.amount]);
    const description = normalizeDescription(rec[cfg.description] ?? "");
    if (!date || !amount || !description) continue;

    const businessExpense = String(rec["Business Expense"] ?? "").trim().toUpperCase();
    parsed.push({
      transactionDate: date,
      postedDate: date,
      amount,
      description,
      vendor: extractVendor(description),
      rawCategory: rec["Business Expense Category"] ?? null,
      businessExpense,
      businessCategory: rec["Business Expense Category"]?.trim() || null,
      notes: rec.Notes?.trim() || null,
      cardMember: rec["Card Member"]?.trim() || null,
      meta: rec,
    });
  }

  return parsed;
}

function extractVendor(description) {
  const trimmed = description.trim();
  return trimmed.split(/\s{2,}/)[0]?.slice(0, 80) || trimmed.slice(0, 80);
}

export function getTabHeaderRow(tabName) {
  return TAB_CONFIG[tabName]?.headerRow ?? 1;
}

export { TAB_CONFIG };
