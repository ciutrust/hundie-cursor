import { readFileSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { parseCardCsv } from "./lib/card-parsers.mjs";
import { resolveEntitySlug } from "./lib/entity-resolver.mjs";
import { SEED_ACCOUNTS } from "./lib/seed-accounts.mjs";

const home = process.env.HOME ?? "";

console.log("Card CSV parser verification\n");

let failures = 0;
let total = 0;

for (const account of SEED_ACCOUNTS) {
  const csvPath = resolve(home, account.defaultPath);

  if (!existsSync(csvPath)) {
    console.log(`SKIP ${account.slug}: file not found (${basename(csvPath)})`);
    failures++;
    continue;
  }

  try {
    const csvText = readFileSync(csvPath, "utf8");
    const txs = parseCardCsv(csvText, account);
    const dates = txs.map((tx) => tx.transactionDate).sort();
    const entityCounts = new Map();

    for (const tx of txs) {
      const slug = resolveEntitySlug(account, tx.transactionDate);
      entityCounts.set(slug, (entityCounts.get(slug) ?? 0) + 1);
    }

    total += txs.length;
    console.log(`${account.slug}`);
    console.log(`  charges: ${txs.length}`);
    console.log(`  dates: ${dates[0] ?? "—"} → ${dates.at(-1) ?? "—"}`);
    console.log(`  entities: ${[...entityCounts.entries()].map(([k, v]) => `${k}=${v}`).join(", ")}`);
  } catch (error) {
    console.log(`FAIL ${account.slug}: ${error.message}`);
    failures++;
  }
}

console.log(`\nTotal charges: ${total}`);

if (failures > 0) {
  process.exit(1);
}

console.log("All parsers OK");
