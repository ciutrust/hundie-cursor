import { describe, expect, it } from "vitest";
import { config } from "@/proxy";

// S5: /categories renders financial data and must sit inside the auth wall. This guards against the
// exact regression class the review found — a route silently falling outside the middleware matcher.
describe("proxy matcher (S5)", () => {
  it("covers /categories", () => {
    expect(config.matcher).toContain("/categories/:path*");
  });

  it("still covers the other protected surfaces", () => {
    for (const route of ["/review/:path*", "/reports/:path*", "/settings/:path*"]) {
      expect(config.matcher).toContain(route);
    }
  });
});
