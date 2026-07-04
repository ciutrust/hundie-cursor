import { afterEach, describe, expect, test } from "vitest";
import { buildWeeklyDigest } from "../lib/digest";
import type { SidebarEntityNavItem } from "../lib/queries/entity-home";

const item = (name: string, slug: string, unclassifiedCount: number): SidebarEntityNavItem => ({
  name,
  slug,
  unclassifiedCount,
});

// #1 — the weekly digest copy + totals (pure).
describe("buildWeeklyDigest", () => {
  test("sums the backlog, lists entities with a backlog (desc), links to review", () => {
    const d = buildWeeklyDigest(
      [item("GBSL", "gbsl", 12), item("Personal", "personal", 3), item("Keller", "keller", 0)],
      { reviewUrl: "https://app.example.com/review" },
    );
    expect(d.total).toBe(15);
    expect(d.subject).toBe("Hundie: 15 transactions left to categorize");
    // entity with 0 backlog is not listed; ordering is by count desc
    expect(d.html.indexOf("GBSL")).toBeLessThan(d.html.indexOf("Personal"));
    expect(d.html).not.toContain("Keller");
    expect(d.html).toContain("https://app.example.com/review");
    expect(d.html).toContain("12");
  });

  test("singular subject for exactly one", () => {
    const d = buildWeeklyDigest([item("GBSL", "gbsl", 1)], { reviewUrl: "u" });
    expect(d.subject).toBe("Hundie: 1 transaction left to categorize");
  });

  test("all caught up when nothing has a backlog", () => {
    const d = buildWeeklyDigest([item("GBSL", "gbsl", 0)], { reviewUrl: "u" });
    expect(d.total).toBe(0);
    expect(d.subject).toContain("all caught up");
    expect(d.html).toContain("caught up");
  });

  test("escapes HTML in entity names", () => {
    const d = buildWeeklyDigest([item("A & B <x>", "ab", 2)], { reviewUrl: "u" });
    expect(d.html).toContain("A &amp; B &lt;x&gt;");
    expect(d.html).not.toContain("A & B <x>");
  });
});

// #1 — the cron route must reject anything without the correct CRON_SECRET before doing any work.
describe("weekly-digest cron auth", () => {
  const prev = { secret: process.env.CRON_SECRET, op: process.env.OPERATOR_EMAIL };
  afterEach(() => {
    process.env.CRON_SECRET = prev.secret;
    process.env.OPERATOR_EMAIL = prev.op;
  });

  test("401 when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import("../app/api/cron/weekly-digest/route");
    const res = await GET(new Request("https://x/api/cron/weekly-digest"));
    expect(res.status).toBe(401);
  });

  test("401 when the bearer token is wrong", async () => {
    process.env.CRON_SECRET = "right-secret";
    process.env.OPERATOR_EMAIL = "ops@example.com";
    const { GET } = await import("../app/api/cron/weekly-digest/route");
    const res = await GET(
      new Request("https://x/api/cron/weekly-digest", {
        headers: { authorization: "Bearer wrong-secret" },
      }),
    );
    expect(res.status).toBe(401);
  });
});
