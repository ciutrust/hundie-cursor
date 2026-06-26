/** 2025 CSV batch — paths relative to ~/Downloads unless absolute. */
export const IMPORT_2025_FROM = "2025-01-01";
export const IMPORT_2025_TO = "2026-01-01";

export const IMPORT_2025_MANIFEST = [
  { slug: "wf-gbsl-checking", file: "2025-WF-GBSL-Checking.csv" },
  { slug: "wf-gbsl-cc", file: "2025-WF-GBSL-CreditCard-Alex.csv" },
  { slug: "wf-gbsl-claudia-cc", file: "2025-WF-GBSL-CreditCard-Claudia.csv" },
  { slug: "wf-gbsl-business-line", file: "2025-WF-GBSL-CreditCard-BusinessLine.csv" },
  { slug: "cap-one-quicksilver-claudia", file: "2025-WF-GBSL-CapitalOne-Quicksilver.csv" },
  { slug: "wf-personal-checking", file: "2025-WF-Personal-Checking.csv" },
  { slug: "wf-keller-services-checking", file: "2025-WF-KellerServices-Checking.csv" },
  { slug: "wf-keller-jroots-checking", file: "2025-WF-KellerServices-Jroots-Checking.csv" },
  {
    slug: "wf-keller-services-cc",
    file: "2025-WF-KellerServices-CC-4013.csv",
    supplementalFiles: ["2025-WF-KellerServices-CC-0448.csv"],
  },
  { slug: "wf-anita-checking", file: "2025-WF-ACAA-Anita-Checking.csv" },
];

export const BUSINESS_SHEET_DEFAULT_PATH = "2025_Business_Expenses_Fixed.xlsx";

export const BUSINESS_SHEET_TABS = [
  { tab: "AMEX - TD", slug: "amex-alex-personal", cardMemberColumn: "Card Member" },
  { tab: "Citi AA (2025)", slug: "citi-aadvantage-alex" },
  { tab: "CapOneAlex 2025", slug: "cap-one-alex-platinum" },
  { tab: "WF Personal 2025", slug: "wf-personal-cc", format: "quicken" },
  { tab: "Claudia CITI", slug: "citi-strata-claudia" },
  { tab: "Chase 2025", slug: "united-chase-claudia" },
];
