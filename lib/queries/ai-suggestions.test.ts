import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("getSuggestionAcceptanceBySource (QA-06)", () => {
  it("propagates a query error instead of swallowing it to []", async () => {
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        from: () => ({
          select: () => ({
            order: () => ({
              range: async () => ({ data: null, error: { message: "rls denied" } }),
            }),
          }),
        }),
      }),
    }));
    const { getSuggestionAcceptanceBySource } = await import("@/lib/queries/ai-suggestions");
    await expect(getSuggestionAcceptanceBySource()).rejects.toThrow("rls denied");
  });

  it("returns aggregated stats on success", async () => {
    const rows = [
      { event_type: "accept", suggestion_source: "ai_llm" },
      { event_type: "reject", suggestion_source: "ai_llm" },
      { event_type: "accept", suggestion_source: "confirmed_history" },
    ];
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        from: () => ({
          select: () => ({
            order: () => ({ range: async () => ({ data: rows, error: null }) }),
          }),
        }),
      }),
    }));
    const { getSuggestionAcceptanceBySource } = await import("@/lib/queries/ai-suggestions");
    const out = await getSuggestionAcceptanceBySource();
    const ai = out.find((r) => r.source === "ai_llm");
    expect(ai).toMatchObject({ shown: 2, accepted: 1, rejected: 1, accept_rate: 0.5 });
  });
});
