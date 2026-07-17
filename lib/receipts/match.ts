/**
 * Capture ↔ charge matching. Pure.
 *
 * Modeled on lib/bills/match.ts's SHAPE, but its three gates are all wrong here and inverting them is
 * the whole design:
 *
 * 1. VENDOR IS A BONUS, NEVER A GATE. scoreBillMatch does `if (shared.length === 0) return null`.
 *    Trace the motivating case: capture "Chipotle" -> key "chipotle"; charge "SQ *XXXX 4471" -> the
 *    digit-strip rule leaves "sq xxxx". Shared tokens: ZERO. scoreBillMatch returns null — it rejects
 *    precisely the opaque descriptor this feature exists to identify. Here vendor only ever ADDS.
 *
 * 2. AMOUNT IS ASYMMETRIC, BECAUSE OF THE TIP. The tip is added after the receipt prints: an $18.42
 *    receipt posts as $22.10 (+20%). A symmetric ±5%/$2 tolerance rejects it. The charge runs 0% to
 *    ~30% ABOVE the receipt and essentially never below.
 *
 * 3. DATE IS ASYMMETRIC. A card charge posts ON or AFTER the capture, never before. A symmetric ±7d
 *    window doubles the false positives for free.
 *
 * Weights are inverted from scoreBillMatch's vendor-heavy 0.5/0.3/0.2: here AMOUNT is the reliable
 * signal and VENDOR is the unreliable one.
 */

import { extractVendorSearchKey } from "@/lib/suggestions/category-suggestions";
import { daysBetween } from "@/lib/bills/cadence";

export type CaptureLike = {
  vendor: string | null;
  amount: number;
  /** timestamptz or YYYY-MM-DD; only the day is used. */
  captured_at: string;
};

export type ChargeLike = {
  id: string;
  vendor: string | null;
  description: string;
  amount: number;
  transaction_date: string;
};

export type CaptureMatchScore = {
  transactionId: string;
  score: number;
  amountScore: number;
  dateScore: number;
  vendorScore: number;
  /** Days the charge posted AFTER the capture (always >= 0). */
  deltaDays: number;
  /** How much higher the charge is than the receipt, as a fraction (0.20 = a 20% tip). */
  tipRatio: number;
};

/** Floor for surfacing a match. The Chipotle/SQ case lands ~0.55 with ZERO vendor signal. */
export const MIN_CAPTURE_MATCH_SCORE = 0.5;
/** A top match must beat the runner-up by this much, or we show both and make him pick. */
export const AMBIGUITY_MARGIN = 0.15;
/** Charges above this much over the receipt aren't a tip, they're a different spend. */
export const MAX_TIP_RATIO = 0.3;
/** A charge posts within this many days of the receipt. */
export const MAX_DAYS_AFTER = 5;

/** Cents of slop, so a charge a hair under the receipt (rounding) isn't rejected outright. */
const UNDER_TOLERANCE = 0.02;

function keyTokens(key: string): string[] {
  return key.split(" ").filter((word) => word.length >= 2);
}

/** 0..1. NEVER rejects — a zero here just means the descriptor was opaque, which is the normal case. */
export function vendorBonus(captureVendor: string | null, charge: ChargeLike): number {
  const captureKey = extractVendorSearchKey("", captureVendor?.trim() ?? "");
  const chargeKey = extractVendorSearchKey(charge.description, charge.vendor);
  if (!captureKey || !chargeKey) return 0;
  if (captureKey === chargeKey) return 1;

  const captureWords = keyTokens(captureKey);
  const chargeWords = new Set(keyTokens(chargeKey));
  const shared = captureWords.filter((word) => chargeWords.has(word));
  if (shared.length === 0) return 0; // <- bonus only. scoreBillMatch returns null here; that's the bug.
  return shared.length / Math.max(captureWords.length, chargeWords.size);
}

export function scoreCaptureMatch(capture: CaptureLike, charge: ChargeLike): CaptureMatchScore | null {
  // Both sides are outflows (ledger convention: charge = positive). Never match a refund.
  if (capture.amount <= 0 || charge.amount <= 0) return null;

  // --- Amount: the anchor, asymmetric for the tip ---
  const delta = charge.amount - capture.amount;
  if (delta < -UNDER_TOLERANCE) return null; // charge is BELOW the receipt: not this spend
  const tipRatio = delta <= 0 ? 0 : delta / capture.amount;
  // Compare in DOLLARS with a cent of slop, not on the raw ratio: a real 30% tip on $18.42 posts as
  // $23.95, which is 30.02% — rejecting that on a rounding artifact would drop a legitimate match.
  if (delta > capture.amount * MAX_TIP_RATIO + 0.01) return null;
  // Exact = 1.0. A tip decays 0.9 -> 0.5 across the band, so a tipped match still clears the floor.
  const amountScore = tipRatio === 0 ? 1 : 0.9 - (tipRatio / MAX_TIP_RATIO) * 0.4;

  // --- Date: required, asymmetric (the charge follows the receipt) ---
  const deltaDays = daysBetween(charge.transaction_date, capture.captured_at.slice(0, 10));
  if (deltaDays < 0 || deltaDays > MAX_DAYS_AFTER) return null;
  const dateScore = 1 - deltaDays / (MAX_DAYS_AFTER + 1);

  // --- Vendor: bonus only ---
  const vendorScore = vendorBonus(capture.vendor, charge);

  const score = 0.55 * amountScore + 0.3 * dateScore + 0.15 * vendorScore;
  return { transactionId: charge.id, score, amountScore, dateScore, vendorScore, deltaDays, tipRatio };
}

export type RankCaptureMatchesOptions = {
  /**
   * Charges already backing another capture. Without this a single charge gets suggested for several
   * captures — the bug lib/queries/bills.ts had to work around at runtime.
   */
  excludeTransactionIds?: Set<string>;
};

/** Plausible charges for a capture, best first. */
export function rankCaptureMatches(
  capture: CaptureLike,
  charges: ChargeLike[],
  options: RankCaptureMatchesOptions = {},
): CaptureMatchScore[] {
  const ranked: CaptureMatchScore[] = [];
  for (const charge of charges) {
    if (options.excludeTransactionIds?.has(charge.id)) continue;
    const scored = scoreCaptureMatch(capture, charge);
    if (scored && scored.score >= MIN_CAPTURE_MATCH_SCORE) ranked.push(scored);
  }
  return ranked.sort((a, b) => b.score - a.score || a.transactionId.localeCompare(b.transactionId));
}

/**
 * The one match confident enough to offer as a one-tap confirm, or null.
 *
 * Null when two charges are within AMBIGUITY_MARGIN — e.g. two similar dinners in the tip band. Show
 * both and let him pick: a silently wrong auto-match is worse than no match, because he'd never notice.
 */
export function confidentCaptureMatch(ranked: CaptureMatchScore[]): CaptureMatchScore | null {
  const [top, second] = ranked;
  if (!top) return null;
  if (second && top.score - second.score < AMBIGUITY_MARGIN) return null;
  return top;
}
