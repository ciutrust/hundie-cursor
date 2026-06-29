import { describe, expect, test } from "vitest";
import nextConfig, { securityHeaders } from "./next.config";

function headerValue(key: string): string | undefined {
  return securityHeaders.find((h) => h.key === key)?.value;
}

describe("SEC-02 — security headers", () => {
  test("sets clickjacking + transport hardening headers", () => {
    expect(headerValue("X-Frame-Options")).toBe("DENY");
    expect(headerValue("Content-Security-Policy")).toBe("frame-ancestors 'none'");
    expect(headerValue("X-Content-Type-Options")).toBe("nosniff");
    expect(headerValue("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headerValue("Strict-Transport-Security")).toContain("max-age=");
    expect(headerValue("Strict-Transport-Security")).toContain("includeSubDomains");
  });

  test("CSP is clickjacking-only — no broad directives that would break Next/Plaid", () => {
    const csp = headerValue("Content-Security-Policy") ?? "";
    // A restrictive default/script/style/frame CSP would break Next's inline
    // runtime and the embedded Plaid Link iframe. Guard against accidental adds.
    expect(csp).not.toContain("default-src");
    expect(csp).not.toContain("script-src");
    expect(csp).not.toContain("style-src");
    expect(csp).not.toContain("frame-src");
  });

  test("headers() applies the set to every route", async () => {
    const headers = await nextConfig.headers!();
    expect(headers).toHaveLength(1);
    expect(headers[0].source).toBe("/(.*)");
    expect(headers[0].headers).toBe(securityHeaders);
  });
});
