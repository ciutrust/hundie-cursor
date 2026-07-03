import {
  parseWellsFargoCsvWithSummary,
  mergeParentChildCreditCardTransactions,
} from "./wf-csv-parser.mjs";
import { parseCapitalOneCsv } from "./capitalone-csv-parser.mjs";
import { parseCitiCsv } from "./citi-csv-parser.mjs";
import { parseChaseCsv } from "./chase-csv-parser.mjs";
import { parseAmexCsv } from "./amex-csv-parser.mjs";

// wells_fargo is handled separately (parseWfWithLogging below) so its C12 drop-count summary can
// be logged from a single parse — not part of this uniform (csvText, account) => transactions[] map.
const PARSERS = {
  capital_one: parseCapitalOneCsv,
  citi: parseCitiCsv,
  chase: parseChaseCsv,
  amex: parseAmexCsv,
};

const KNOWN_ISSUER_PARSERS = new Set(["wells_fargo", ...Object.keys(PARSERS)]);

/**
 * C12: dropped rows previously left no trace. Wells Fargo is the only parser that currently
 * exposes a drop-count summary (parseWellsFargoCsvWithSummary); log it here, the nearest caller
 * with both the parsed CSV and the account context. Parses once (reused for `parsed` below) so
 * logging never re-parses the same CSV text a second time.
 */
function parseWfWithLogging(account, csvText) {
  const { transactions, dropSummary } = parseWellsFargoCsvWithSummary(csvText, {
    accountType: account.account_type,
  });
  if (dropSummary.dropped > 0) {
    const reasonParts = Object.entries(dropSummary.reasons)
      .filter(([, count]) => count > 0)
      .map(([reason, count]) => `${reason}=${count}`);
    console.log(
      `  ${account.slug}: kept ${dropSummary.kept}, dropped ${dropSummary.dropped} (${reasonParts.join(", ")})`,
    );
  }
  return transactions;
}

export function parseCardCsv(csvText, account, { supplementalCsvTexts = [] } = {}) {
  if (!KNOWN_ISSUER_PARSERS.has(account.issuer_parser)) {
    throw new Error(`No parser registered for issuer: ${account.issuer_parser}`);
  }

  const isWellsFargo = account.issuer_parser === "wells_fargo";
  const parser = isWellsFargo ? null : PARSERS[account.issuer_parser];

  let parsed = isWellsFargo ? parseWfWithLogging(account, csvText) : parser(csvText, account);

  if (account.mergeParentChild && supplementalCsvTexts.length > 0) {
    for (const supplementalCsv of supplementalCsvTexts) {
      const supplementalParsed = isWellsFargo
        ? parseWfWithLogging(account, supplementalCsv)
        : parser(supplementalCsv, account);
      parsed = mergeParentChildCreditCardTransactions(supplementalParsed, parsed);
    }
  }

  return parsed;
}

export { SEED_ACCOUNTS as KNOWN_ACCOUNTS } from "./seed-accounts.mjs";
