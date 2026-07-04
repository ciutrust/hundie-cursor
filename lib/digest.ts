import type { SidebarEntityNavItem } from "@/lib/queries/entity-home";

/**
 * #1 — weekly "N left to categorize" digest. Pure builder so the copy + totals are unit-tested; the
 * cron route just wires the data + delivery. HTML is inline-styled and dependency-free (email clients
 * ignore <style>/external CSS).
 */
export type WeeklyDigest = {
  subject: string;
  html: string;
  total: number;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildWeeklyDigest(
  items: SidebarEntityNavItem[],
  opts: { reviewUrl: string },
): WeeklyDigest {
  const withBacklog = items
    .filter((item) => item.unclassifiedCount > 0)
    .sort((a, b) => b.unclassifiedCount - a.unclassifiedCount);
  const total = withBacklog.reduce((sum, item) => sum + item.unclassifiedCount, 0);

  const subject =
    total > 0
      ? `Hundie: ${total.toLocaleString()} transaction${total === 1 ? "" : "s"} left to categorize`
      : "Hundie: all caught up — 0 to categorize 🎉";

  const rows =
    withBacklog.length > 0
      ? withBacklog
          .map(
            (item) =>
              `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;">${escapeHtml(
                item.name,
              )}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;font-variant-numeric:tabular-nums;">${item.unclassifiedCount.toLocaleString()}</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="2" style="padding:12px;color:#16a34a;">Nothing to categorize — every entity is clear. 🎉</td></tr>`;

  const cta =
    total > 0
      ? `<p style="margin:20px 0;"><a href="${escapeHtml(
          opts.reviewUrl,
        )}" style="background:#4f46e5;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;">Open the review dashboard →</a></p>`
      : `<p style="margin:20px 0;"><a href="${escapeHtml(opts.reviewUrl)}" style="color:#4f46e5;">Open Hundie →</a></p>`;

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;max-width:520px;margin:0 auto;">
  <h1 style="font-size:20px;margin:0 0 4px;">${
    total > 0 ? `${total.toLocaleString()} left to categorize` : "You're all caught up"
  }</h1>
  <p style="color:#666;margin:0 0 16px;font-size:14px;">Year-to-date review backlog, by entity.</p>
  <table style="border-collapse:collapse;width:100%;font-size:14px;">
    <thead>
      <tr><th style="text-align:left;padding:6px 12px;border-bottom:2px solid #ddd;">Entity</th><th style="text-align:right;padding:6px 12px;border-bottom:2px solid #ddd;">To classify</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  ${cta}
  <p style="color:#999;font-size:12px;">Weekly digest from Hundie. You’re receiving this because you’re the ledger operator.</p>
</div>`;

  return { subject, html, total };
}
