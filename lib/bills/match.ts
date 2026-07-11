// Bill ↔ transaction matching, plus recurring-charge detection for the onboarding seed. Both key on
// the SAME vendor normalization the classifier uses (extractVendorSearchKey) so a bill's match_hint
// lines up with how transactions are grouped elsewhere. Pure — the query layer feeds these rows.
//
// Ledger sign convention (see lib/queries/entity-home.ts): outflow/expense = amount > 0, income < 0.
// Bills are outflows, so we only ever consider positive-amount transactions.

import { extractVendorSearchKey } from "@/lib/suggestions/category-suggestions";
import { daysBetween, parseIsoDate, type Cadence } from "./cadence";

// ---------------------------------------------------------------------------
// scoreBillMatch — does this transaction look like it paid this bill instance?
// ---------------------------------------------------------------------------

export type BillMatchInput = {
  bill: { match_hint: string | null; name: string; expected_amount: number | null; amount_varies: boolean };
  instance: { due_date: string; expected_amount: number | null };
  txn: { vendor: string | null; description: string; amount: number; transaction_date: string };
};

export type BillMatchScore = {
  score: number;
  vendorScore: number;
  amountMatch: boolean;
  withinWindow: boolean;
  deltaDays: number;
};

export type ScoreBillMatchOptions = {
  amountTolerancePct?: number; // default 0.05 (5%)
  amountToleranceAbs?: number; // default $2
  dateWindowDays?: number; // default 7; the caller widens this for quarterly+ bills
};

const DEFAULT_AMOUNT_PCT = 0.05;
const DEFAULT_AMOUNT_ABS = 2;
const DEFAULT_DATE_WINDOW = 7;

/** Suggested floor for surfacing a match to the operator. */
export const MIN_MATCH_SCORE = 0.4;

function billVendorKey(bill: BillMatchInput["bill"]): string {
  const hint = bill.match_hint?.trim() || bill.name;
  return extractVendorSearchKey("", hint);
}

function keyTokens(key: string): string[] {
  return key.split(" ").filter((word) => word.length >= 2);
}

export function scoreBillMatch(
  input: BillMatchInput,
  opts: ScoreBillMatchOptions = {},
): BillMatchScore | null {
  const { bill, instance, txn } = input;

  // Bills are outflows; never match an inflow / refund.
  if (txn.amount <= 0) return null;

  // --- Vendor (required) ---
  const billKey = billVendorKey(bill);
  const txnKey = extractVendorSearchKey(txn.description, txn.vendor);
  if (!billKey || !txnKey) return null;

  let vendorScore: number;
  if (billKey === txnKey) {
    vendorScore = 1;
  } else {
    const billWords = keyTokens(billKey);
    const txnWords = new Set(keyTokens(txnKey));
    const shared = billWords.filter((word) => txnWords.has(word));
    if (shared.length === 0) return null;
    vendorScore = shared.length / Math.max(billWords.length, txnWords.size);
  }

  // --- Date window (required) ---
  const deltaDays = Math.abs(daysBetween(txn.transaction_date, instance.due_date));
  const dateWindow = opts.dateWindowDays ?? DEFAULT_DATE_WINDOW;
  if (deltaDays > dateWindow) return null;
  const dateScore = 1 - deltaDays / (dateWindow + 1);

  // --- Amount (required for fixed bills; skipped when the amount varies) ---
  const target = instance.expected_amount ?? bill.expected_amount;
  let amountMatch: boolean;
  let amountScore: number;
  if (bill.amount_varies || target == null) {
    amountMatch = true;
    amountScore = 0.5; // neutral — vendor + date carry variable bills
  } else {
    const tolerance = Math.max(
      Math.abs(target) * (opts.amountTolerancePct ?? DEFAULT_AMOUNT_PCT),
      opts.amountToleranceAbs ?? DEFAULT_AMOUNT_ABS,
    );
    const delta = Math.abs(Math.abs(txn.amount) - Math.abs(target));
    amountMatch = delta <= tolerance;
    if (!amountMatch) return null; // a fixed bill whose amount is off is not this payment
    amountScore = 1 - delta / (tolerance + 1e-9);
  }

  const score = 0.5 * vendorScore + 0.3 * amountScore + 0.2 * dateScore;
  return { score, vendorScore, amountMatch, withinWindow: true, deltaDays };
}

// ---------------------------------------------------------------------------
// detectRecurringBills — mine the ledger for repeating charges to seed the list.
// ---------------------------------------------------------------------------

