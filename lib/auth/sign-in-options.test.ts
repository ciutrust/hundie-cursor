import { describe, expect, it } from "vitest";
import { magicLinkOtpOptions } from "@/lib/auth/sign-in-options";

describe("magicLinkOtpOptions (S1: no self-registration)", () => {
  it("disables user creation on the magic-link path", () => {
    const opts = magicLinkOtpOptions("https://app.example.com", "/review");
    expect(opts.shouldCreateUser).toBe(false);
  });
  it("builds the auth callback redirect with the encoded redirect path", () => {
    const opts = magicLinkOtpOptions("https://app.example.com", "/review/gbsl");
    expect(opts.emailRedirectTo).toBe(
      "https://app.example.com/auth/callback?redirect=%2Freview%2Fgbsl",
    );
  });
});
