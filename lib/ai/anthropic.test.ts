import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function okResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      content: [{ type: "text", text: '{"results":[]}' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
    text: async () => "",
  } as unknown as Response;
}

function errorResponse(status: number): Response {
  return {
    ok: false,
    status,
    text: async () => "overloaded",
    json: async () => ({}),
  } as unknown as Response;
}

async function importCallAnthropic() {
  vi.doMock("@/lib/ai/config", () => ({
    getAnthropicApiKey: () => "test-key",
    getAiModel: () => "claude-test",
  }));
  return (await import("@/lib/ai/anthropic")).callAnthropic;
}

describe("callAnthropic retry (T4)", () => {
  it("retries a transient 529 and then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(529))
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const callAnthropic = await importCallAnthropic();
    const res = await callAnthropic("sys", "user");

    expect(res.usage.input_tokens).toBe(10);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails fast on a non-retryable 400 (no retry)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(400));
    vi.stubGlobal("fetch", fetchMock);

    const callAnthropic = await importCallAnthropic();
    await expect(callAnthropic("sys", "user")).rejects.toThrow(/400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
