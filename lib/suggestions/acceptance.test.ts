import { describe, expect, test } from "vitest";
import { acceptanceBySource } from "./acceptance";

describe("acceptanceBySource", () => {
  test("groups accept/reject by suggestion_source with accept_rate", () => {
    const events = [
      { event_type: "accept", suggestion_source: "ai_llm" },
      { event_type: "reject", suggestion_source: "ai_llm" },
      { event_type: "accept", suggestion_source: "blended" },
      { event_type: "accept", suggestion_source: "blended" },
    ];
    const r = acceptanceBySource(events);
    const ai = r.find((x) => x.source === "ai_llm")!;
    const blended = r.find((x) => x.source === "blended")!;
    expect(ai.shown).toBe(2);
    expect(ai.accepted).toBe(1);
    expect(ai.accept_rate).toBe(0.5);
    expect(blended.accept_rate).toBe(1);
  });

  test("null/empty source buckets as 'manual'", () => {
    const r = acceptanceBySource([{ event_type: "manual", suggestion_source: null }]);
    expect(r[0].source).toBe("manual");
    expect(r[0].shown).toBe(1);
    expect(r[0].accepted).toBe(0);
  });

  test("sorted by shown descending", () => {
    const events = [
      { event_type: "accept", suggestion_source: "a" },
      { event_type: "accept", suggestion_source: "b" },
      { event_type: "accept", suggestion_source: "b" },
    ];
    expect(acceptanceBySource(events)[0].source).toBe("b");
  });
});
