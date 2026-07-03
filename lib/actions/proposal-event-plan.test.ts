import { describe, expect, it } from "vitest";
import { classifyProposalEvent } from "@/lib/actions/proposal-event-plan";

describe("classifyProposalEvent", () => {
  it("logs an accept when the operator kept the proposed category", () => {
    const e = classifyProposalEvent({ proposedCategoryId: "c1", chosenCategoryId: "c1" });
    expect(e.eventType).toBe("accept");
    expect(e.suggestedCategoryId).toBe("c1");
    expect(e.chosenCategoryId).toBe("c1");
  });

  it("logs a reject when the operator overrode to a different category", () => {
    const e = classifyProposalEvent({ proposedCategoryId: "c1", chosenCategoryId: "c2" });
    expect(e.eventType).toBe("reject");
    expect(e.suggestedCategoryId).toBe("c1"); // what was SHOWN
    expect(e.chosenCategoryId).toBe("c2"); // what was BOOKED
  });

  it("logs a reject when there was no proposed category but one was chosen", () => {
    const e = classifyProposalEvent({ proposedCategoryId: null, chosenCategoryId: "c2" });
    expect(e.eventType).toBe("reject");
    expect(e.suggestedCategoryId).toBeNull();
    expect(e.chosenCategoryId).toBe("c2");
  });

  it("logs an accept when both are null-equal (defensive, proposed === chosen)", () => {
    const e = classifyProposalEvent({ proposedCategoryId: null, chosenCategoryId: null });
    expect(e.eventType).toBe("accept");
  });
});
