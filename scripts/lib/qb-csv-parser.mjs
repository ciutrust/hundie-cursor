import { createHash } from "node:crypto";

const EXPENSE_TYPES = new Set(["Expense", "Credit Card Expense", "Check"]);

const PAYMENT_ACCOUNT_NAMES = new Set([
  "Capital One",
  "Visa 0577",
  "Claudia's WF Business 1576 (was 8363)",
]);

const PAYMENT_KEYWORDS = [
  "Checking",
  "Savings",
  "Visa ",
  "Capital One",
  "Line of Credit",
  "WF Business",
  "Credit Card",
  "Amex",
  "Chase",
  "PayPal",
  "Square",
  "Loan",
  "Mortgage",
  "Petty Cash",
];

/**
 * QuickBooks Transaction Detail by Account export (header row 5).
 */
export function parseQuickBooksCsv(csvText) {
  const rows = parseCsv(csvText);
  const headerIndex = rows.findIndex(
    (row) => row[1]?.trim() === "Transaction date" && row[2]?.trim() === "Transaction type",
  );

  if (headerIndex === -1) {
    throw new Error("Could not find QuickBooks header row (Transaction date / Transaction type)");
  }

  const paymentAccounts = new Set();
  let currentAccount = null;

  for (const row of rows.slice(headerIndex + 1)) {
    if (isAccountHeaderRow(row)) {
      const name = row[0].trim();
      if (!name.startsWith("Total for") && isPaymentAccount(name)) {
        paymentAccounts.add(name);
      }
      if (!name.startsWith("Total for")) {
        currentAccount = name;
      }
      continue;
    }

    if (!isTransactionRow(row)) continue;

    const transactionType = row[2]?.trim() ?? "";
    if (EXPENSE_TYPES.has(transactionType) && currentAccount && isPaymentAccount(currentAccount)) {
      paymentAccounts.add(currentAccount);
    }
  }

  const expenses = [];
  currentAccount = null;

  for (const row of rows.slice(headerIndex + 1)) {
    if (isAccountHeaderRow(row)) {
      const name = row[0].trim();
      if (!name.startsWith("Total for")) {
        currentAccount = name;
      }
      continue;
    }

    if (!isTransactionRow(row)) continue;
    if (!currentAccount || !paymentAccounts.has(currentAccount)) continue;

    const transactionType = row[2]?.trim() ?? "";
    if (!EXPENSE_TYPES.has(transactionType)) continue;

    const categoryName = row[6]?.trim() ?? "";
    if (!categoryName || isPaymentTransfer(categoryName, paymentAccounts)) continue;

    const amount = parseAmount(row[7]);
    if (amount === null) continue;

    expenses.push({
      sourceAccount: currentAccount,
      transactionDate: parseDate(row[1]),
      transactionType,
      transactionNum: row[3]?.trim() || null,
      vendorName: row[4]?.trim() || null,
      description: row[5]?.trim() || null,
      categoryName,
      amount,
    });
  }

  return {
    expenses,
    categoryNames: [...new Set(expenses.map((row) => row.categoryName))].sort(),
    paymentAccounts: [...paymentAccounts].sort(),
  };
}

export function buildCategoryTree(categoryNames) {
  const nodes = new Map();

  for (const fullPath of categoryNames) {
    const parts = fullPath.split(":");
    let parentPath = null;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i].trim();
      const path = parts.slice(0, i + 1).join(":");
      if (!nodes.has(path)) {
        nodes.set(path, {
          name,
          fullPath: path,
          parentPath,
        });
      }
      parentPath = path;
    }
  }

  return [...nodes.values()].sort((a, b) => a.fullPath.localeCompare(b.fullPath));
}

export function buildImportHash(expense) {
  const payload = [
    expense.sourceAccount,
    expense.transactionDate,
    expense.transactionType,
    expense.transactionNum ?? "",
    expense.vendorName ?? "",
    expense.description ?? "",
    expense.categoryName,
    expense.amount.toFixed(2),
  ].join("|");

  return createHash("sha256").update(payload).digest("hex");
}

function isAccountHeaderRow(row) {
  return Boolean(row[0]?.trim()) && !row[1]?.trim();
}

function isTransactionRow(row) {
  return Boolean(row[1]?.trim()) && Boolean(row[2]?.trim());
}

function isPaymentAccount(name) {
  if (!name || name.startsWith("Total for")) return false;
  if (PAYMENT_ACCOUNT_NAMES.has(name)) return true;
  if (PAYMENT_KEYWORDS.some((keyword) => name.includes(keyword))) return true;
  // Keller / WF account sections e.g. "Keller Services LLC (7142) - 1"
  if (/\(\d{4}\)\s*-\s*\d/.test(name)) return true;
  if (/^MasterCard/i.test(name)) return true;
  return false;
}

function isPaymentTransfer(split, paymentAccounts) {
  if (PAYMENT_ACCOUNT_NAMES.has(split)) return true;
  if (split.startsWith("Navigate Business")) return true;
  if (paymentAccounts.has(split)) return true;
  return false;
}

function parseDate(value) {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const [month, day, year] = trimmed.split("/").map((part) => Number.parseInt(part, 10));
  if (!month || !day || !year) return null;

  const fullYear = year < 100 ? 2000 + year : year;
  return `${fullYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseAmount(value) {
  if (value == null) return null;
  const normalized = String(value).replace(/,/g, "").trim();
  if (!normalized) return null;

  const amount = Number.parseFloat(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
