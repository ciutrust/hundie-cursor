/**
 * Renders the GBSL ↔ QBO drift report JSON (scripts/lib/qb-drift.mjs) as a standalone page.
 *
 *   renderDriftFragment(report) → <title> + <style> + markup + data + script (artifact-ready)
 *   renderDriftDocument(report) → full HTML document (opens from disk)
 *
 * Static sections are rendered here; the drill-down tables and filters run client-side from the
 * embedded JSON. No libraries, no external assets except Google Fonts (with fallbacks).
 */

const KIND_LABEL = {
  expense: "expense",
  income: "income",
  transfer: "transfer",
  funding: "funding",
  capital: "capital",
  liability: "liability",
  non_deductible: "non-deductible",
  review: "review",
  unclassified: "unclassified",
};

const FLAG_LABEL = {
  unusedBoth: "Unused on both sides",
  hundieOnly: "Hundie only",
  qboOnly: "QBO only",
  nameVariant: "Name variant",
  alias: "Alias of a QBO name",
  kindMismatch: "Treated differently",
};

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function fmtMoney(n, { sign = true } = {}) {
  const v = Number(n ?? 0);
  const abs = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 && sign ? `-$${abs}` : `$${abs}`;
}

function fmtInt(n) {
  return Number(n ?? 0).toLocaleString("en-US");
}

function rowsLabel(n) {
  return `${fmtInt(n)} ${Number(n) === 1 ? "row" : "rows"}`;
}

function fmtPct(x) {
  return `${Math.round((x ?? 0) * 100)}%`;
}

function fmtMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function fmtDate(isoDate) {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function chip(text, tone = "neutral") {
  return `<span class="chip chip-${tone}">${escapeHtml(text)}</span>`;
}

function kindChip(kind) {
  return `<span class="kind kind-${escapeHtml(kind)}">${escapeHtml(KIND_LABEL[kind] ?? kind)}</span>`;
}

function bar(fraction, tone = "bar") {
  const pct = Math.max(0, Math.min(1, fraction ?? 0)) * 100;
  return `<span class="bar"><span class="bar-fill bar-${tone}" style="width:${pct.toFixed(1)}%"></span></span>`;
}

function css() {
  return `
:root {
  --bg: #f3f5f2; --surface: #ffffff; --surface-2: #e9ede9; --border: #d3dad5;
  --ink: #1b221d; --ink-2: #4f5a53; --ink-3: #7c877f;
  --accent: #8f6f2c; --accent-soft: #f1e8d3; --accent-ink: #ffffff;
  --good: #237a49; --good-bg: #e3f2e8; --warn: #8a5f00; --warn-bg: #fbf1d6;
  --bad: #b3372e; --bad-bg: #fbe3e0; --info: #2f5f9e; --info-bg: #e1ebf7;
  --bar: #9aa89f; --bar-good: #5aa878; --focus: #8f6f2c;
  --shadow: 0 1px 2px rgba(20, 30, 24, 0.06), 0 8px 24px -16px rgba(20, 30, 24, 0.25);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0f1412; --surface: #161c19; --surface-2: #1e2622; --border: #2a352e;
    --ink: #e6ebe7; --ink-2: #aab5ad; --ink-3: #7f8a83;
    --accent: #d1b06a; --accent-soft: #2b2617; --accent-ink: #1a1408;
    --good: #5fc385; --good-bg: #173425; --warn: #e6bd4e; --warn-bg: #3a2f12;
    --bad: #ef7a70; --bad-bg: #3d1c19; --info: #86b0e6; --info-bg: #16283d;
    --bar: #4a5750; --bar-good: #3f8f5f; --focus: #d1b06a;
    --shadow: 0 1px 2px rgba(0,0,0,0.4), 0 8px 24px -16px rgba(0,0,0,0.6);
  }
}
:root[data-theme="dark"] {
  --bg: #0f1412; --surface: #161c19; --surface-2: #1e2622; --border: #2a352e;
  --ink: #e6ebe7; --ink-2: #aab5ad; --ink-3: #7f8a83;
  --accent: #d1b06a; --accent-soft: #2b2617; --accent-ink: #1a1408;
  --good: #5fc385; --good-bg: #173425; --warn: #e6bd4e; --warn-bg: #3a2f12;
  --bad: #ef7a70; --bad-bg: #3d1c19; --info: #86b0e6; --info-bg: #16283d;
  --bar: #4a5750; --bar-good: #3f8f5f; --focus: #d1b06a;
  --shadow: 0 1px 2px rgba(0,0,0,0.4), 0 8px 24px -16px rgba(0,0,0,0.6);
}
* { box-sizing: border-box; }
html { color-scheme: light dark; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font-family: "Source Sans 3", "Source Sans Pro", "Segoe UI", system-ui, -apple-system, sans-serif;
  font-size: 15px; line-height: 1.45; -webkit-font-smoothing: antialiased;
}
.page { max-width: 1180px; margin: 0 auto; padding: 32px 20px 80px; display: grid; gap: 40px; }
h1, h2, h3 { font-family: "Fraunces", Georgia, "Times New Roman", serif; font-weight: 600; margin: 0; text-wrap: balance; letter-spacing: -0.01em; }
h1 { font-size: clamp(30px, 4vw, 42px); line-height: 1.05; font-variation-settings: "opsz" 144; }
h2 { font-size: 24px; line-height: 1.15; }
h3 { font-size: 17px; }
p { margin: 0; max-width: 70ch; }
a { color: var(--accent); }
.num, td.num, th.num, .tile-value, .bar-label { font-variant-numeric: tabular-nums; }
.muted { color: var(--ink-2); }
.faint { color: var(--ink-3); }
.small { font-size: 13px; }
.eyebrow { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-3); font-weight: 600; }

.masthead { display: grid; gap: 14px; padding-bottom: 20px; border-bottom: 2px solid var(--ink); }
.masthead-meta { display: flex; flex-wrap: wrap; gap: 8px 22px; color: var(--ink-2); font-size: 14px; }
.masthead-meta b { color: var(--ink); font-weight: 600; }
.notice { border-left: 3px solid var(--warn); background: var(--warn-bg); padding: 10px 14px; border-radius: 4px; color: var(--ink); }
.notice.info { border-left-color: var(--info); background: var(--info-bg); }

section { display: grid; gap: 16px; }
.section-head { display: grid; gap: 6px; }

.tabs { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 0; margin: -20px 0 -12px; background: var(--bg); border-bottom: 1px solid var(--border); }
.pagetab { display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--ink-2); border-radius: 999px; padding: 7px 14px; font-weight: 600; font-size: 14px; }
.pagetab:hover { color: var(--ink); border-color: var(--ink-3); }
.pagetab[aria-selected="true"] { background: var(--ink); color: var(--bg); border-color: var(--ink); }
.pagetab-count { font-size: 12px; font-weight: 600; padding: 1px 7px; border-radius: 999px; background: var(--surface-2); color: var(--ink-2); font-variant-numeric: tabular-nums; }
.pagetab[aria-selected="true"] .pagetab-count { background: color-mix(in srgb, var(--bg) 22%, transparent); color: var(--bg); }
.panel { display: grid; gap: 40px; }
.panel[hidden] { display: none; }
tr.group-row td { background: var(--surface-2); font-weight: 600; cursor: pointer; user-select: none; }
tr.group-row td .caret { display: inline-block; width: 1em; color: var(--ink-3); }
tr.group-row td .group-meta { font-weight: 400; color: var(--ink-2); margin-left: 10px; font-variant-numeric: tabular-nums; }
tr.group-row:focus-within td, tr.group-row td:hover { background: color-mix(in srgb, var(--surface-2) 70%, var(--surface)); }
.section-head p { color: var(--ink-2); }

.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
.tile { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 14px 16px 12px; display: grid; gap: 4px; box-shadow: var(--shadow); position: relative; }
.tile::before { content: ""; position: absolute; left: 0; top: 10px; bottom: 10px; width: 3px; border-radius: 2px; background: var(--ink-3); }
.tile.good::before { background: var(--good); } .tile.warn::before { background: var(--warn); } .tile.bad::before { background: var(--bad); } .tile.info::before { background: var(--info); }
.tile-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-3); font-weight: 600; }
.tile-value { font-family: "Fraunces", Georgia, serif; font-size: 30px; line-height: 1; font-weight: 500; font-variation-settings: "opsz" 72; }
.tile-sub { font-size: 13px; color: var(--ink-2); }

.scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); box-shadow: var(--shadow); }
.scroll.tall { max-height: 72vh; overflow-y: auto; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
th { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-3); font-weight: 600; background: var(--surface-2); position: sticky; top: 0; white-space: nowrap; }
tbody tr:last-child td { border-bottom: 0; }
tbody tr:hover td { background: color-mix(in srgb, var(--surface-2) 55%, transparent); }
td.num, th.num { text-align: right; white-space: nowrap; }
td.nowrap { white-space: nowrap; }
td.desc { color: var(--ink-2); max-width: 34ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
tr.behind td { background: color-mix(in srgb, var(--warn-bg) 60%, transparent); }
tfoot td { font-weight: 600; background: var(--surface-2); border-top: 2px solid var(--border); }

.chip { display: inline-block; font-size: 12px; line-height: 1; padding: 4px 8px; border-radius: 999px; font-weight: 600; white-space: nowrap; border: 1px solid transparent; }
.chip-neutral { background: var(--surface-2); color: var(--ink-2); border-color: var(--border); }
.chip-good { background: var(--good-bg); color: var(--good); }
.chip-warn { background: var(--warn-bg); color: var(--warn); }
.chip-bad { background: var(--bad-bg); color: var(--bad); }
.chip-info { background: var(--info-bg); color: var(--info); }
.chip-accent { background: var(--accent-soft); color: var(--accent); }
.kind { font-size: 12px; color: var(--ink-3); border: 1px solid var(--border); border-radius: 4px; padding: 1px 6px; white-space: nowrap; }
.kind-expense { color: var(--ink-2); }
.kind-review { color: var(--info); border-color: var(--info); }
.kind-liability, .kind-funding, .kind-transfer, .kind-capital { color: var(--warn); border-color: var(--warn); }
.kind-income { color: var(--good); border-color: var(--good); }

.bar { display: inline-block; width: 100px; height: 8px; background: var(--surface-2); border-radius: 4px; vertical-align: middle; overflow: hidden; margin-right: 8px; }
.bar-fill { display: block; height: 100%; border-radius: 4px; background: var(--bar); }
.bar-fill.bar-good { background: var(--bar-good); }
.bar-fill.bar-bad { background: var(--bad); }
.bar-label { font-size: 13px; }

.acct-list { display: grid; gap: 8px; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 14px 16px; box-shadow: var(--shadow); }
.acct-row { display: grid; grid-template-columns: minmax(180px, 1.2fr) 3fr auto; gap: 12px; align-items: center; font-size: 14px; }
.acct-row .bar { width: 100%; height: 12px; margin: 0; }
.acct-row .bar-fill { background: var(--bad); }
.acct-row.gbsl .bar-fill { background: var(--bar); }
.acct-name { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.acct-val { text-align: right; white-space: nowrap; }

details.pattern { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; box-shadow: var(--shadow); }
details.pattern + details.pattern { margin-top: 8px; }
details.pattern > summary { list-style: none; cursor: pointer; display: grid; grid-template-columns: 1fr auto auto; gap: 16px; align-items: center; padding: 12px 16px; }
details.pattern > summary::-webkit-details-marker { display: none; }
details.pattern > summary:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; border-radius: 6px; }
.pat-pair { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; }
.pat-from { font-weight: 600; }
.pat-arrow { color: var(--ink-3); }
.pat-to { font-weight: 600; color: var(--warn); }
.pat-meta { color: var(--ink-2); font-size: 13px; white-space: nowrap; }
.pat-body { border-top: 1px solid var(--border); padding: 6px 0 4px; }
.pat-body table { font-size: 13px; }
.pat-body th { position: static; }

.toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.toolbar label { font-size: 13px; color: var(--ink-2); display: inline-flex; gap: 6px; align-items: center; }
select, input[type="search"], button { font: inherit; font-size: 14px; color: var(--ink); background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; }
input[type="search"] { min-width: 220px; }
button { cursor: pointer; }
button:hover { border-color: var(--ink-3); }
button.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); font-weight: 600; }
button.tab { border-radius: 999px; padding: 6px 12px; }
button.tab[aria-selected="true"] { background: var(--ink); color: var(--bg); border-color: var(--ink); }
button.filter { border-radius: 999px; padding: 4px 10px; font-size: 13px; }
button.filter[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
:is(button, select, input, summary):focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.count { color: var(--ink-3); font-size: 13px; }
.copy-status { font-size: 13px; color: var(--good); min-width: 6ch; }
textarea.csv { width: 100%; min-height: 140px; font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--ink); background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 8px; }
.empty { padding: 18px 16px; color: var(--ink-3); background: var(--surface); border: 1px dashed var(--border); border-radius: 6px; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 13px; color: var(--ink-2); }
.foot { border-top: 1px solid var(--border); padding-top: 16px; color: var(--ink-3); font-size: 13px; display: grid; gap: 6px; }
@media (max-width: 720px) {
  .acct-row { grid-template-columns: 1fr; gap: 4px; }
  .acct-val { text-align: left; }
  details.pattern > summary { grid-template-columns: 1fr; gap: 6px; }
  .tile-value { font-size: 26px; }
}
@media (prefers-reduced-motion: no-preference) {
  .bar-fill { transition: width 300ms ease-out; }
}
@media print {
  body { background: #fff; color: #000; }
  .toolbar, .drill, .tabs { display: none !important; }
  .panel[hidden] { display: grid !important; }
  .scroll, .scroll.tall { overflow: visible; max-height: none; box-shadow: none; }
}
`;
}

function renderMasthead(r) {
  const m = r.meta;
  // Loans and payables are balance-sheet accounts, never a card Hundie would import; only warn
  // about something that looks like a bank or card section we do not know.
  const unknownCards = (m.unmappedQboSections ?? []).filter((s) => !/loan|mortgage|payable/i.test(s));
  const unmapped = unknownCards.length
    ? `<div class="notice">QBO sections ignored because they are not mapped to a Hundie account: <b>${escapeHtml(unknownCards.join(", "))}</b>. If one of these is a card you use for GBSL, add it to the account map.</div>`
    : "";
  const basisNote = m.basis && m.basis !== "Cash"
    ? `<div class="notice info">This export is on <b>${escapeHtml(m.basis)}</b> basis. GBSL files on cash basis; the difference is small for card and bank rows but re-export on Cash next time so the two ledgers use the same clock.</div>`
    : "";
  return `
<header class="masthead">
  <div class="eyebrow">Hundie ↔ QuickBooks Online · ${escapeHtml(m.company ?? "GBSL, LLC")}</div>
  <h1>GBSL Books Drift</h1>
  <p class="muted">Every GBSL row Alex classified in Hundie, paired one-to-one with the accountant's QuickBooks entries. Same amount, dates within ${escapeHtml(String(m.dateSlack))} days, vendor words as the tie-break. Each row lands in exactly one bucket, so the totals below reconcile.</p>
  <div class="masthead-meta">
    <span>Period <b>${escapeHtml(fmtDate(m.from))} – ${escapeHtml(fmtDate(m.to))}</b></span>
    <span>QBO file <b>${escapeHtml(m.qboFile ?? "export")}</b>${m.basis ? ` (${escapeHtml(m.basis)} basis)` : ""}</span>
    <span>Generated <b>${escapeHtml(new Date(m.generatedAt ?? Date.now()).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }))}</b></span>
  </div>
  ${unmapped}${basisNote}
</header>`;
}

function renderTiles(r) {
  const t = r.totals;
  const b = t.buckets;
  const ba = t.bucketAmounts;
  const drift = b.differ + b.kindDiffer + (b.notGbsl ?? 0);
  const re = t.bucketRowsExpense ?? { onlyHundieReachable: 0, onlyQbo: 0 };
  const ex = t.expense ?? { hundieRows: 0, hundieAmount: 0, reachableRows: 0, qboRows: 0, qboAmount: 0, pairedRows: 0, pairedAmount: 0, agreeRows: 0, coverage: 0, agreeRate: 0, differAbs: 0, kindDifferAbs: 0, notGbslAbs: 0 };
  return `
<section aria-label="Verdict">
  <div class="tiles">
    <div class="tile"><div class="tile-label">Rows compared</div><div class="tile-value">${fmtInt(t.hundie.inScope)} <span class="faint">↔</span> ${fmtInt(t.qbo.inScope)}</div><div class="tile-sub">Expense rows: Hundie ${fmtInt(ex.hundieRows)} · ${escapeHtml(fmtMoney(ex.hundieAmount))}, QBO ${fmtInt(ex.qboRows)} · ${escapeHtml(fmtMoney(ex.qboAmount))}</div></div>
    <div class="tile info"><div class="tile-label">Paired</div><div class="tile-value">${fmtPct(ex.coverage)}</div><div class="tile-sub">${fmtInt(ex.pairedRows)} of ${fmtInt(ex.reachableRows)} expense rows QBO can see · ${escapeHtml(fmtMoney(ex.pairedAmount))}</div></div>
    <div class="tile good"><div class="tile-label">Agree</div><div class="tile-value">${fmtPct(ex.agreeRate)}</div><div class="tile-sub">${fmtInt(ex.agreeRows)} of ${fmtInt(ex.pairedRows)} paired expense rows</div></div>
    <div class="tile warn"><div class="tile-label">Drift</div><div class="tile-value">${fmtInt(drift)}</div><div class="tile-sub">${fmtInt(b.differ)} named differently · ${fmtInt(b.kindDiffer)} treated differently · ${fmtInt(b.notGbsl ?? 0)} not GBSL in Hundie · ${escapeHtml(fmtMoney(ex.differAbs + ex.kindDifferAbs + ex.notGbslAbs, { sign: false }))} in play</div></div>
    <div class="tile bad"><div class="tile-label">Invisible to QBO</div><div class="tile-value">${escapeHtml(fmtMoney(t.hundie.unreachableAmount, { sign: false }))}</div><div class="tile-sub">${fmtInt(t.hundie.unreachableRows)} GBSL rows on cards QBO does not have</div></div>
    <div class="tile bad"><div class="tile-label">Not booked yet</div><div class="tile-value">${escapeHtml(fmtMoney(ba.onlyHundieReachableExpense, { sign: false }))}</div><div class="tile-sub">${fmtInt(re.onlyHundieReachable)} expense rows on QBO accounts with no QBO entry</div></div>
    <div class="tile bad"><div class="tile-label">Only in QBO</div><div class="tile-value">${escapeHtml(fmtMoney(ba.onlyQboExpense, { sign: false }))}</div><div class="tile-sub">${fmtInt(re.onlyQbo)} expense rows Hundie is missing</div></div>
    <div class="tile info"><div class="tile-label">Questions</div><div class="tile-value">${fmtInt(b.qboAsks + b.hundieReview)}</div><div class="tile-sub">${fmtInt(b.qboAsks)} QBO asks you · ${fmtInt(b.hundieReview)} still open in Hundie</div></div>
  </div>
</section>`;
}

function renderMonths(r) {
  const rows = r.months
    .map((m) => {
      const toSettle = m.differ + m.otherDrift + m.onlyHundieRows + m.onlyQboRows;
      const status = m.reachableRows === 0
        ? chip("no Hundie rows", "neutral")
        : m.qboBehind
          ? chip("QBO behind", "warn")
          : toSettle === 0
            ? chip("clean", "good")
            : chip(`${fmtInt(toSettle)} to settle`, "info");
      return `<tr class="${m.qboBehind ? "behind" : ""}">
  <td class="nowrap"><b>${escapeHtml(fmtMonth(m.month))}</b></td>
  <td class="num">${fmtInt(m.reachableRows)}<br><span class="faint small">${escapeHtml(fmtMoney(m.reachableAmount))}</span></td>
  <td class="num">${fmtInt(m.qboRows)}<br><span class="faint small">${escapeHtml(fmtMoney(m.qboAmount))}</span></td>
  <td class="nowrap">${bar(m.coverage)}<span class="bar-label">${fmtInt(m.matched)} · ${fmtPct(m.coverage)}</span></td>
  <td class="nowrap">${bar(m.agreeRate, "good")}<span class="bar-label">${fmtInt(m.agree)} · ${fmtPct(m.agreeRate)}</span></td>
  <td class="num">${fmtInt(m.differ + m.otherDrift)}</td>
  <td class="num">${fmtInt(m.onlyHundieRows)}<br><span class="faint small">${escapeHtml(fmtMoney(m.onlyHundieAmount))}</span></td>
  <td class="num">${fmtInt(m.onlyQboRows)}<br><span class="faint small">${escapeHtml(fmtMoney(m.onlyQboAmount))}</span></td>
  <td class="num">${fmtInt(m.unreachableRows)}<br><span class="faint small">${escapeHtml(fmtMoney(m.unreachableAmount))}</span></td>
  <td>${status}</td>
</tr>`;
    })
    .join("");
  return `
<section>
  <div class="section-head">
    <h2>Month by month</h2>
    <p>Expense rows only. Hundie counts the rows on accounts QuickBooks has; spend on other cards sits in its own column because it can never pair. Coverage is the share of those rows that found a QBO twin: a month under 50% means the accountant has not caught up yet, not that you disagree. Agree is measured on the paired rows.</p>
  </div>
  <div class="scroll"><table>
    <thead><tr><th>Month</th><th class="num">Hundie</th><th class="num">QBO</th><th>Paired · coverage</th><th>Agree</th><th class="num">Drift</th><th class="num">Not booked yet</th><th class="num">Only QBO</th><th class="num">Other cards</th><th>Status</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
</section>`;
}

function renderAccounts(r) {
  const list = r.onlyHundieByAccount;
  if (!list.length) return "";
  const max = Math.max(...list.map((a) => Math.abs(a.amount)), 1);
  const personal = list.filter((a) => !a.inQbo);
  const personalTotal = personal.reduce((s, a) => s + a.amount, 0);
  const rows = list
    .map(
      (a) => `<div class="acct-row ${a.inQbo ? "gbsl" : "personal"}">
  <div class="acct-name"><span>${escapeHtml(a.accountName)}</span>${a.inQbo ? "" : chip("not in QBO", "bad")}</div>
  <div>${bar(Math.abs(a.amount) / max)}</div>
  <div class="acct-val num"><b>${escapeHtml(fmtMoney(a.amount))}</b> <span class="faint">· ${rowsLabel(a.rows)}</span></div>
</div>`,
    )
    .join("");
  const headline = personal.length
    ? `<p><b>${escapeHtml(fmtMoney(personalTotal))}</b> of GBSL spend sits on ${personal.length === 1 ? "a card" : `${personal.length} accounts`} QuickBooks never sees. Nothing on these cards reaches the P&amp;L until it is booked as an owner contribution or reimbursed. This is the first item for the accountant. Rows on QBO accounts (no chip) are simply not booked yet.</p>`
    : `<p>Every account carrying GBSL spend is connected to QuickBooks. Rows below are simply not booked yet.</p>`;
  return `
<section>
  <div class="section-head">
    <h2>Spend QuickBooks cannot see</h2>
    ${headline}
  </div>
  <div class="acct-list">${rows}</div>
</section>`;
}

function renderOnlyTable(patterns, { emptyText, accountHeader }) {
  if (!patterns.length) return `<div class="empty">${escapeHtml(emptyText)}</div>`;
  const shown = patterns.slice(0, 60);
  const rows = shown
    .map(
      (p) => `<tr>
  <td>${escapeHtml(p.vendor || "(no vendor)")}</td>
  <td>${p.category ? escapeHtml(p.category) : chip("unclassified", "info")}${p.kind !== "expense" ? ` ${kindChip(p.kind)}` : ""}</td>
  <td class="nowrap small muted">${escapeHtml(p.accounts.join(", "))}</td>
  <td class="num">${fmtInt(p.rows)}</td>
  <td class="num">${escapeHtml(fmtMoney(p.amount))}</td>
  <td class="small muted">${escapeHtml(p.months.map((m) => fmtMonth(m).slice(0, 3)).join(" · "))}</td>
</tr>`,
    )
    .join("");
  const more = patterns.length - shown.length;
  return `<div class="scroll"><table>
  <thead><tr><th>Vendor</th><th>Category</th><th>${escapeHtml(accountHeader)}</th><th class="num">Rows</th><th class="num">Amount</th><th>Months</th></tr></thead>
  <tbody>${rows}${more > 0 ? `<tr><td colspan="6" class="faint">and ${fmtInt(more)} more vendor lines in the row-by-row table below</td></tr>` : ""}</tbody>
</table></div>`;
}

// Transfers, funding and income are paired and counted but are not spend; they live in the
// row-by-row table. The two "only" lists are about money the P&L should carry.
const spendLike = (p) => !["transfer", "funding", "income"].includes(p.kind);
const sumPatterns = (list) => list.reduce((s, p) => s + p.amount, 0);
const countPatterns = (list) => list.reduce((s, p) => s + p.rows, 0);

function onlyLegend(list, tileAmount) {
  const expense = list.filter((p) => p.kind === "expense");
  const other = list.filter((p) => p.kind !== "expense");
  const otherNote = other.length
    ? `<span class="faint">plus ${rowsLabel(countPatterns(other))} of ${[...new Set(other.map((p) => p.kind))].join(" / ")} (${escapeHtml(fmtMoney(sumPatterns(other)))}) listed below</span>`
    : "";
  return `<div class="legend"><span>${rowsLabel(countPatterns(expense))} · ${escapeHtml(fmtMoney(tileAmount ?? sumPatterns(expense)))} of expense</span>${otherNote}</div>`;
}

function renderNotBookedYet(r) {
  const oh = r.onlyHundiePatterns.filter(spendLike);
  const skipped = r.onlyHundiePatterns.length - oh.length;
  return `
<section>
  <div class="section-head">
    <h2>In Hundie, not booked in QuickBooks yet</h2>
    <p>Rows on accounts QuickBooks does have, with no QBO entry. Recent months are the accountant's backlog. Older months are worth a question: a recurring vendor here means the bank feed line was never added to the register.</p>
  </div>
  ${onlyLegend(oh, r.totals.bucketAmounts.onlyHundieReachableExpense)}${skipped ? `<div class="legend"><span class="faint">${fmtInt(skipped)} transfer / funding / income lines left to Row by Row</span></div>` : ""}
  ${renderOnlyTable(oh, { emptyText: "Everything Hundie has on QBO accounts is booked in QuickBooks.", accountHeader: "Hundie account" })}
</section>`;
}

function renderMissingFromHundie(r) {
  const oq = r.onlyQboPatterns.filter(spendLike);
  const skipped = r.onlyQboPatterns.length - oq.length;
  return `
<section>
  <div class="section-head">
    <h2>In QuickBooks, missing from Hundie</h2>
    <p>QBO entries with no Hundie row on any entity. A vendor that repeats every month here is an import gap in Hundie, not an accounting question: the accountant sees the bank line and Hundie never did. Rows Hundie filed to another entity are not here; they sit under ME != GCD. Card payments and transfers are left out on purpose; Hundie does not import the card side of those.</p>
  </div>
  ${onlyLegend(oq, r.totals.bucketAmounts.onlyQboExpense)}${skipped ? `<div class="legend"><span class="faint">${fmtInt(skipped)} transfer / funding / income lines left to Row by Row</span></div>` : ""}
  ${renderOnlyTable(oq, { emptyText: "Every QBO entry has a Hundie row.", accountHeader: "QBO account" })}
</section>`;
}

const TABS = [
  ["summary", "Summary"],
  ["onlyQbo", "In QBO, not Hundie"],
  ["disagree", "ME != GCD"],
  ["asks", "QBO Asks"],
  ["chart", "Accounts Audit"],
  ["rows", "Row by Row"],
];

function renderTabBar(r) {
  const b = r.totals.buckets;
  const counts = {
    onlyQbo: countPatterns(r.onlyQboPatterns.filter(spendLike)),
    disagree: b.differ + b.kindDiffer + (b.notGbsl ?? 0),
    asks: b.qboAsks + b.hundieReview,
    chart: r.chart.filter((c) => c.flags.length).length,
    rows: b.differ + b.kindDiffer + (b.notGbsl ?? 0) + b.onlyHundie + b.onlyQbo,
  };
  const buttons = TABS.map(
    ([key, label], i) =>
      `<button type="button" class="pagetab" role="tab" id="tab-${key}" aria-controls="panel-${key}" data-panel="${key}" aria-selected="${i === 0 ? "true" : "false"}">${escapeHtml(label)}${counts[key] != null ? `<span class="pagetab-count">${fmtInt(counts[key])}</span>` : ""}</button>`,
  ).join("");
  return `<nav class="tabs" role="tablist" aria-label="Report sections">${buttons}</nav>`;
}

function renderPanel(key, inner, { first = false } = {}) {
  return `<div class="panel" id="panel-${key}" role="tabpanel" aria-labelledby="tab-${key}"${first ? "" : " hidden"}>${inner}</div>`;
}

function renderPatternList(patterns, { emptyText }) {
  if (!patterns.length) return `<div class="empty">${escapeHtml(emptyText)}</div>`;
  return patterns
    .map((p) => {
      const vendors = p.vendors.slice(0, 12);
      const more = p.vendors.length - vendors.length;
      const vrows = vendors
        .map((v) => `<tr><td>${escapeHtml(v.vendor)}</td><td class="num">${fmtInt(v.rows)}</td><td class="num">${escapeHtml(fmtMoney(v.amount))}</td></tr>`)
        .join("");
      return `<details class="pattern">
  <summary>
    <span class="pat-pair"><span class="pat-from">${escapeHtml(p.hundieCategory ?? "(unclassified)")}</span>${p.hundieKind !== p.qboKind ? kindChip(p.hundieKind) : ""}<span class="pat-arrow">→</span><span class="pat-to">${escapeHtml(p.qboCategory ?? "(none)")}</span>${p.hundieKind !== p.qboKind ? kindChip(p.qboKind) : ""}${p.refinement ? chip("sub-account of the other", "neutral") : ""}</span>
    <span class="pat-meta">${rowsLabel(p.rows)}</span>
    <span class="pat-meta num"><b>${escapeHtml(fmtMoney(p.amount))}</b></span>
  </summary>
  <div class="pat-body"><table><thead><tr><th>Vendor</th><th class="num">Rows</th><th class="num">Amount</th></tr></thead><tbody>${vrows}${more > 0 ? `<tr><td colspan="3" class="faint">and ${more} more vendors</td></tr>` : ""}</tbody></table></div>
</details>`;
    })
    .join("");
}

function renderPatterns(r) {
  const ex = r.totals.expense ?? { differAbs: 0, kindDifferAbs: 0 };
  const expenseDiffer = r.rows.differ.filter((p) => p.hundieKind === "expense").length;
  const otherDiffer = r.totals.buckets.differ - expenseDiffer;
  return `
<section>
  <div class="section-head">
    <h2>Where you and the accountant disagree</h2>
    <p>Paired rows where both sides call it an expense but name it differently. Your category on the left, QuickBooks on the right. Decide each line as a policy, then the rows follow. Open a line to see which vendors drive it.</p>
  </div>
  <div class="legend"><span>${rowsLabel(expenseDiffer)} · ${escapeHtml(fmtMoney(ex.differAbs, { sign: false }))} in play</span>${otherDiffer ? `<span class="faint">${rowsLabel(otherDiffer)} of funding / income naming listed last</span>` : ""}</div>
  <div>${renderPatternList(r.patterns, { emptyText: "No category disagreements in this period." })}</div>
</section>
<section>
  <div class="section-head">
    <h2>Different treatment, not just a different name</h2>
    <p>Paired rows where one side books it as an expense and the other as a loan payment, refund, transfer, or income. These change the P&amp;L, so they matter more than a label.</p>
  </div>
  <div class="legend"><span>${rowsLabel(r.totals.buckets.kindDiffer)} · ${escapeHtml(fmtMoney(ex.kindDifferAbs, { sign: false }))} in play</span></div>
  <div>${renderPatternList(r.kindPatterns, { emptyText: "No treatment mismatches in this period." })}</div>
</section>
<section>
  <div class="section-head">
    <h2>Booked to GBSL in QuickBooks, filed elsewhere in Hundie</h2>
    <p>Rows on the GBSL bank and cards that you filed to another entity (Personal, Keller, a rental) or have not assigned yet, which the accountant expensed to GBSL anyway. Each one is either a personal charge sitting in the business P&amp;L or a GBSL charge you filed wrong. Your side on the left, with the entity.</p>
  </div>
  <div class="legend"><span>${rowsLabel(r.totals.buckets.notGbsl ?? 0)} · ${escapeHtml(fmtMoney(ex.notGbslAbs, { sign: false }))} in play</span></div>
  <div>${renderPatternList(r.notGbslPatterns ?? [], { emptyText: "Everything QBO booked to GBSL, Hundie also calls GBSL." })}</div>
</section>`;
}

function renderQuestionTable(rows, { hundieHeader, qboHeader, id, emptyText }) {
  if (!rows.length) return `<div class="empty">${escapeHtml(emptyText)}</div>`;
  const body = rows
    .map(
      (p) => `<tr>
  <td class="nowrap">${escapeHtml(fmtDate(p.date))}</td>
  <td class="num">${escapeHtml(fmtMoney(p.amount))}</td>
  <td>${escapeHtml(p.qboName || p.vendor)}<br><span class="faint small">${escapeHtml((p.qboDescription || p.description || "").slice(0, 60))}</span></td>
  <td class="nowrap">${escapeHtml(p.accountName)}</td>
  <td>${p.hundieCategory ? escapeHtml(p.hundieCategory) : chip("unclassified", "info")}</td>
  <td>${escapeHtml(p.qboCategory ?? "")}</td>
</tr>`,
    )
    .join("");
  return `<div class="toolbar"><button type="button" class="copy-btn" data-copy="${id}">Copy as CSV</button><span class="copy-status" aria-live="polite"></span></div>
<div class="scroll"><table id="${id}">
  <thead><tr><th>Date</th><th class="num">Amount</th><th>Payee</th><th>Account</th><th>${escapeHtml(hundieHeader)}</th><th>${escapeHtml(qboHeader)}</th></tr></thead>
  <tbody>${body}</tbody>
</table></div>`;
}

function renderQuestions(r) {
  return `
<section>
  <div class="section-head">
    <h2>QuickBooks is asking you</h2>
    <p>Rows the accountant parked in <i>Ask My Accountant</i>. Your Hundie category is the proposed answer. Copy the table and send it back.</p>
  </div>
  ${renderQuestionTable(r.qboAsks, { hundieHeader: "Your answer (Hundie)", qboHeader: "QBO today", id: "qbo-asks", emptyText: "Nothing parked in Ask My Accountant for this period." })}
</section>
<section>
  <div class="section-head">
    <h2>Still open in Hundie</h2>
    <p>Rows you have not classified yet, or left in Ask My Accountant, where QuickBooks already has an answer. Easy wins: accept theirs unless you know better.</p>
  </div>
  ${renderQuestionTable(r.hundieReview, { hundieHeader: "Hundie today", qboHeader: "QBO's answer", id: "hundie-review", emptyText: "Everything Hundie has for this period is classified." })}
</section>`;
}

function renderChart(r) {
  const rows = r.chart
    .map((c) => {
      const flags = c.flags
        .map((f) => {
          if (f === "kindMismatch") return chip(`Hundie ${KIND_LABEL[c.kind] ?? c.kind} · QBO ${KIND_LABEL[c.qboKind] ?? c.qboKind}`, "warn");
          return chip(FLAG_LABEL[f] ?? f, f === "unusedBoth" ? "bad" : f === "qboOnly" ? "warn" : f === "hundieOnly" ? "info" : "neutral");
        })
        .join(" ");
      const label = c.hundiePath && c.qboPath && c.hundiePath !== c.qboPath ? `${escapeHtml(c.hundiePath)} <span class="faint">/ QBO: ${escapeHtml(c.qboPath)}</span>` : escapeHtml(c.path);
      const inactive = c.isActive === false ? ` ${chip("inactive", "neutral")}` : "";
      return `<tr data-flags="${escapeHtml(c.flags.join(" "))}">
  <td>${label}${inactive}</td>
  <td>${kindChip(c.kind ?? "expense")}</td>
  <td class="num">${c.inHundieChart || c.hundieRows ? `${fmtInt(c.hundieRows)}<br><span class="faint small">${escapeHtml(fmtMoney(c.hundieAmount))}</span>` : `<span class="faint">—</span>`}</td>
  <td class="num">${c.inQbo ? `${fmtInt(c.qboRows)}<br><span class="faint small">${escapeHtml(fmtMoney(c.qboAmount))}</span>` : `<span class="faint">—</span>`}</td>
  <td>${flags}</td>
</tr>`;
    })
    .join("");
  const counts = {
    unusedBoth: r.chart.filter((c) => c.flags.includes("unusedBoth")).length,
    hundieOnly: r.chart.filter((c) => c.flags.includes("hundieOnly")).length,
    qboOnly: r.chart.filter((c) => c.flags.includes("qboOnly")).length,
    nameVariant: r.chart.filter((c) => c.flags.includes("nameVariant")).length,
    kindMismatch: r.chart.filter((c) => c.flags.includes("kindMismatch")).length,
  };
  return `
<section>
  <div class="section-head">
    <h2>Chart of accounts audit</h2>
    <p>Every GBSL category in Hundie's chart plus every category QuickBooks used this period. Unused on both sides means zero rows in this period on either ledger: your retirement list, with the structural ones (transfers, intercompany, capital) kept for their kind, not their volume.</p>
  </div>
  <div class="toolbar" role="group" aria-label="Chart filters">
    <button type="button" class="filter" data-chart-filter="" aria-pressed="true">All (${fmtInt(r.chart.length)})</button>
    <button type="button" class="filter" data-chart-filter="unusedBoth" aria-pressed="false">Unused on both sides (${fmtInt(counts.unusedBoth)})</button>
    <button type="button" class="filter" data-chart-filter="hundieOnly" aria-pressed="false">Hundie only (${fmtInt(counts.hundieOnly)})</button>
    <button type="button" class="filter" data-chart-filter="qboOnly" aria-pressed="false">QBO only (${fmtInt(counts.qboOnly)})</button>
    <button type="button" class="filter" data-chart-filter="nameVariant" aria-pressed="false">Name variants (${fmtInt(counts.nameVariant)})</button>
    <button type="button" class="filter" data-chart-filter="kindMismatch" aria-pressed="false">Treated differently (${fmtInt(counts.kindMismatch)})</button>
  </div>
  <div class="scroll tall"><table id="chart-table">
    <thead><tr><th>Category</th><th>Kind</th><th class="num">Hundie</th><th class="num">QBO</th><th>Flags</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
</section>`;
}

function renderDrill(r) {
  const b = r.totals.buckets;
  const tabs = [
    ["differ", `Differ (${fmtInt(b.differ)})`],
    ["onlyHundie", `Only in Hundie (${fmtInt(b.onlyHundie)})`],
    ["onlyQbo", `Only in QBO (${fmtInt(b.onlyQbo)})`],
    ["kindDiffer", `Kind differs (${fmtInt(b.kindDiffer)})`],
    ["notGbsl", `Not GBSL (${fmtInt(b.notGbsl ?? 0)})`],
    ["agree", `Agree (${fmtInt(b.agree)})`],
  ]
    .map(([key, label], i) => `<button type="button" class="tab" role="tab" data-tab="${key}" aria-selected="${i === 0 ? "true" : "false"}">${escapeHtml(label)}</button>`)
    .join("");
  return `
<section class="drill">
  <div class="section-head">
    <h2>Row by row</h2>
    <p>Every row behind the numbers above. Filter by month, account, or text, then copy the current view as CSV for the accountant.</p>
  </div>
  <div class="toolbar" role="tablist" aria-label="Buckets">${tabs}</div>
  <div class="toolbar">
    <label>Month <select id="f-month"><option value="">All</option></select></label>
    <label>Account <select id="f-account"><option value="">All</option></select></label>
    <label>Kind <select id="f-kind"><option value="">All</option><option value="expense" selected>expense</option><option value="income">income</option><option value="transfer">transfer</option><option value="funding">funding</option><option value="liability">liability</option><option value="review">review</option></select></label>
    <input type="search" id="f-text" placeholder="vendor, description, category" aria-label="Search rows">
    <label>Group by <select id="f-group"><option value="">None</option><option value="vendor">Vendor</option><option value="hundieCategory">Hundie category</option><option value="qboCategory">QBO category</option><option value="pair">Hundie → QBO category</option><option value="account">Account</option><option value="month">Month</option></select></label>
    <button type="button" id="drill-copy">Copy as CSV</button>
    <span class="copy-status" id="drill-copy-status" aria-live="polite"></span>
    <span class="count" id="drill-count"></span>
  </div>
  <div class="scroll tall"><table id="drill-table"><thead></thead><tbody></tbody></table></div>
  <div class="toolbar"><button type="button" id="drill-more" hidden>Show more</button></div>
</section>`;
}

function renderFoot(r) {
  const d = r.meta.dropped ?? {};
  const other = Object.entries(d.otherType ?? {}).map(([k, v]) => `${k} ${v}`).join(", ");
  const map = (r.meta.accountMap ?? []).map((a) => `${a.section} → ${a.name}`).join(" · ");
  return `
<footer class="foot">
  <div>Reconciliation: ${fmtInt(r.totals.pairedClaims ?? r.totals.paired)} paired + ${fmtInt(r.totals.buckets.onlyHundie)} only-Hundie = ${fmtInt(r.totals.hundie.inScope)} Hundie GBSL rows; ${fmtInt(r.totals.paired)} paired + ${fmtInt(r.totals.buckets.onlyQbo)} only-QBO = ${fmtInt(r.totals.qbo.inScope)} QBO rows. Matched dollars agree on both sides (${escapeHtml(fmtMoney(r.totals.matchedAmount))}). ${fmtInt(r.totals.accountMismatchPairs)} pairs crossed accounts; ${fmtInt(r.totals.compositePairs ?? 0)} pairs matched a split on one side to a whole on the other. ${fmtInt(r.meta.contextRows ?? 0)} Hundie rows filed to other entities on QBO accounts were offered for pairing (${fmtInt(r.meta.contextUnpaired ?? 0)} unpaired, not counted).</div>
  <div>How QBO rows were read: only the bank and card sections in the account map; a movement between two of those accounts is kept once, on the bank side, as a transfer (${fmtInt(d.ownTransferMirror?.rows ?? 0)} mirror copies dropped); a blank Split is a multi-line entry and its lines were recovered from the category sections (${fmtInt(d.unresolvedSplits ?? 0)} could not be)${other ? `; other QBO types skipped (${escapeHtml(other)})` : ""}. Transfers pair with Hundie's credit-card payments and count as agree. Income and funding rows are paired and counted but not scored as drift. ${fmtInt(r.meta.hundieSplitLegs ?? 0)} Hundie split legs included at leg amount.</div>
  <div>Account map: ${escapeHtml(map)}.</div>
  <div>Read-only: nothing here writes to Hundie or QuickBooks. Regenerate with <code>npm run report:qb-drift -- --file &lt;export.csv&gt;</code>.</div>
</footer>`;
}

function clientScript() {
  return `
(function () {
  var dataEl = document.getElementById("drift-data");
  if (!dataEl) return;
  var R = JSON.parse(dataEl.textContent);
  var rows = R.rows;
  var PAGE = 300;
  var state = { tab: "differ", month: "", account: "", kind: "expense", text: "", group: "", shown: PAGE };
  var collapsed = {};

  // Page tabs: one panel visible at a time; the choice lives in the URL hash so a link can open a tab.
  var tabButtons = document.querySelectorAll("button.pagetab");
  function activatePanel(key, opts) {
    var known = false;
    tabButtons.forEach(function (b) { if (b.getAttribute("data-panel") === key) known = true; });
    if (!known) key = "summary";
    tabButtons.forEach(function (b) { b.setAttribute("aria-selected", b.getAttribute("data-panel") === key ? "true" : "false"); });
    document.querySelectorAll(".panel").forEach(function (p) { p.hidden = p.id !== "panel-" + key; });
    if (!(opts && opts.silent)) {
      try { history.replaceState(null, "", "#tab=" + key); } catch (e) {}
      try { localStorage.setItem("gbsl-drift-tab", key); } catch (e) {}
    }
  }
  tabButtons.forEach(function (b) {
    b.addEventListener("click", function () { activatePanel(b.getAttribute("data-panel")); window.scrollTo({ top: 0 }); });
  });
  (function () {
    var fromHash = (location.hash.match(/tab=([a-zA-Z]+)/) || [])[1];
    var stored = null;
    try { stored = localStorage.getItem("gbsl-drift-tab"); } catch (e) {}
    activatePanel(fromHash || stored || "summary", { silent: !fromHash });
  })();
  window.addEventListener("hashchange", function () {
    var key = (location.hash.match(/tab=([a-zA-Z]+)/) || [])[1];
    if (key) activatePanel(key, { silent: true });
  });

  function money(n) {
    var v = Number(n || 0);
    var abs = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (v < 0 ? "-$" : "$") + abs;
  }
  function fmtDate(iso) {
    if (!iso) return "";
    var p = iso.split("-").map(Number);
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  function fmtMonth(ym) {
    var p = ym.split("-").map(Number);
    return new Date(p[0], p[1] - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function isPair(tab) { return tab === "differ" || tab === "kindDiffer" || tab === "agree" || tab === "notGbsl"; }
  function kindOf(row, tab) { return isPair(tab) ? row.hundieKind : row.kind; }

  function current() {
    var list = rows[state.tab] || [];
    var q = state.text.trim().toLowerCase();
    return list.filter(function (r) {
      if (state.month && r.month !== state.month) return false;
      if (state.account && r.accountSlug !== state.account) return false;
      if (state.kind && kindOf(r, state.tab) !== state.kind) return false;
      if (q) {
        var hay = [r.vendor, r.description, r.qboName, r.qboDescription, r.category, r.hundieCategory, r.qboCategory, r.accountName].join(" ").toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    }).sort(function (a, b) { return b.date.localeCompare(a.date) || Math.abs(b.amount) - Math.abs(a.amount); });
  }

  function columns(tab) {
    if (isPair(tab)) {
      return [
        { h: "Date", f: function (r) { return fmtDate(r.date) + (r.dayDiff ? " (QBO " + fmtDate(r.qboDate) + ")" : ""); }, c: "nowrap" },
        { h: "Amount", f: function (r) { return money(r.amount); }, c: "num" },
        { h: "Vendor", f: function (r) { return r.vendor; } },
        { h: "Description", f: function (r) { return r.description; }, c: "desc" },
        { h: "Account", f: function (r) { return r.accountName + (r.accountMismatch ? " ⇄ " + r.qboSection : ""); }, c: "nowrap" },
        { h: "Hundie", f: function (r) { return (r.entitySlug && r.entitySlug !== "gbsl" ? r.entitySlug + " · " : "") + (r.hundieCategory || "(unclassified)"); } },
        { h: "QBO", f: function (r) { return r.qboCategory || ""; } },
        { h: "Confidence", f: function (r) { return r.confidence + (r.isSplitLeg ? " · split leg" : "") + (r.whole ? (r.whole.side === "hundieSplit" ? " · QBO booked the whole " + money(r.whole.amount) : " · QBO split the " + money(r.whole.amount)) : ""); }, c: "nowrap small" }
      ];
    }
    return [
      { h: "Date", f: function (r) { return fmtDate(r.date); }, c: "nowrap" },
      { h: "Amount", f: function (r) { return money(r.amount); }, c: "num" },
      { h: "Vendor", f: function (r) { return r.vendor; } },
      { h: "Description", f: function (r) { return r.description; }, c: "desc" },
      { h: tab === "onlyQbo" ? "QBO account" : "Account", f: function (r) { return r.accountName; }, c: "nowrap" },
      { h: "Category", f: function (r) { return r.category || "(unclassified)"; } },
      { h: "Kind", f: function (r) { return r.kind + (r.isSplitLeg ? " · split leg" : ""); }, c: "nowrap small" }
    ];
  }

  function groupKeyOf(r, tab) {
    var g = state.group;
    if (!g) return null;
    if (g === "month") return fmtMonth(r.month);
    if (g === "account") return r.accountName || "(no account)";
    if (g === "vendor") return r.vendor || "(no vendor)";
    if (isPair(tab)) {
      if (g === "hundieCategory") return r.hundieCategory || "(unclassified)";
      if (g === "qboCategory") return r.qboCategory || "(none)";
      if (g === "pair") return (r.hundieCategory || "(unclassified)") + " → " + (r.qboCategory || "(none)");
    }
    return r.category || "(unclassified)";
  }

  function makeRow(r, cols) {
    var row = el("tr");
    cols.forEach(function (c) { var td = el("td", c.c || "", c.f(r)); if (c.c === "desc") td.title = c.f(r); row.appendChild(td); });
    return row;
  }

  function render() {
    var list = current();
    var cols = columns(state.tab);
    var table = document.getElementById("drill-table");
    var thead = table.querySelector("thead");
    var tbody = table.querySelector("tbody");
    thead.innerHTML = "";
    tbody.innerHTML = "";
    var tr = el("tr");
    cols.forEach(function (c) { var th = el("th", c.c && c.c.indexOf("num") !== -1 ? "num" : "", c.h); tr.appendChild(th); });
    thead.appendChild(tr);
    var frag = document.createDocumentFragment();
    var shownCount = list.length;

    if (state.group) {
      // Grouped view: one header row per group (click to collapse), largest groups first, no paging.
      var groups = {};
      var order = [];
      list.forEach(function (r) {
        var k = groupKeyOf(r, state.tab);
        if (!groups[k]) { groups[k] = { rows: [], sum: 0 }; order.push(k); }
        groups[k].rows.push(r);
        groups[k].sum += Number(r.amount);
      });
      order.sort(function (a, b) { return Math.abs(groups[b].sum) - Math.abs(groups[a].sum) || groups[b].rows.length - groups[a].rows.length; });
      order.forEach(function (k) {
        var g = groups[k];
        var gid = state.tab + "|" + state.group + "|" + k;
        var isCollapsed = Boolean(collapsed[gid]);
        var head = el("tr", "group-row");
        var td = el("td");
        td.colSpan = cols.length;
        var caret = el("span", "caret", isCollapsed ? "▸" : "▾");
        td.appendChild(caret);
        td.appendChild(document.createTextNode(k));
        td.appendChild(el("span", "group-meta", g.rows.length + (g.rows.length === 1 ? " row · " : " rows · ") + money(g.sum)));
        head.appendChild(td);
        head.tabIndex = 0;
        var toggle = function () { collapsed[gid] = !collapsed[gid]; render(); };
        head.addEventListener("click", toggle);
        head.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
        frag.appendChild(head);
        if (!isCollapsed) g.rows.forEach(function (r) { frag.appendChild(makeRow(r, cols)); });
      });
    } else {
      var shown = list.slice(0, state.shown);
      shownCount = shown.length;
      shown.forEach(function (r) { frag.appendChild(makeRow(r, cols)); });
    }
    tbody.appendChild(frag);
    if (!list.length) {
      var empty = el("tr"); var etd = el("td", "faint", "No rows match."); etd.colSpan = cols.length; empty.appendChild(etd); tbody.appendChild(empty);
    }
    var total = list.reduce(function (s, r) { return s + Number(r.amount); }, 0);
    document.getElementById("drill-count").textContent = list.length + " rows · " + money(total) + (shownCount < list.length ? " · showing " + shownCount : "");
    var more = document.getElementById("drill-more");
    more.hidden = Boolean(state.group) || shownCount >= list.length;
  }

  function csvOf(list, cols) {
    var esc = function (v) { var s = String(v == null ? "" : v); return /[",\\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    var out = [cols.map(function (c) { return esc(c.h); }).join(",")];
    list.forEach(function (r) { out.push(cols.map(function (c) { return esc(c.f(r)); }).join(",")); });
    return out.join("\\n");
  }
  function copyText(text, statusEl, anchor) {
    var done = function () { statusEl.textContent = "Copied"; setTimeout(function () { statusEl.textContent = ""; }, 2000); };
    var fallback = function () {
      var ta = anchor.parentNode.querySelector("textarea.csv");
      if (!ta) { ta = document.createElement("textarea"); ta.className = "csv"; ta.readOnly = true; anchor.parentNode.appendChild(ta); }
      ta.value = text; ta.focus(); ta.select();
      statusEl.textContent = "Select and copy";
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else { fallback(); }
  }

  // Populate filters
  var months = {}; var accounts = {};
  Object.keys(rows).forEach(function (k) { rows[k].forEach(function (r) { months[r.month] = 1; accounts[r.accountSlug] = r.accountName; }); });
  var mSel = document.getElementById("f-month");
  Object.keys(months).sort().forEach(function (m) { var o = el("option", "", fmtMonth(m)); o.value = m; mSel.appendChild(o); });
  var aSel = document.getElementById("f-account");
  Object.keys(accounts).sort(function (a, b) { return accounts[a].localeCompare(accounts[b]); }).forEach(function (s) { var o = el("option", "", accounts[s]); o.value = s; aSel.appendChild(o); });

  function syncGroupOptions() {
    // Category pair groupings only make sense for paired buckets. Looked up here, not via the
    // gSel variable below, because this runs before that assignment.
    var gSel = document.getElementById("f-group");
    var pairOnly = { hundieCategory: 1, qboCategory: 1, pair: 1 };
    var pair = isPair(state.tab);
    Array.prototype.forEach.call(gSel.options, function (o) {
      if (o.value in pairOnly) { o.hidden = !pair; o.textContent = o.value === "hundieCategory" ? "Hundie category" : o.value === "qboCategory" ? "QBO category" : "Hundie → QBO category"; }
      if (o.value === "" ) o.textContent = "None";
    });
    var catOpt = gSel.querySelector('option[value="category"]');
    if (!catOpt) { catOpt = document.createElement("option"); catOpt.value = "category"; catOpt.textContent = "Category"; gSel.insertBefore(catOpt, gSel.querySelector('option[value="account"]')); }
    catOpt.hidden = pair;
    if ((state.group in pairOnly && !pair) || (state.group === "category" && pair)) { state.group = ""; gSel.value = ""; }
  }
  document.querySelectorAll("button.tab").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll("button.tab").forEach(function (b) { b.setAttribute("aria-selected", "false"); });
      btn.setAttribute("aria-selected", "true");
      state.tab = btn.getAttribute("data-tab"); state.shown = PAGE; syncGroupOptions(); render();
    });
  });
  syncGroupOptions();
  mSel.addEventListener("change", function () { state.month = mSel.value; state.shown = PAGE; render(); });
  aSel.addEventListener("change", function () { state.account = aSel.value; state.shown = PAGE; render(); });
  var kSel = document.getElementById("f-kind");
  kSel.addEventListener("change", function () { state.kind = kSel.value; state.shown = PAGE; render(); });
  var tIn = document.getElementById("f-text");
  tIn.addEventListener("input", function () { state.text = tIn.value; state.shown = PAGE; render(); });
  var gSel = document.getElementById("f-group");
  gSel.addEventListener("change", function () { state.group = gSel.value; state.shown = PAGE; render(); });
  document.getElementById("drill-more").addEventListener("click", function () { state.shown += PAGE; render(); });
  document.getElementById("drill-copy").addEventListener("click", function (e) {
    copyText(csvOf(current(), columns(state.tab)), document.getElementById("drill-copy-status"), e.currentTarget);
  });

  // Static question tables: copy the rendered table.
  document.querySelectorAll("button.copy-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var table = document.getElementById(btn.getAttribute("data-copy"));
      var lines = [];
      table.querySelectorAll("tr").forEach(function (tr) {
        var cells = [];
        tr.querySelectorAll("th,td").forEach(function (c) { var s = c.innerText.replace(/\\s+/g, " ").trim(); cells.push(/[",]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s); });
        lines.push(cells.join(","));
      });
      copyText(lines.join("\\n"), btn.parentNode.querySelector(".copy-status"), btn);
    });
  });

  // Chart filters
  document.querySelectorAll("button[data-chart-filter]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll("button[data-chart-filter]").forEach(function (b) { b.setAttribute("aria-pressed", "false"); });
      btn.setAttribute("aria-pressed", "true");
      var flag = btn.getAttribute("data-chart-filter");
      document.querySelectorAll("#chart-table tbody tr").forEach(function (tr) {
        tr.hidden = Boolean(flag) && (" " + tr.getAttribute("data-flags") + " ").indexOf(" " + flag + " ") === -1;
      });
    });
  });

  render();
})();`;
}

export function renderDriftParts(report) {
  const head = `<title>GBSL Books Drift</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Source+Sans+3:wght@400;600&display=swap">
<style>${css()}</style>`;
  // Escape every "<" so no vendor string can open or close a tag inside the data script; escape the
  // two Unicode line separators JSON allows but an inline <script> does not.
  const json = JSON.stringify(report)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  const body = `<div class="page">
${renderMasthead(report)}
${renderTabBar(report)}
${renderPanel("summary", `${renderTiles(report)}\n${renderMonths(report)}\n${renderAccounts(report)}\n${renderNotBookedYet(report)}`, { first: true })}
${renderPanel("onlyQbo", renderMissingFromHundie(report))}
${renderPanel("disagree", renderPatterns(report))}
${renderPanel("asks", renderQuestions(report))}
${renderPanel("chart", renderChart(report))}
${renderPanel("rows", renderDrill(report))}
${renderFoot(report)}
</div>
<script type="application/json" id="drift-data">${json}</script>
<script>${clientScript()}</script>`;
  return { head, body };
}

export function renderDriftFragment(report) {
  const { head, body } = renderDriftParts(report);
  return `${head}\n${body}\n`;
}

export function renderDriftDocument(report) {
  const { head, body } = renderDriftParts(report);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head}
</head>
<body>
${body}
</body>
</html>
`;
}
