import { amountToCents, parseAmountToCents } from "@/lib/money";

/** One leg as edited in the UI (amount is raw text until validated). */
export type SplitLegDraft = {
  entityId: string;
  categoryId: string | null;
  amount: string;
};

export type ValidatedLeg = { entityId: string; categoryId: string; amountCents: number };

export type SplitValidation =
  | { ok: true; legs: ValidatedLeg[] }
  | { ok: false; error: string };

/**
 * The single source of truth for split rules + copy — used LIVE in the dialog and re-checked in the
 * server action. Mirrors the DB RPC apply_transaction_split (which is authoritative): >= 2 legs, every
 * leg has an entity + a category (categories are required — no "review later" legs) + a nonzero amount
 * with the SAME sign as the parent, and the legs sum to the parent to the cent.
 */
export function validateSplit(legs: SplitLegDraft[], parentAmount: number): SplitValidation {
  if (legs.length < 2) return { ok: false, error: "Add at least 2 legs." };

  const parentCents = amountToCents(parentAmount);
  const parentSign = Math.sign(parentCents);
  const validated: ValidatedLeg[] = [];

  for (let i = 0; i < legs.length; i += 1) {
    const leg = legs[i];
    const label = `Leg ${i + 1}`;
    if (!leg.entityId) return { ok: false, error: `${label}: choose an entity.` };
    if (!leg.categoryId) return { ok: false, error: `${label}: choose a category.` };
    const cents = parseAmountToCents(leg.amount);
    if (cents === null) return { ok: false, error: `${label}: enter a valid amount.` };
    if (cents === 0) return { ok: false, error: `${label}: amount can't be $0.00.` };
    if (Math.sign(cents) !== parentSign) {
      return {
        ok: false,
        error:
          parentSign > 0
            ? `${label}: must be a positive amount (this is a charge).`
            : `${label}: must be a negative amount (this is a credit).`,
      };
    }
    validated.push({ entityId: leg.entityId, categoryId: leg.categoryId, amountCents: cents });
  }

  const sumCents = validated.reduce((s, l) => s + l.amountCents, 0);
  if (sumCents !== parentCents) {
    const remaining = (parentCents - sumCents) / 100;
    const sign = remaining < 0 ? "-" : "";
    return {
      ok: false,
      error: `Legs must sum to the transaction total. Remaining: ${sign}$${Math.abs(remaining).toFixed(2)}`,
    };
  }

  return { ok: true, legs: validated };
}

/** Remaining cents to allocate (parent − sum of the legs' parsed amounts). Drives the live indicator. */
export function remainingCents(legs: SplitLegDraft[], parentAmount: number): number {
  const sum = legs.reduce((s, leg) => s + (parseAmountToCents(leg.amount) ?? 0), 0);
  return amountToCents(parentAmount) - sum;
}
