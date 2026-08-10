/**
 * Intercompany / internal transfer pairing (suggest-only, the user confirms).
 *
 * Money moving between Alex's own accounts posts as TWO ledger rows: an outflow leg on the sending
 * account (positive amount) and an inflow leg on the receiving account (negative amount). This
 * module suggests out+in pairs so both legs can be linked and categorized off the P&L in one
 * confirm.
 *
 * Wells Fargo stamps the SAME ref token on both legs of an internal transfer:
 *   out: "ONLINE TRANSFER TO GBSL, LLC BUSINESS CHECKING XXXXXX3196 REF #IB0Z7NFL7H ON 08/04/26"
 *   in:  "ONLINE TRANSFER FROM CIUNCIUSKY A PREMIER CHECKING XXXXXX1996 REF #IB0Z7NFL7H ON 08/04/26"
 * Zelle writes the token with a space after the #: "ZELLE TO AWAIS CHAUDHARY ON 08/01 REF # WFCT22H63LCJ".
 *
 * Two tiers, in the never-auto-match-when-ambiguous spirit of lib/receipts/match.ts (a silently
 * wrong auto-link is worse than no link, because he'd never notice):
 *   - Tier 1: both legs carry the same ref token. Confident ONLY when the token resolves to exactly
 *     one viable out+in pairing; a token bucket with multiple outs or multiple ins downgrades every
 *     pairing in it to ambiguous. A confident in-leg is consumed (greedy 1:1) and never offered to
 *     other outs.
 *   - Tier 2: no shared token; equal absolute cents with dates within ±3 days. ALWAYS ambiguous,
 *     even with a single candidate: the user picks.
 * Amounts compare as integer cents (lib/money.ts amountToCents), never float equality.
 * Pure so it can be unit-tested; the caller owns persistence.
 */

import { amountToCents } from "@/lib/money";

export type LinkKind = "owner_funding" | "intercompany_service" | "internal_transfer";

export type PairLeg = {
  transactionId: string;
  accountId: string;
  entitySlug: string;
  /** YYYY-MM-DD */
  transactionDate: string;
  /** signed: positive = outflow, negative = inflow */
  amount: number;
  description: string;
  categoryId: string | null;
  categoryPath: string | null;
};

export type PairSuggestion = {
  out: PairLeg;
  /** viable inflow counterparts, best-first (closest date first for tier 2) */
  candidates: PairLeg[];
  /** set ONLY for tier-1 (shared ref token, exactly one viable pairing); null = ambiguous, user picks */
  confidentInId: string | null;
  refToken: string | null;
  kind: LinkKind;
};

/**
 * Matches both bank formats: "REF #IB0Z7NFL7H" (online transfer) and "REF # WFCT22H63LCJ" (Zelle,
 * space after the #). Case-insensitive; the token is returned uppercased so both legs key the same
 * bucket regardless of descriptor casing.
 */
const REF_TOKEN_RE = /REF\s*#\s*([A-Z0-9]{6,})\b/i;

export function extractTransferRef(description: string): string | null {
  const m = REF_TOKEN_RE.exec(description);
  return m ? m[1].toUpperCase() : null;
}

/** Tier-2 pairing window. Transfer legs post 0-3 days apart across institutions. */
const PAIR_WINDOW_DAYS = 3;

/** |amount| as integer cents. Math.abs BEFORE rounding so negative half-cents can't skew. */
function absCents(amount: number): number {
  return amountToCents(Math.abs(amount));
}

/**
 * Whole-day difference between two `YYYY-MM-DD` dates. Parses each as `T00:00:00.000Z` and diffs in
 * UTC ms / 86_400_000 so a DST/TZ shift can't introduce an off-by-one (mirrors lib/intercompany.ts).
 */
function dayDiff(a: string, b: string): number {
  const ms = Date.parse(`${a}T00:00:00.000Z`) - Date.parse(`${b}T00:00:00.000Z`);
  return Math.round(ms / 86_400_000);
}

function pairKey(outId: string, inId: string): string {
  return `${outId}:${inId}`;
}

