import { describe, expect, it } from "vitest";
import {
  googleOAuthRedirectTo,
  loginErrorMessage,
  postAuthRedirectUrl,
} from "@/lib/auth/sign-in-options";

describe("googleOAuthRedirectTo", () => {
  it("builds the auth callback redirect with the encoded redirect path", () => {
    expect(googleOAuthRedirectTo("https://app.example.com", "/review/gbsl")).toBe(
      "https://app.example.com/auth/callback?redirect=%2Freview%2Fgbsl",
    );
  });
});

describe("loginErrorMessage", () => {
  it("returns null when there is no error code", () => {
    expect(loginErrorMessage(null)).toBeNull();
    expect(loginErrorMessage("")).toBeNull();
  });

  it("explains a cancelled Google prompt", () => {
    expect(loginErrorMessage("access_denied")).toBe("Google sign-in was cancelled.");
  });

  it("uses a generic rejection for hook failures and unknown codes", () => {
    expect(loginErrorMessage("auth")).toBe(
      "Sign-in was rejected. This Google account cannot use Hundie.",
    );
    expect(loginErrorMessage("server_error")).toBe(
      "Sign-in was rejected. This Google account cannot use Hundie.",
    );
  });
});

describe("postAuthRedirectUrl", () => {
  it("keeps the request origin in development", () => {
    expect(
      postAuthRedirectUrl("http://localhost:3001", "/review", "hundie.vercel.app", true),
    ).toBe("http://localhost:3001/review");
  });

  it("uses x-forwarded-host on Vercel when present", () => {
    expect(
      postAuthRedirectUrl("http://127.0.0.1", "/review", "hundie.vercel.app", false),
    ).toBe("https://hundie.vercel.app/review");
  });

  it("falls back to origin when no forwarded host", () => {
    expect(postAuthRedirectUrl("https://app.example.com", "/login?error=auth", null, false)).toBe(
      "https://app.example.com/login?error=auth",
    );
  });
});
