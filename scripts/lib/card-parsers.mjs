import { parseWellsFargoCsv, mergeParentChildCreditCardTransactions } from "./wf-csv-parser.mjs";
import { parseCapitalOneCsv } from "./capitalone-csv-parser.mjs";
import { parseCitiCsv } from "./citi-csv-parser.mjs";
import { parseChaseCsv } from "./chase-csv-parser.mjs";
import { parseAmexCsv } from "./amex-csv-parser.mjs";

const PARSERS = {
  wells_fargo: (csvText, account) =>
    parseWellsFargoCsv(csvText, { accountType: account.account_type }),
  capital_one: parseCapitalOneCsv,
  citi: parseCitiCsv,
  chase: parseChaseCsv,
  amex: parseAmexCsv,
};

export function parseCardCsv(csvText, account, { supplementalCsvTexts = [] } = {}) {
  const parser = PARSERS[account.issuer_parser];
  if (!parser) {
    throw new Error(`No parser registered for issuer: ${account.issuer_parser}`);
  }

  let parsed = parser(csvText, account);

  if (account.mergeParentChild && supplementalCsvTexts.length > 0) {
    for (const supplementalCsv of supplementalCsvTexts) {
      const supplementalParsed = parser(supplementalCsv, account);
      parsed = mergeParentChildCreditCardTransactions(supplementalParsed, parsed);
    }
  }

  return parsed;
}

export { SEED_ACCOUNTS as KNOWN_ACCOUNTS } from "./seed-accounts.mjs";
