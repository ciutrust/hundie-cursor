import {
  rankAmountAwareMatches,
  representativeBulkAmount,
  type AmountHistoryRow,
} from "../lib/suggestions/amount-aware-ranking.ts";

const SOFTWARE = { id: "software-id", full_path: "Software" };
const FRANCHISE = { id: "franchise-id", full_path: "Franchise Fees" };
const ADS = { id: "ads-id", full_path: "Advertising & Marketing" };
const WORKSPACE = { id: "workspace-id", full_path: "Software" };

function row(amount: number, category: { id: string; full_path: string }): AmountHistoryRow {
  return { amount, category_id: category.id, category };
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}

console.log("Amount-aware suggestion tests\n");

const gracieHistory: AmountHistoryRow[] = [
  row(125, SOFTWARE),
  row(125, SOFTWARE),
  row(125, SOFTWARE),
  row(850, FRANCHISE),
  row(850, FRANCHISE),
  row(900, FRANCHISE),
  row(900, FRANCHISE),
  row(900, FRANCHISE),
];

const gracie125 = rankAmountAwareMatches(125, gracieHistory);
assert(gracie125[0]?.categoryId === SOFTWARE.id, "Gracie $125 → Software first");
assert(gracie125[0]?.matchType === "exact", "Gracie $125 → exact match");
console.log("✓ Gracie Barra $125 → Software (exact)");

const gracie875 = rankAmountAwareMatches(875, gracieHistory);
assert(gracie875[0]?.categoryId === FRANCHISE.id, "Gracie $875 → Franchise Fees first");
assert(gracie875[0]?.matchType === "nearest", "Gracie $875 → nearest bucket");
console.log("✓ Gracie Barra $875 → Franchise Fees (nearest)");

const googleHistory: AmountHistoryRow[] = [
  row(500, ADS),
  row(500, ADS),
  row(45.61, WORKSPACE),
  row(45.61, WORKSPACE),
];

const googleAds = rankAmountAwareMatches(500, googleHistory);
assert(googleAds[0]?.categoryId === ADS.id, "Google Ads $500 → Advertising");
console.log("✓ Google Ads $500 → correct amount bucket");

const googleWorkspace = rankAmountAwareMatches(17.91, googleHistory);
assert(
  googleWorkspace[0]?.matchType === "nearest" && googleWorkspace[0]?.fullPath === "Software",
  "Google Workspace ~$18 → nearest Software bucket",
);
console.log("✓ Google Workspace ~$18 → nearest Software bucket");

const singleVendor = [row(50, ADS), row(50, ADS), row(52, ADS)];
const near50 = rankAmountAwareMatches(50, singleVendor);
assert(near50[0]?.categoryId === ADS.id, "Single-pattern vendor $50");
console.log("✓ Single amount pattern vendor");

const sparse = [row(125, SOFTWARE)];
assert(rankAmountAwareMatches(125, sparse).length === 0, "Need ≥2 examples per bucket");
console.log("✓ Requires ≥2 confirmations per amount bucket");

assert(representativeBulkAmount([850, 850, 900]) === 850, "Bulk majority amount");
assert(representativeBulkAmount([125, 850]) === undefined, "Mixed bulk skips amount-aware");
console.log("✓ Bulk representative amount");

console.log("\nAll amount-aware tests passed.");
