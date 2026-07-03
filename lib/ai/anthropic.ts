import { getAiModel, getAnthropicApiKey } from "@/lib/ai/config";

export type AnthropicUsage = {
  input_tokens: number;
  output_tokens: number;
};

export type AnthropicResult = {
  text: string;
  usage: AnthropicUsage;
  model: string;
};

// T4: a single flaky call (429/529/timeout) used to kill an entire multi-batch run. Bound each
// request with a timeout and retry transient failures a couple of times with backoff.
const TIMEOUT_MS = 60_000;
const MAX_RETRIES = 2;
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 529]);

function backoffMs(attempt: number): number {
  return 500 * 2 ** attempt; // 500ms, then 1000ms
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function callAnthropic(system: string, user: string): Promise<AnthropicResult> {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set in .env.local");
  }

  const model = getAiModel();
  const payload = JSON.stringify({
    model,
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: user }],
  });

  let lastError: Error = new Error("Anthropic API call failed");
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response: Response;
    try {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: payload,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      // Network error or timeout (AbortError): retry with backoff if attempts remain.
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw lastError;
    }

    if (!response.ok) {
      const body = await response.text();
      lastError = new Error(`Anthropic API ${response.status}: ${body.slice(0, 400)}`);
      // Retry transient statuses (rate limit / overloaded / 5xx); fail fast on 400/401/403 etc.
      if (RETRYABLE_STATUS.has(response.status) && attempt < MAX_RETRIES) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw lastError;
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const text = data.content?.find((block) => block.type === "text")?.text ?? "";
    return {
      text,
      usage: {
        input_tokens: data.usage?.input_tokens ?? 0,
        output_tokens: data.usage?.output_tokens ?? 0,
      },
      model,
    };
  }
  throw lastError;
}
