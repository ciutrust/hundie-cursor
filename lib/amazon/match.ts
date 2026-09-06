/**
 * Match Amazon shipments to ledger card charges.
 * Ported from hundie-amazon-match/match.py resolve / build_candidates.
 */

import {
  wantsDigitalPurchase,
  wantsPhysicalPurchase,
} from "@/lib/amazon/detect";
import { amountToCents } from "@/lib/money";
import type {
  AmazonLedgerCharge,
  AmazonShipment,
  ChargeMatchResult,
  MatchCandidate,
} from "@/lib/amazon/types";

export const DATE_WINDOW_DAYS = 5;

function daysBetween(aIso: string, bIso: string): number {
  const a = Date.parse(`${aIso}T00:00:00Z`);
  const b = Date.parse(`${bIso}T00:00:00Z`);
  return Math.round(Math.abs(a - b) / 86_400_000);
}

export function buildCandidates(
  charges: AmazonLedgerCharge[],
  shipments: AmazonShipment[],
  last4Map?: Record<string, string>,
  onlyHypothesis?: string,
): Map<string, MatchCandidate[]> {
  const pairs = new Map<string, MatchCandidate[]>();

  for (const txn of charges) {
    const tCents = Math.abs(amountToCents(txn.amount));
    const wantsDigital = wantsDigitalPurchase(txn.descriptor, txn.vendor);
    const wantsPhysical = wantsPhysicalPurchase(txn.descriptor, txn.vendor);
    const cands: MatchCandidate[] = [];

    for (const ship of shipments) {
      if (wantsDigital && !ship.digital) continue;
      if (wantsPhysical && ship.digital) continue;
      if (!ship.shipDate) continue;
      if (ship.storeCard) continue;

      const delta = daysBetween(txn.date, ship.shipDate);
      if (delta > DATE_WINDOW_DAYS) continue;

      for (const [hypothesis, amount] of Object.entries(ship.amounts)) {
        if (onlyHypothesis && hypothesis !== onlyHypothesis) continue;
        if (amount !== tCents) continue;
        if (last4Map && ship.last4) {
          const expected = last4Map[ship.last4];
          if (expected && expected !== txn.accountSlug) continue;
        }
        cands.push({
          shipmentKey: ship.shipmentKey,
          hypothesis,
          dateDelta: delta,
        });
        break;
      }
    }
    pairs.set(txn.transactionId, cands);
  }
  return pairs;
}

/** Lock mutually unique charge↔shipment pairs (tier A). */
export function resolveUnique(
  pairs: Map<string, MatchCandidate[]>,
): { assigned: Map<string, MatchCandidate>; taken: Set<string> } {
  const assigned = new Map<string, MatchCandidate>();
  const taken = new Set<string>();
  const remaining = new Map(
    [...pairs.entries()].map(([id, cands]) => [id, [...cands]] as const),
  );

  let changed = true;
  while (changed) {
    changed = false;
    const wantedBy = new Map<string, string[]>();
    for (const [txnId, cands] of remaining) {
      if (assigned.has(txnId)) continue;
      for (const cand of cands) {
        if (taken.has(cand.shipmentKey)) continue;
        const list = wantedBy.get(cand.shipmentKey) ?? [];
        list.push(txnId);
        wantedBy.set(cand.shipmentKey, list);
      }
    }

    for (const [txnId, cands] of remaining) {
      if (assigned.has(txnId)) continue;
      const open = cands.filter((c) => !taken.has(c.shipmentKey));
      if (open.length === 1) {
        const key = open[0]!.shipmentKey;
        if ((wantedBy.get(key) ?? []).length === 1) {
          assigned.set(txnId, open[0]!);
          taken.add(key);
          changed = true;
        }
      }
    }
  }
  return { assigned, taken };
}

export function learnLast4Map(
  charges: AmazonLedgerCharge[],
  shipments: AmazonShipment[],
  assigned: Map<string, MatchCandidate>,
): Record<string, string> {
  const byKey = new Map(shipments.map((s) => [s.shipmentKey, s]));
  const byTxn = new Map(charges.map((c) => [c.transactionId, c]));
  const votes = new Map<string, Map<string, number>>();

  for (const [txnId, cand] of assigned) {
    const ship = byKey.get(cand.shipmentKey);
    const txn = byTxn.get(txnId);
    if (!ship?.last4 || !txn) continue;
    const tally = votes.get(ship.last4) ?? new Map();
    tally.set(txn.accountSlug, (tally.get(txn.accountSlug) ?? 0) + 1);
    votes.set(ship.last4, tally);
  }

  const mapping: Record<string, string> = {};
  for (const [last4, tally] of votes) {
    const entries = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    const [best, count] = entries[0]!;
    const rest = entries.slice(1).reduce((s, [, n]) => s + n, 0);
    if (count >= 2 && count >= 2 * rest) mapping[last4] = best;
  }
  return mapping;
}

function dominantHypothesis(assigned: Map<string, MatchCandidate>): string | null {
  const wins = new Map<string, number>();
  for (const cand of assigned.values()) {
    wins.set(cand.hypothesis, (wins.get(cand.hypothesis) ?? 0) + 1);
  }
  if (!wins.size) return null;
  const [top, n] = [...wins.entries()].sort((a, b) => b[1] - a[1])[0]!;
  const total = [...wins.values()].reduce((a, b) => a + b, 0);
  if (n >= 3 && n >= total * 0.6) return top;
  return null;
}

/**
 * Full match pipeline: pass 1 blind → learn last4 → optional dominant hypothesis → re-resolve.
 */
export function matchChargesToShipments(
  charges: AmazonLedgerCharge[],
  shipments: AmazonShipment[],
): ChargeMatchResult[] {
  let pairs = buildCandidates(charges, shipments);
  let { assigned } = resolveUnique(pairs);
  const last4Map = learnLast4Map(charges, shipments, assigned);
  const dominant = dominantHypothesis(assigned);

  pairs = buildCandidates(charges, shipments, last4Map, dominant ?? undefined);
  ({ assigned } = resolveUnique(pairs));

  const taken = new Set([...assigned.values()].map((c) => c.shipmentKey));
  const results: ChargeMatchResult[] = [];

  for (const charge of charges) {
    const unique = assigned.get(charge.transactionId);
    if (unique) {
      results.push({
        transactionId: charge.transactionId,
        tier: "A",
        shipmentKey: unique.shipmentKey,
        hypothesis: unique.hypothesis,
        dateDelta: unique.dateDelta,
        candidates: [unique],
      });
      continue;
    }

    const open = (pairs.get(charge.transactionId) ?? []).filter(
      (c) => !taken.has(c.shipmentKey),
    );
    if (open.length === 0) {
      results.push({
        transactionId: charge.transactionId,
        tier: "C",
        shipmentKey: null,
        hypothesis: null,
        dateDelta: null,
        candidates: [],
      });
    } else {
      results.push({
        transactionId: charge.transactionId,
        tier: "B",
        shipmentKey: open[0]!.shipmentKey,
        hypothesis: open[0]!.hypothesis,
        dateDelta: open[0]!.dateDelta,
        candidates: open,
      });
    }
  }
  return results;
}