export type RecurringTxn = {
  vendor: string | null;
  description: string;
  amount: number;
  transaction_date: string;
  category_id: string | null;
};

export type RecurringCandidate = {
  vendorKey: string;
  suggestedName: string;
  cadence: Cadence;
  due_day: number | null;
  expected_amount: number;
  amount_varies: boolean;
  category_id: string | null;
  sampleCount: number;
  lastSeen: string;
};

export type DetectRecurringInput = {
  transactions: RecurringTxn[];
  today: string;
  minOccurrences?: number;
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mode<T>(values: T[]): T | null {
  const counts = new Map<T, number>();
  let best: T | null = null;
  let bestCount = 0;
  for (const value of values) {
    const next = (counts.get(value) ?? 0) + 1;
    counts.set(value, next);
    if (next > bestCount) {
      best = value;
      bestCount = next;
    }
  }
  return best;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

type CadenceBand = { cadence: Cadence; min: number; max: number };

const CADENCE_BANDS: CadenceBand[] = [
  { cadence: "weekly", min: 5, max: 10 },
  { cadence: "monthly", min: 20, max: 45 },
  { cadence: "quarterly", min: 75, max: 110 },
  { cadence: "semiannual", min: 150, max: 210 },
  { cadence: "annual", min: 320, max: 400 },
];

/** The cadence band a median gap (days) falls into, or null if it matches no regular cadence. */
function inferCadenceBand(medianGap: number): CadenceBand | null {
  return CADENCE_BANDS.find((band) => medianGap >= band.min && medianGap <= band.max) ?? null;
}

function deriveName(txns: RecurringTxn[], vendorKey: string): string {
  const vendorMode = mode(
    txns.map((t) => t.vendor?.trim()).filter((v): v is string => Boolean(v)),
  );
  if (vendorMode) return vendorMode;
  return vendorKey
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function detectRecurringBills(input: DetectRecurringInput): RecurringCandidate[] {
  const minOccurrences = input.minOccurrences ?? 3;

  const groups = new Map<string, RecurringTxn[]>();
  for (const txn of input.transactions) {
    if (txn.amount <= 0) continue; // outflows only — never suggest recurring income as a bill
    const key = extractVendorSearchKey(txn.description, txn.vendor);
    if (!key) continue;
    const group = groups.get(key);
    if (group) group.push(txn);
    else groups.set(key, [txn]);
  }

  const candidates: RecurringCandidate[] = [];
  for (const [vendorKey, txns] of groups) {
    if (txns.length < minOccurrences) continue;

    const sorted = [...txns].sort((a, b) => a.transaction_date.localeCompare(b.transaction_date));
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push(daysBetween(sorted[i].transaction_date, sorted[i - 1].transaction_date));
    }
    const medianGap = median(gaps);
    const band = inferCadenceBand(medianGap);
    if (!band) continue;
    // Guard against irregular spend that merely has a plausible median: most gaps must actually
    // fall in the cadence band (allows the occasional skipped/doubled cycle, rejects noise).
    const inBand = gaps.filter((gap) => gap >= band.min && gap <= band.max).length;
    if (inBand / gaps.length < 0.6) continue;
    const cadence = band.cadence;

    const lastSeen = sorted[sorted.length - 1].transaction_date;
    // Skip charges that appear to have stopped (not seen within ~2 cycles) — likely a dead sub.
    if (daysBetween(input.today, lastSeen) > 2 * medianGap + 31) continue;

    const amounts = sorted.map((t) => Math.abs(t.amount));
    const expected_amount = round2(median(amounts));
    const maxDeviation = Math.max(...amounts.map((a) => Math.abs(a - expected_amount)));
    const amount_varies = expected_amount > 0 && maxDeviation / expected_amount > 0.1;

    const dueDayValues =
      cadence === "weekly"
        ? sorted.map((t) => parseIsoDate(t.transaction_date).getDay())
        : sorted.map((t) => parseIsoDate(t.transaction_date).getDate());
    const due_day = mode(dueDayValues);

    const category_id =
      mode(sorted.map((t) => t.category_id).filter((c): c is string => c != null)) ?? null;

    candidates.push({
      vendorKey,
      suggestedName: deriveName(sorted, vendorKey),
      cadence,
      due_day,
      expected_amount,
      amount_varies,
      category_id,
      sampleCount: sorted.length,
      lastSeen,
    });
  }

  return candidates.sort(
    (a, b) => b.sampleCount - a.sampleCount || b.lastSeen.localeCompare(a.lastSeen),
  );
}
