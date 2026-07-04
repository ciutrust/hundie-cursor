import { afterEach, describe, expect, test } from "vitest";
import {
  buildWeeklyDigest,
  mergeDigestWindows,
  uncategorizedLink,
  type DigestEntityRow,
  type DigestOptions,
} from "../lib/digest";
import type { SidebarEntityNavItem } from "../lib/queries/entity-home";

const OPTS: DigestOptions = {
  baseUrl: "https://app.example.com",
  ytdQuery: "period=year&at=2026",
  lastMonthQuery: "period=month&at=2026-06",
  thisMonthQuery: "period=month&at=2026-07",
  lastMonthLabel: "June 2026",
  thisMonthLabel: "July 2026",
};

const nav = (name: string, slug: string, unclassifiedCount: number): SidebarEntityNavItem => ({
  name,
  slug,
  unclassifiedCount,
});

const row = (
  name: string,
  slug: string,
  ytd: number,
  lastMonth: number,
  thisMonth: number,
): DigestEntityRow => ({ name, slug, ytd, lastMonth, thisMonth });

// #1 — merge the three per-window reads into one row per entity.
describe("mergeDigestWindows", () => {
  test("keys off YTD; missing windows contribute 0", () => {
    const merged = mergeDigestWindows(
      [nav("GBSL", "gbsl", 12), nav("Personal", "personal", 3)],
      [nav("GBSL", "gbsl", 5)], // Personal absent in last-month read
      [nav("Personal", "personal", 1)], // GBSL absent in this-month read
    );
    expect(merged).toEqual([
      { slug: "gbsl", name: "GBSL", ytd: 12, lastMonth: 5, thisMonth: 0 },
      { slug: "personal", name: "Personal", ytd: 3, lastMonth: 0, thisMonth: 1 },
    ]);
  });
});

// #1 — deep-link builder (drops a trailing slash on the base).
describe("uncategorizedLink", () => {
  test("builds an entity/window uncategorized URL; normalizes a trailing slash", () => {
    expect(uncategorizedLink("https://app.example.com", "gbsl", "period=month&at=2026-06")).toBe(
      "https://app.example.com/review/gbsl/uncategorized?period=month&at=2026-06",
    );
    expect(uncategorizedLink("https://app.example.com/", "gbsl", "period=year&at=2026")).toBe(
      "https://app.example.com/review/gbsl/uncategorized?period=year&at=2026",
    );
  });
});

// #1 — the weekly digest copy + three-window table + per-cell deep links (pure).
describe("buildWeeklyDigest", () => {
  test("subject/headline use the YTD total; lists entities with any backlog (YTD desc)", () => {
    const d = buildWeeklyDigest(
      [row("GBSL", "gbsl", 12, 4, 0), row("Personal", "personal", 3, 1, 2), row("Keller", "keller", 0, 0, 0)],
      OPTS,
    );
    expect(d.total).toBe(15);
    expect(d.subject).toBe("Hundie: 15 transactions left to categorize");
    expect(d.html.indexOf("GBSL")).toBeLessThan(d.html.indexOf("Personal"));
    expect(d.html).not.toContain("Keller"); // all-zero across every window → dropped
    expect(d.html).toContain("Last month");
    expect(d.html).toContain("This month");
    expect(d.html).toContain("June 2026");
    expect(d.html).toContain("Total");
  });

  test("each non-zero count deep-links to that entity/window uncategorized list; zeros stay plain", () => {
    const d = buildWeeklyDigest([row("GBSL", "gbsl", 12, 4, 0)], OPTS);
    // YTD cell → year window, last-month cell → month window
    expect(d.html).toContain(
      'href="https://app.example.com/review/gbsl/uncategorized?period=year&amp;at=2026"',
    );
    expect(d.html).toContain(
      'href="https://app.example.com/review/gbsl/uncategorized?period=month&amp;at=2026-06"',
    );
    // this-month is 0 → no link for that window (only the two non-zero links)
    expect(d.html).not.toContain("at=2026-07");
    // dashboard CTA points at /review
    expect(d.html).toContain('href="https://app.example.com/review"');
  });

  test("an entity with only a recent-month backlog (0 YTD) is still listed", () => {
    // e.g. in January, last month is in the prior year — outside YTD.
    const d = buildWeeklyDigest([row("GBSL", "gbsl", 0, 7, 0)], OPTS);
    expect(d.html).toContain("GBSL");
    expect(d.total).toBe(0); // headline tracks YTD; row still shown for the month backlog
  });

  test("singular subject for exactly one (YTD)", () => {
    const d = buildWeeklyDigest([row("GBSL", "gbsl", 1, 0, 0)], OPTS);
    expect(d.subject).toBe("Hundie: 1 transaction left to categorize");
  });

  test("all caught up when nothing has a backlog in any window", () => {
    const d = buildWeeklyDigest([row("GBSL", "gbsl", 0, 0, 0)], OPTS);
    expect(d.total).toBe(0);
    expect(d.subject).toContain("all caught up");
    expect(d.html).toContain("caught up");
  });

  test("escapes HTML in entity names", () => {
    const d = buildWeeklyDigest([row("A & B <x>", "ab", 2, 0, 0)], OPTS);
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
