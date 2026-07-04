import type { SidebarEntityNavItem } from "@/lib/queries/entity-home";

/**
 * #1 — weekly "N left to categorize" digest. Pure builders so the copy + totals are unit-tested; the
 * cron route just wires the data + delivery. HTML is inline-styled and dependency-free (email clients
 * ignore <style>/external CSS). Shows three windows per entity: YTD, last month, this month.
 */
export type WeeklyDigest = {
  subject: string;
  html: string;
  total: number;
};

/** One entity's backlog across the three windows the digest reports. */
export type DigestEntityRow = {
  slug: string;
  name: string;
  ytd: number;
  lastMonth: number;
  thisMonth: number;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Merge the three per-window backlog reads (each from getSidebarEntityNav) into one row per entity.
 * Keyed by slug off the YTD list (which always contains every classifiable entity); a window with no
 * count for a slug contributes 0.
 */
export function mergeDigestWindows(
  ytd: SidebarEntityNavItem[],
  lastMonth: SidebarEntityNavItem[],
  thisMonth: SidebarEntityNavItem[],
): DigestEntityRow[] {
  const byLast = new Map(lastMonth.map((i) => [i.slug, i.unclassifiedCount]));
  const byThis = new Map(thisMonth.map((i) => [i.slug, i.unclassifiedCount]));
  return ytd.map((i) => ({
    slug: i.slug,
    name: i.name,
    ytd: i.unclassifiedCount,
    lastMonth: byLast.get(i.slug) ?? 0,
    thisMonth: byThis.get(i.slug) ?? 0,
  }));
}

export function buildWeeklyDigest(
  rows: DigestEntityRow[],
  opts: { reviewUrl: string; lastMonthLabel?: string; thisMonthLabel?: string },
): WeeklyDigest {
  const withBacklog = rows
    .filter((r) => r.ytd > 0 || r.lastMonth > 0 || r.thisMonth > 0)
    .sort((a, b) => b.ytd - a.ytd || b.thisMonth - a.thisMonth || a.name.localeCompare(b.name));

  const total = withBacklog.reduce((s, r) => s + r.ytd, 0);
  const totalLast = withBacklog.reduce((s, r) => s + r.lastMonth, 0);
  const totalThis = withBacklog.reduce((s, r) => s + r.thisMonth, 0);

  const subject =
    total > 0
      ? `Hundie: ${total.toLocaleString()} transaction${total === 1 ? "" : "s"} left to categorize`
      : "Hundie: all caught up — 0 to categorize 🎉";

  const numCell = (n: number, extra = "") =>
    `<td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;font-variant-numeric:tabular-nums;${extra}">${n.toLocaleString()}</td>`;

  const bodyRows =
    withBacklog.length > 0
      ? withBacklog
          .map(
            (r) =>
              `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;">${escapeHtml(
                r.name,
              )}</td>${numCell(r.ytd)}${numCell(r.lastMonth)}${numCell(r.thisMonth)}</tr>`,
          )
          .join("")
      : `<tr><td colspan="4" style="padding:12px;color:#16a34a;">Nothing to categorize — every entity is clear. 🎉</td></tr>`;

  const totalRow =
    withBacklog.length > 0
      ? `<tr><td style="padding:6px 12px;border-top:2px solid #ddd;font-weight:600;">Total</td>${numCell(
          total,
          "border-top:2px solid #ddd;font-weight:600;",
        )}${numCell(totalLast, "border-top:2px solid #ddd;font-weight:600;")}${numCell(
          totalThis,
          "border-top:2px solid #ddd;font-weight:600;",
        )}</tr>`
      : "";

  const lastLabel = opts.lastMonthLabel ?? "last month";
  const thisLabel = opts.thisMonthLabel ?? "this month";

  const cta =
    total > 0
      ? `<p style="margin:20px 0;"><a href="${escapeHtml(
          opts.reviewUrl,
        )}" style="background:#4f46e5;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;">Open the review dashboard →</a></p>`
      : `<p style="margin:20px 0;"><a href="${escapeHtml(opts.reviewUrl)}" style="color:#4f46e5;">Open Hundie →</a></p>`;

  const th = (label: string, align: string) =>
    `<th style="text-align:${align};padding:6px 12px;border-bottom:2px solid #ddd;white-space:nowrap;">${label}</th>`;

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;max-width:520px;margin:0 auto;">
  <h1 style="font-size:20px;margin:0 0 4px;">${
    total > 0 ? `${total.toLocaleString()} left to categorize` : "You're all caught up"
  }</h1>
  <p style="color:#666;margin:0 0 16px;font-size:14px;">Still to categorize by entity — YTD, ${escapeHtml(
    lastLabel,
  )}, and ${escapeHtml(thisLabel)}.</p>
  <table style="border-collapse:collapse;width:100%;font-size:14px;">
    <thead>
      <tr>${th("Entity", "left")}${th("YTD", "right")}${th("Last month", "right")}${th("This month", "right")}</tr>
    </thead>
    <tbody>${bodyRows}${totalRow}</tbody>
  </table>
  ${cta}
  <p style="color:#999;font-size:12px;">Weekly digest from Hundie. You’re receiving this because you’re the ledger operator.</p>
</div>`;

  return { subject, html, total };
}
