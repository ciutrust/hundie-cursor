// Pure suggestion-event classifier for the proposal commit path, kept OUT of proposals.ts (a
// "use server" module, where every export must be an async Server Action). Mirrors the accept/reject
// logic in suggestion-events.ts so the deterministic engine learns from proposal commits the same way
// it learns from the inline review flow.

export type ProposalEventInput = {
  /** The category the engine PROPOSED (what the operator was shown). */
  proposedCategoryId: string | null;
  /** The category actually booked (the operator's override, or the proposal if they kept it). */
  chosenCategoryId: string | null;
};

export type ProposalEventPlan = {
  eventType: "accept" | "reject";
  /** What was SHOWN — always the proposed category. */
  suggestedCategoryId: string | null;
  /** What was BOOKED. */
  chosenCategoryId: string | null;
};

/**
 * `accept` when the booked category equals the proposed one (operator took the suggestion), else
 * `reject` (operator overrode). Logging every commit as `accept` inflated the engine's accept-rate
 * and corrupted blend weights (C16). suggested_category_id is always the proposed category.
 */
export function classifyProposalEvent(input: ProposalEventInput): ProposalEventPlan {
  const accepted = input.chosenCategoryId === input.proposedCategoryId;
  return {
    eventType: accepted ? "accept" : "reject",
    suggestedCategoryId: input.proposedCategoryId,
    chosenCategoryId: input.chosenCategoryId,
  };
}
