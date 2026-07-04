/**
 * Minimal Resend sender (#1). Mirrors the lib/ai/anthropic.ts fetch+timeout+retry template so a
 * single transient failure doesn't drop the weekly digest. Server-only: reads RESEND_API_KEY.
 * Inert until the operator sets RESEND_API_KEY + EMAIL_FROM (see .env.local.example).
 */
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 529]);

function backoffMs(attempt: number): number {
  return 500 * 2 ** attempt;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  from?: string;
};

export async function sendEmail(input: SendEmailInput): Promise<{ id: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not set");
  }
  const from = input.from ?? process.env.EMAIL_FROM;
  if (!from) {
    throw new Error("EMAIL_FROM is not set (a verified Resend sender)");
  }

  const payload = JSON.stringify({
    from,
    to: input.to,
    subject: input.subject,
    html: input.html,
  });

  let lastError: Error = new Error("Resend email send failed");
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response: Response;
    try {
      response = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: payload,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw lastError;
    }

    if (!response.ok) {
      const body = await response.text();
      lastError = new Error(`Resend API ${response.status}: ${body.slice(0, 400)}`);
      if (RETRYABLE_STATUS.has(response.status) && attempt < MAX_RETRIES) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw lastError;
    }

    const data = (await response.json()) as { id?: string };
    return { id: data.id ?? "" };
  }
  throw lastError;
}
