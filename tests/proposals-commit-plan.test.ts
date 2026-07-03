import { describe, expect, it } from "vitest";
import { partitionCommitPlan } from "@/lib/actions/commit-plan";
import { classifyProposalEvent } from "@/lib/actions/proposal-event-plan";

const cand = (over: Record<string, unknown> = {}) => ({
  proposalId: "p1", transactionId: "t1", entityId: "e1", categoryId: "c-proposed",
  rationale: "training says meals", source: "training", description: "CHIPOTLE", vendor: null,
  proposedCategoryId: "c-proposed", ...over,
});

describe("partitionCommitPlan", () => {
  it("writes a still-unclassified import row", () => {
    const existing = new Map([["t1", { category_id: null, classified_by: "import", notes: null }]]);
    const { toWrite, staleProposalIds } = partitionCommitPlan([cand()] as never, existing as never);
    expect(staleProposalIds).toEqual([]);
    expect(toWrite).toHaveLength(1);
    expect(toWrite[0].categoryId).toBe("c-proposed");
  });
  it("skips a txn already given a category (interim manual classification)", () => {
    const existing = new Map([["t1", { category_id: "c-manual", classified_by: "alex@example.com", notes: "keep me" }]]);
    const { toWrite, staleProposalIds } = partitionCommitPlan([cand()] as never, existing as never);
    expect(toWrite).toEqual([]);
    expect(staleProposalIds).toEqual(["p1"]);
  });
  it("skips a txn whose classifier is non-machine even when category is still null", () => {
    const existing = new Map([["t1", { category_id: null, classified_by: "alex@example.com", notes: null }]]);
    const { toWrite, staleProposalIds } = partitionCommitPlan([cand()] as never, existing as never);
    expect(toWrite).toEqual([]);
    expect(staleProposalIds).toEqual(["p1"]);
  });
  it("never overwrites an existing note with null when the row IS writable", () => {
    const existing = new Map([["t1", { category_id: null, classified_by: "import", notes: "prior note" }]]);
    const { toWrite } = partitionCommitPlan([cand({ rationale: null })] as never, existing as never);
    expect(toWrite[0].keepNote).toBe("prior note");
  });
  it("writes when there is no existing classification row at all", () => {
    const { toWrite, staleProposalIds } = partitionCommitPlan([cand()] as never, new Map() as never);
    expect(staleProposalIds).toEqual([]);
    expect(toWrite[0].keepNote).toBe("training says meals");
  });

  it("threads proposedCategoryId through to toWrite (C16)", () => {
    const overridden = cand({
      categoryId: "c-chosen",
      proposedCategoryId: "c-proposed",
    });
    const { toWrite } = partitionCommitPlan([overridden] as never, new Map() as never);
    expect(toWrite[0].proposedCategoryId).toBe("c-proposed");
    expect(toWrite[0].categoryId).toBe("c-chosen"); // the booked category
  });

  it("an overridden proposal yields a reject event with suggested_category_id === proposedCategoryId (C16)", () => {
    const overridden = cand({ categoryId: "c-chosen", proposedCategoryId: "c-proposed" });
    const { toWrite } = partitionCommitPlan([overridden] as never, new Map() as never);
    const x = toWrite[0];
    const ev = classifyProposalEvent({
      proposedCategoryId: x.proposedCategoryId,
      chosenCategoryId: x.categoryId,
    });
    expect(ev.eventType).toBe("reject");
    expect(ev.suggestedCategoryId).toBe("c-proposed"); // what was shown
    expect(ev.chosenCategoryId).toBe("c-chosen"); // what was booked
  });

  it("a kept proposal yields an accept event (C16)", () => {
    const { toWrite } = partitionCommitPlan([cand()] as never, new Map() as never);
    const x = toWrite[0];
    const ev = classifyProposalEvent({
      proposedCategoryId: x.proposedCategoryId,
      chosenCategoryId: x.categoryId,
    });
    expect(ev.eventType).toBe("accept");
    expect(ev.suggestedCategoryId).toBe("c-proposed");
  });
});