/** Candidates sorted by date distance from the out leg, ties keeping input order (stable). */
function byDateDistance(out: PairLeg, candidates: PairLeg[]): PairLeg[] {
  return candidates
    .map((c, i) => ({ c, i, d: Math.abs(dayDiff(out.transactionDate, c.transactionDate)) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((x) => x.c);
}

export function pairCandidates(
  legs: PairLeg[],
  opts: { linkedIds: Set<string>; dismissedPairs: Set<string> },
): PairSuggestion[] {
  const { linkedIds, dismissedPairs } = opts;

  // Already-linked legs are settled: they neither seek a partner nor get offered as one.
  const live = legs.filter((l) => !linkedIds.has(l.transactionId));
  const outs = live.filter((l) => l.amount > 0);
  const ins = live.filter((l) => l.amount < 0);

  const tokenOf = new Map<string, string | null>();
  for (const leg of live) tokenOf.set(leg.transactionId, extractTransferRef(leg.description));

  // A pairing is viable when the cents match exactly, the legs sit on DIFFERENT accounts (the
  // entity may be the same: Keller moves between its own two checkings), and the user has not
  // already dismissed this exact pair.
  const viable = (out: PairLeg, inn: PairLeg) =>
    absCents(out.amount) === absCents(inn.amount) &&
    out.accountId !== inn.accountId &&
    !dismissedPairs.has(pairKey(out.transactionId, inn.transactionId));

  // Tier-1 bookkeeping: bucket every live tokened leg by its ref token.
  type TokenBucket = { outs: PairLeg[]; ins: PairLeg[] };
  const buckets = new Map<string, TokenBucket>();
  const bucketFor = (token: string): TokenBucket => {
    let b = buckets.get(token);
    if (!b) {
      b = { outs: [], ins: [] };
      buckets.set(token, b);
    }
    return b;
  };
  for (const leg of live) {
    const token = tokenOf.get(leg.transactionId);
    if (!token) continue;
    if (leg.amount > 0) bucketFor(token).outs.push(leg);
    else if (leg.amount < 0) bucketFor(token).ins.push(leg);
  }

  // Confident = the token resolves to exactly one viable out+in pairing. A bucket with multiple
  // outs or multiple ins is ambiguous for EVERY pairing in it (duplicate descriptors happen), so
  // confidence requires exactly 1 out + 1 in AND that single pairing being viable. Greedy 1:1: the
  // confident in-leg is consumed and never offered to other outs.
  const confidentInByOut = new Map<string, PairLeg>();
  const consumedInIds = new Set<string>();
  for (const bucket of buckets.values()) {
    if (bucket.outs.length !== 1 || bucket.ins.length !== 1) continue;
    const [out] = bucket.outs;
    const [inn] = bucket.ins;
    if (!viable(out, inn)) continue;
    confidentInByOut.set(out.transactionId, inn);
    consumedInIds.add(inn.transactionId);
  }

  const suggestions: PairSuggestion[] = [];
  for (const out of outs) {
    const token = tokenOf.get(out.transactionId) ?? null;

    // Tier 1, confident: single viable pairing for this token.
    const confidentIn = confidentInByOut.get(out.transactionId);
    if (confidentIn) {
      suggestions.push({
        out,
        candidates: [confidentIn],
        confidentInId: confidentIn.transactionId,
        refToken: token,
        kind: suggestLinkKind(out.entitySlug, confidentIn.entitySlug),
      });
      continue;
    }

    // Tier 1, ambiguous: the out shares a token with viable ins, but the bucket could not resolve
    // to a single pairing. Token evidence still beats date proximity, so these ins ARE the
    // candidate list (no tier-2 padding), just with confidentInId null so the user picks.
    let candidates: PairLeg[] = [];
    let refToken: string | null = null;
    if (token) {
      const bucket = buckets.get(token);
      const tier1 = (bucket?.ins ?? []).filter(
        (inn) => !consumedInIds.has(inn.transactionId) && viable(out, inn),
      );
      if (tier1.length > 0) {
        candidates = byDateDistance(out, tier1);
        refToken = token;
      }
    }

    // Tier 2: no shared token. Same cents, different account, within the ±3 day window. Never
    // confident, even with exactly one candidate: amount+date is circumstantial evidence.
    // A candidate whose OWN token differs from the out's is excluded outright: under the WF model
    // two different ref tokens are two different transfers, so offering it invites a mislink.
    if (candidates.length === 0) {
      const outToken = extractTransferRef(out.description);
      const tier2 = ins.filter((inn) => {
        if (consumedInIds.has(inn.transactionId)) return false;
        if (!viable(out, inn)) return false;
        if (Math.abs(dayDiff(out.transactionDate, inn.transactionDate)) > PAIR_WINDOW_DAYS) {
          return false;
        }
        const innToken = extractTransferRef(inn.description);
        return !(outToken && innToken && outToken !== innToken);
      });
      candidates = byDateDistance(out, tier2);
    }

    // Zero remaining candidates (all linked, dismissed, consumed, or out of window): no suggestion.
    if (candidates.length === 0) continue;

    suggestions.push({
      out,
      candidates,
      confidentInId: null,
      refToken,
      // For a multi-candidate suggestion the kind previews the BEST candidate; the caller re-derives
      // it from the pair the user actually picks.
      kind: suggestLinkKind(out.entitySlug, candidates[0].entitySlug),
    });
  }

  return suggestions;
}

export function suggestLinkKind(outEntitySlug: string, inEntitySlug: string): LinkKind {
  // Same entity moving between its own accounts is always an internal transfer, even for personal.
  if (outEntitySlug === inEntitySlug) return "internal_transfer";
  // Personal on either side of a cross-entity move is owner funding (contribution or draw).
  if (outEntitySlug === "personal" || inEntitySlug === "personal") return "owner_funding";
  // GBSL pays Austin ACAA the 136 Anita lease: a real service between the entities.
  if (outEntitySlug === "gbsl" && inEntitySlug === "acaa-austin") return "intercompany_service";
  return "internal_transfer";
}

/**
 * The category pair to pre-fill for a link, or null when the pairing is link-only and the user
 * categorizes by hand. Paths must match lib/category-kind.ts byte-exact (em dashes included) so the
 * legs land under their non-expense kinds.
 */
export function categoryPairTemplate(
  kind: LinkKind,
  outEntitySlug: string,
  inEntitySlug: string,
): { outPath: string; inPath: string } | null {
  switch (kind) {
    case "owner_funding":
      if (outEntitySlug === "personal") {
        // Personal funds an LLC: funding kind on both sides (lib/category-kind.ts FUNDING_PATHS).
        return { outPath: "Owner transfer to business", inPath: "Owner Contribution" };
      }
      // Business -> personal draw: link only. Rare, and the right category (distribution vs
      // reimbursement vs payroll) needs a human, so no template.
      return null;
    case "intercompany_service":
      if (outEntitySlug === "gbsl" && inEntitySlug === "acaa-austin") {
        // The relationship the dead self_rental_links DB table was built to represent (never wired up).
        return {
          outPath: "Intercompany — 136 Anita",
          inPath: "Intercompany — 136 Anita (income)",
        };
      }
      return null;
    case "internal_transfer":
      return { outPath: "Internal transfer", inPath: "Internal transfer" };
  }
}
