/** Map Google Sheet "Business Expense Category" labels → GBSL categories.full_path */
export const SHEET_TO_GBSL_PATH = {
  Accounting: "Legal & Professional Fees:Accounting Fees",
  Advertising: "Advertising & Marketing",
  "Car Maitenance": "Auto Expense",
  "Continuing Education": "Continuing Education",
  "Continous Education": "Continuing Education",
  Donation: "Charitable Contributions",
  Equipment: "Office Supplies",
  Fees: "Bank Fees",
  Interest: "Interest Expense",
  Meals: "Meals & Entertainment",
  Memberships: "Dues & Subscriptions",
  Office: "Office Supplies",
  Parking: "Auto Expense:Parking & Tolls",
  Repair: "Repairs & Maintenance",
  Repairs: "Repairs & Maintenance",
  Services: "Contract Labor",
  Shipping: "Office Supplies",
  Subscription: "Software",
  Supplies: "Office Supplies",
  "Tournament Fee": "Tournament Fees",
  "Tournament Prep": "Tournament Fees",
  Travel: "Travel",
};

export function mapSheetCategory(label) {
  if (!label || !String(label).trim()) return null;
  const key = String(label).trim();
  return SHEET_TO_GBSL_PATH[key] ?? key;
}
