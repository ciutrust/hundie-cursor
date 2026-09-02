/**
 * GBSL ↔ QuickBooks Online drift analysis. Pure: no I/O, no Supabase, no DOM.
 *
 * Spec: docs/superpowers/specs/2026-09-02-qb-drift-report-design.md
 *
 * Two inputs, one report:
 *   - QBO rows  — parseQboDriftRows(csvText) over a "Transaction Detail by Account" export.
 *   - Hundie rows — GBSL claims (any account) plus context rows: everything else Hundie holds on the
 *     accounts QBO has (other entities, unassigned). Context rows pair but are never "only in Hundie".
 * analyzeDrift() pairs them one-to-one (with a split-vs-whole fallback), buckets every row exactly
 * once, and rolls up the month scoreboard, disagreement patterns, and chart audit. Invariants are
 * asserted, not hoped.
 */
import {
  matchScore,
  normalizeText,
  significantWords,
  stripQboCardSuffix,
} from "./qb-match.mjs";
import { categoryKind } from "./category-kind.mjs";
import {
  parseCsv,
  parseDate,
  parseAmount,
  isAccountHeaderRow,
  isTransactionRow,
  isPaymentAccount,
} from "./qb-csv-parser.mjs";

/** QBO payment-account section → Hundie account slug. Only these sections feed the comparison. */
export const QBO_ACCOUNT_MAP = Object.freeze({
  "Navigate Business Checking℠ (3196) - 1": "wf-gbsl-checking",
  "Visa 0577": "wf-gbsl-cc",
  "Claudia's WF Business 1576 (was 8363)": "wf-gbsl-claudia-cc",
  "Capital One": "cap-one-quicksilver-claudia",
  "Line of Credit 4670": "wf-gbsl-business-line",
});

/**
 * Known naming variants for the same account (normalized Hundie path → normalized QBO path).
 * These pair as agree; the chart audit still lists both names so the variant can be retired.
 */
export const CATEGORY_ALIASES = Object.freeze({
  "owner contribution": "owners equity:owner contributions",
  "owner distribution": "owners equity:owner distribution",
});

const KEPT_TYPES = new Set(["Expense", "Credit Card Expense", "Check", "Credit Card Credit", "Deposit"]);
const PAYMENT_TYPES = new Set(["Credit Card Payment", "Transfer"]);
export const REVIEW_CATEGORY = "Ask My Accountant";
export const GBSL = "gbsl";
/** Kinds whose QBO category-section lines show money-in as positive (negate to reach Hundie's sign). */
const NEGATE_LINE_KINDS = new Set(["income", "funding", "liability", "transfer"]);

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

export function normalizePath(path) {
  return (path ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeSection(name) {
  return (name ?? "").replace(/[℠™®]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function isAssetSection(name) {
  return /checking|savings/i.test(name ?? "");
}

function isLiabilityLikeSplit(name) {
  return /\b(loan|payable|motor credit|line of credit)\b/i.test(name ?? "");
}

/** "January 1-September 2, 2026" | "January 1, 2026 - September 2, 2026" → { from, to } ISO or null. */
export function parsePeriodText(text) {
  if (!text) return null;
  const sides = text.split(/\s*[-–]\s*|\s+to\s+/i).map((s) => s.trim()).filter(Boolean);
  if (sides.length !== 2) return null;
  const parseSide = (side) => {
    const m = side.match(/([A-Za-z]+)\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?/);
    if (!m) return null;
    const month = MONTHS[m[1].toLowerCase()];
    if (!month) return null;
    return { month, day: Number(m[2]), year: m[3] ? Number(m[3]) : null };
  };
  const a = parseSide(sides[0]);
  const b = parseSide(sides[1]);
  if (!a || !b) return null;
  const year = b.year ?? a.year;
  if (!year) return null;
  const from = `${a.year ?? year}-${String(a.month).padStart(2, "0")}-${String(a.day).padStart(2, "0")}`;
  const to = `${year}-${String(b.month).padStart(2, "0")}-${String(b.day).padStart(2, "0")}`;
  return { from, to };
}

function daysBetween(aIso, bIso) {
  const a = new Date(`${aIso}T12:00:00`).getTime();
  const b = new Date(`${bIso}T12:00:00`).getTime();
  return Math.round(Math.abs(a - b) / 86_400_000);
}

function monthOf(isoDate) {
  return isoDate.slice(0, 7);
}

function money(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Kind of a QBO category. Balance-sheet accounts seen in the file win first, then Hundie's chart
 * (case-insensitive), then the shared categoryKind dispatch, then QBO-only naming rules.
 */
export function qboCategoryKind(name, { hundiePathsByNorm, liabilitySplits } = {}) {
  if (!name) return "unclassified";
  if (normalizePath(name) === normalizePath(REVIEW_CATEGORY)) return "review";
  if (liabilitySplits?.has(name)) return "liability";
  const hundie = hundiePathsByNorm?.get(normalizePath(name));
  if (hundie) return hundie.kind;
  const direct = categoryKind(name);
  if (direct !== "expense") return direct;
  if (/owner/i.test(name)) return "funding";
  if (/\bincome\b/i.test(name)) return "income";
  if (/cash back/i.test(name)) return "transfer";
  if (isLiabilityLikeSplit(name)) return "liability";
  return "expense";
}

/** Kind of a Hundie category: null / "Ask My Accountant" are review, everything else via categoryKind. */
export function hundieCategoryKind(fullPath) {
  if (!fullPath) return "review";
  if (normalizePath(fullPath) === normalizePath(REVIEW_CATEGORY)) return "review";
  return categoryKind(fullPath);
}

function lineKey(date, name, accountNorm) {
  return `${date}|${(name ?? "").trim()}|${accountNorm}`;
}

/**
 * Pick the category-section lines that make up a blank-Split parent. QBO repeats the memo on some
 * lines and leaves it blank on others, so candidates are keyed by date + payee + account only and
 * the amounts have to sum to the parent. When more lines than needed share the key (a same-day
 * entry to the same payee), the subset that sums exactly wins, preferring lines whose memo matches.
 * Returns null when nothing sums.
 */
export function resolveSplitLines(candidates, target) {
  const eq = (a, b) => Math.abs(money(a) - money(b)) < 0.005;
  if (candidates.length < 2) return null;
  const all = candidates.reduce((s, x) => s + x.amount, 0);
  if (eq(all, target)) return candidates;
  if (candidates.length > 14) return null;
  const n = candidates.length;
  let best = null;
  for (let mask = 1; mask < 1 << n; mask += 1) {
    let sum = 0;
    let size = 0;
    let memoMatches = 0;
    for (let i = 0; i < n; i += 1) {
      if (!(mask & (1 << i))) continue;
      sum += candidates[i].amount;
      size += 1;
      if (candidates[i].memoMatches) memoMatches += 1;
    }
    if (size < 2 || !eq(sum, target)) continue;
    const score = memoMatches * 10 + size;
    if (!best || score > best.score) best = { mask, score };
  }
  if (!best) return null;
  return candidates.filter((_, i) => best.mask & (1 << i));
}

/**
 * Parse a QBO "Transaction Detail by Account" CSV into drift rows.
 *
 * The report lists every transaction twice: under its payment account (Split = category) and under
 * its category account (Split = payment account). Rows are taken from the mapped payment-account
 * sections only, with two refinements:
 *   - a blank Split means a multi-line transaction; its lines are recovered from the category
 *     sections (same date / payee / account, amounts summing to the parent);
 *   - a movement between two mapped accounts is listed under both; the asset-side copy is kept as a
 *     `transfer` row (the leg Hundie imports) and the liability-side mirror is dropped.
 * Sections listed before the first income account are balance-sheet accounts (loans, payables) and
 * are typed `liability` when they appear as a Split. Every drop is counted.
 */
export function parseQboDriftRows(csvText, { accountMap = QBO_ACCOUNT_MAP, hundieCategories = [] } = {}) {
  const rows = parseCsv(csvText);
  const headerIndex = rows.findIndex(
    (row) => row[1]?.trim() === "Transaction date" && row[2]?.trim() === "Transaction type",
  );
  if (headerIndex === -1) {
    throw new Error("Could not find QuickBooks header row (Transaction date / Transaction type)");
  }

  const company = rows[0]?.[0]?.trim() || null;
  const reportName = rows[1]?.[0]?.trim() || null;
  const periodText = rows[2]?.[0]?.trim() || null;
  const period = parsePeriodText(periodText);
  let basis = null;
  for (let i = rows.length - 1; i > headerIndex; i -= 1) {
    const cell = rows[i]?.[0] ?? "";
    const m = cell.match(/(Cash|Accrual) Basis/i);
    if (m) {
      basis = m[1];
      break;
    }
  }

  const mapByNorm = new Map(Object.entries(accountMap).map(([section, slug]) => [normalizeSection(section), slug]));

  // Pass 1: group transaction rows by section, in file order.
  const sectionNames = [];
  const bySection = new Map();
  let currentSection = null;
  for (const row of rows.slice(headerIndex + 1)) {
    if (isAccountHeaderRow(row)) {
      const name = row[0].trim();
      if (name.startsWith("Total for")) continue;
      currentSection = name;
      if (!bySection.has(name)) {
        sectionNames.push(name);
        bySection.set(name, []);
      }
      continue;
    }
    if (!currentSection || !isTransactionRow(row)) continue;
    bySection.get(currentSection).push({
      date: parseDate(row[1]),
      type: row[2]?.trim() ?? "",
      num: row[3]?.trim() || null,
      name: row[4]?.trim() || null,
      description: row[5]?.trim() || null,
      split: row[6]?.trim() ?? "",
      rawAmount: parseAmount(row[7]),
    });
  }

  const mappedSectionNorms = new Set(sectionNames.map(normalizeSection).filter((n) => mapByNorm.has(n)));
  const sectionIndexByNorm = new Map(sectionNames.map((name, i) => [normalizeSection(name), i]));
  const paymentSections = sectionNames.filter((name) => isPaymentAccount(name) || mapByNorm.has(normalizeSection(name)));
  const unmappedPaymentSections = paymentSections.filter((name) => !mapByNorm.has(normalizeSection(name)));
  // QBO orders sections by account type: bank and cards, then liabilities, then income, COGS,
  // expenses, other income, equity. Everything unmapped before the first income section is a
  // balance-sheet account (loans, payables), never a P&L category.
  const firstIncome = sectionNames.findIndex((name) => /\bincome\b/i.test(name));
  const balanceSheetSections = (firstIncome === -1 ? [] : sectionNames.slice(0, firstIncome)).filter(
    (name) => !mapByNorm.has(normalizeSection(name)) && !/^total$/i.test(name),
  );
  const liabilitySplits = new Set([...unmappedPaymentSections, ...balanceSheetSections]);
  const hundiePathsByNorm = new Map(
    hundieCategories.map((c) => {
      const path = c.full_path ?? c.fullPath;
      return [normalizePath(path), { kind: c.kind ?? categoryKind(path), fullPath: path }];
    }),
  );
  const kindOf = (name) => qboCategoryKind(name, { hundiePathsByNorm, liabilitySplits });

  // Category-section lines, indexed for split recovery. Never emitted directly (they are mirrors).
  const lineIndex = new Map();
  for (const [section, list] of bySection) {
    if (mapByNorm.has(normalizeSection(section))) continue;
    for (const l of list) {
      const splitNorm = normalizeSection(l.split);
      if (!mappedSectionNorms.has(splitNorm) || l.rawAmount === null) continue;
      const key = lineKey(l.date, l.name, splitNorm);
      if (!lineIndex.has(key)) lineIndex.set(key, []);
      lineIndex.get(key).push({ section, rawAmount: l.rawAmount, description: l.description });
    }
  }
  const lineAmount = (section, rawAmount) => money(NEGATE_LINE_KINDS.has(kindOf(section)) ? -rawAmount : rawAmount);

  const dropped = {
    ownTransferMirror: { rows: 0, amount: 0 },
    otherType: {},
    unmappedSectionRows: 0,
    noAmount: 0,
    unresolvedSplits: 0,
  };
  const out = [];
  const push = (base) => {
    out.push({ id: `qbo-${out.length + 1}`, source: "qbo", ...base });
  };

  for (const [section, list] of bySection) {
    const slug = mapByNorm.get(normalizeSection(section));
    if (!slug) {
      dropped.unmappedSectionRows += list.length;
      continue;
    }
    const asset = isAssetSection(section);
    for (const l of list) {
      if (l.rawAmount === null || !l.date) {
        dropped.noAmount += 1;
        continue;
      }
      const amount = money(asset ? -l.rawAmount : l.rawAmount);
      const base = { section, accountSlug: slug, date: l.date, type: l.type, num: l.num, name: l.name, description: l.description, rawAmount: l.rawAmount };
      const splitNorm = normalizeSection(l.split);

      // Own-account movement: the Split names another account in the map (whether or not that
      // account has its own section in this export).
      if (mapByNorm.has(splitNorm)) {
        // Own-account movement between two mapped accounts. Keep one copy: the asset side, or for a
        // liability→liability move the copy under the section that appears first in the file.
        const splitIsAsset = isAssetSection(l.split);
        const keep = asset || (!splitIsAsset && (sectionIndexByNorm.get(normalizeSection(section)) ?? 0) < (sectionIndexByNorm.get(splitNorm) ?? Infinity));
        if (!keep) {
          dropped.ownTransferMirror.rows += 1;
          dropped.ownTransferMirror.amount = money(dropped.ownTransferMirror.amount + amount);
          continue;
        }
        push({ ...base, category: l.split, kind: "transfer", ownTransfer: true, amount });
        continue;
      }
      // A card payment funded from somewhere other than a mapped account (owner's personal money,
      // an unmapped loan) is a real row: its Split names the funding account.
      if (!KEPT_TYPES.has(l.type) && !PAYMENT_TYPES.has(l.type)) {
        dropped.otherType[l.type] = (dropped.otherType[l.type] ?? 0) + 1;
        continue;
      }
      if (!l.split) {
        const memo = (l.description ?? "").trim();
        const candidates = (lineIndex.get(lineKey(l.date, l.name, normalizeSection(section))) ?? []).map((x) => ({
          category: x.section,
          amount: lineAmount(x.section, x.rawAmount),
          memoMatches: (x.description ?? "").trim() === memo,
        }));
        const lines = resolveSplitLines(candidates, amount);
        if (lines) {
          const parentKey = `qsplit|${l.date}|${(l.name ?? "").trim()}|${section}|${amount.toFixed(2)}|${out.length}`;
          for (const x of lines) {
            push({ ...base, category: x.category, kind: kindOf(x.category), amount: x.amount, splitLine: true, splitParent: { key: parentKey, amount } });
          }
          continue;
        }
        dropped.unresolvedSplits += 1;
        push({ ...base, category: null, kind: "unclassified", amount });
        continue;
      }
      push({ ...base, category: l.split, kind: kindOf(l.split), amount });
    }
  }

  return {
    rows: out,
    meta: {
      company,
      reportName,
      periodText,
      period,
      basis,
      sections: sectionNames,
      paymentSections,
      unmappedPaymentSections,
      balanceSheetSections,
      dropped,
    },
  };
}

function sharedWordCount(hundie, qbo) {
  const hWords = new Set(significantWords(normalizeText(`${hundie.vendor ?? ""} ${hundie.description ?? ""}`)));
  const qText = normalizeText(`${stripQboCardSuffix(qbo.name ?? "")} ${stripQboCardSuffix(qbo.description ?? "")}`);
  let shared = 0;
  for (const word of new Set(significantWords(qText))) {
    if (hWords.has(word)) shared += 1;
  }
  return shared;
}

function toCard(row) {
  return { transaction_date: row.date, amount: row.amount, vendor: row.vendor ?? "", description: row.description ?? "" };
}

function toQb(row) {
  return { transaction_date: row.date, amount: row.amount, vendor_name: row.name ?? "", description: row.description ?? "" };
}

/**
 * One-to-one pairing, global greedy: every candidate pair (same signed amount, within slack) is
 * scored, sorted best-first, and assigned unless either side is already taken.
 * Same mapped account: accepted on amount+date alone (bank memos always share words; a same-day
 * same-amount collision on one account is rare and lands in the same category anyway).
 * Cross-account: needs ≥1 shared vendor word.
 */
export function pairRows(hundieRows, qboRows, { dateSlack = 5 } = {}) {
  const qboByAmount = new Map();
  for (const q of qboRows) {
    const key = q.amount.toFixed(2);
    if (!qboByAmount.has(key)) qboByAmount.set(key, []);
    qboByAmount.get(key).push(q);
  }

  const candidates = [];
  for (const h of hundieRows) {
    const bucket = qboByAmount.get(h.amount.toFixed(2));
    if (!bucket) continue;
    for (const q of bucket) {
      const dayDiff = daysBetween(h.date, q.date);
      if (dayDiff > dateSlack) continue;
      const base = matchScore(toCard(h), toQb(q), dateSlack);
      if (base === 0) continue;
      const sameAccount = h.accountSlug === q.accountSlug;
      const words = sharedWordCount(h, q);
      if (!sameAccount && words === 0) continue;
      const score = base + (sameAccount ? 6 : 0) - dayDiff * 0.1;
      const confidence = sameAccount && (dayDiff === 0 || words > 0) ? "high" : "medium";
      candidates.push({ h, q, score, dayDiff, words, sameAccount, confidence });
    }
  }

  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      a.dayDiff - b.dayDiff ||
      a.h.date.localeCompare(b.h.date) ||
      a.h.id.localeCompare(b.h.id) ||
      a.q.id.localeCompare(b.q.id),
  );

  const usedH = new Set();
  const usedQ = new Set();
  const pairs = [];
  for (const c of candidates) {
    if (usedH.has(c.h.id) || usedQ.has(c.q.id)) continue;
    usedH.add(c.h.id);
    usedQ.add(c.q.id);
    pairs.push(c);
  }
  return { pairs, usedH, usedQ };
}

function isParentOf(a, b) {
  return Boolean(a) && Boolean(b) && b.startsWith(`${a}:`);
}

function categoriesAgree(h, q) {
  const hp = normalizePath(h.category);
  const qp = normalizePath(q.category);
  if (hp === qp) return true;
  if (CATEGORY_ALIASES[hp] === qp || CATEGORY_ALIASES[qp] === hp) return true;
  return false;
}

function bucketFor(h, q) {
  if (h.entitySlug !== GBSL) return h.entitySlug ? "notGbsl" : "hundieReview";
  if (h.kind === "review") return "hundieReview";
  if (q.kind === "review") return "qboAsks";
  if (categoriesAgree(h, q)) return "agree";
  // Two own-account movements name their counter-account differently by design; nothing to settle.
  if (h.kind === "transfer" && q.kind === "transfer") return "agree";
  if (h.kind === q.kind) return "differ";
  return "kindDiffer";
}

function cleanVendor(text) {
  return (text ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s+ON\s+\d{1,2}\/\d{1,2}(\/\d{2,4})?\b.*$/i, "")
    .replace(/\s+REF\s*#?.*$/i, "")
    .replace(/\s+\d{2}\/\d{2}(\/\d{2,4})?\b.*$/, "")
    .replace(/\s+ON(\s+\d{1,2})?$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 40);
}
export { cleanVendor };

function vendorKey(h, q) {
  const raw = (q?.name && q.name.trim().slice(0, 40)) || cleanVendor(h?.vendor) || cleanVendor(h?.description ?? q?.description ?? "");
  return raw || "(no vendor)";
}

function pairView(c, bucket) {
  const { h, q } = c;
  const hp = normalizePath(h.category);
  const qp = normalizePath(q.category);
  return {
    bucket,
    month: monthOf(h.date),
    date: h.date,
    qboDate: q.date,
    amount: h.amount,
    vendor: vendorKey(h, q),
    description: h.description ?? "",
    qboName: q.name ?? "",
    qboDescription: q.description ?? "",
    accountSlug: h.accountSlug,
    accountName: h.accountName ?? h.accountSlug,
    qboSection: q.section,
    accountMismatch: !c.sameAccount,
    entitySlug: h.entitySlug,
    hundieCategory: h.category,
    qboCategory: q.category,
    hundieKind: h.kind,
    qboKind: q.kind,
    refinement: bucket === "differ" && (isParentOf(hp, qp) || isParentOf(qp, hp)),
    confidence: c.confidence,
    dayDiff: c.dayDiff,
    sharedWords: c.words,
    isSplitLeg: Boolean(h.isSplitLeg),
    whole: c.whole ?? null,
    hundieId: h.id,
    qboId: q.id,
  };
}

function rowView(r, reachableSlugs) {
  return {
    month: monthOf(r.date),
    date: r.date,
    amount: r.amount,
    vendor: r.source === "qbo" ? (r.name ?? "").slice(0, 40) : cleanVendor(r.vendor) || cleanVendor(r.description),
    description: r.description ?? "",
    accountSlug: r.accountSlug,
    accountName: r.accountName ?? r.section ?? r.accountSlug,
    entitySlug: r.entitySlug ?? null,
    category: r.category,
    kind: r.kind,
    isSplitLeg: Boolean(r.isSplitLeg),
    reachable: reachableSlugs.has(r.accountSlug),
    id: r.id,
  };
}

function sumAmt(rows) {
  return money(rows.reduce((s, r) => s + Number(r.amount), 0));
}

function sortPatterns(list) {
  return list.sort(
    (a, b) =>
      Number(a.kind !== "expense") - Number(b.kind !== "expense") ||
      Number(Boolean(a.refinement)) - Number(Boolean(b.refinement)) ||
      Math.abs(b.amount) - Math.abs(a.amount) ||
      b.rows - a.rows,
  );
}

function groupPatterns(views, { leftLabel = (v) => v.hundieCategory ?? "(unclassified)" } = {}) {
  const byPair = new Map();
  for (const v of views) {
    const left = leftLabel(v);
    const key = `${left}→${v.qboCategory ?? "(none)"}`;
    if (!byPair.has(key)) {
      byPair.set(key, {
        hundieCategory: left,
        qboCategory: v.qboCategory,
        hundieKind: v.hundieKind,
        qboKind: v.qboKind,
        kind: v.hundieKind,
        refinement: Boolean(v.refinement),
        rows: 0,
        amount: 0,
        vendors: new Map(),
      });
    }
    const p = byPair.get(key);
    p.rows += 1;
    p.amount = money(p.amount + v.amount);
    const vk = v.vendor.toLowerCase();
    if (!p.vendors.has(vk)) p.vendors.set(vk, { vendor: v.vendor, rows: 0, amount: 0 });
    const ven = p.vendors.get(vk);
    ven.rows += 1;
    ven.amount = money(ven.amount + v.amount);
  }
  return sortPatterns(
    [...byPair.values()].map((p) => ({
      ...p,
      vendors: [...p.vendors.values()].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount) || b.rows - a.rows),
    })),
  );
}

/** Group unmatched rows by vendor + category so a missing recurring charge reads as one line. */
function groupOnly(views) {
  const byKey = new Map();
  for (const v of views) {
    const key = `${v.vendor.toLowerCase()}|${normalizePath(v.category)}`;
    if (!byKey.has(key)) byKey.set(key, { vendor: v.vendor, category: v.category, kind: v.kind, rows: 0, amount: 0, months: new Set(), accounts: new Set() });
    const g = byKey.get(key);
    g.rows += 1;
    g.amount = money(g.amount + v.amount);
    g.months.add(v.month);
    g.accounts.add(v.accountName);
  }
  return sortPatterns([...byKey.values()].map((g) => ({ ...g, months: [...g.months].sort(), accounts: [...g.accounts].sort() })));
}

/**
 * Split-vs-whole fallback. A Hundie split (legs) against one QBO row, or QBO split lines against one
 * Hundie row, never pair leg by leg because the amounts differ. When none of a parent's parts paired,
 * the whole is tried against the other side's unpaired rows; a hit expands into one pair per part
 * (each part's category against the whole's category), all sharing the whole row.
 */
function pairComposites({ hundie, qbo, usedH, usedQ, dateSlack }) {
  const pairs = [];

  // Hundie parents (legs of a split transaction) vs unpaired QBO rows.
  const hundieParents = new Map();
  for (const r of hundie) {
    if (!r.parentId) continue;
    if (!hundieParents.has(r.parentId)) hundieParents.set(r.parentId, []);
    hundieParents.get(r.parentId).push(r);
  }
  const hundieComposites = [];
  for (const [parentId, legs] of hundieParents) {
    if (legs.some((l) => usedH.has(l.id))) continue;
    const first = legs[0];
    hundieComposites.push({
      id: `hparent-${parentId}`,
      date: first.date,
      amount: money(first.parentAmount ?? legs.reduce((s, l) => s + l.amount, 0)),
      description: first.description,
      vendor: first.vendor,
      accountSlug: first.accountSlug,
      legs,
    });
  }
  if (hundieComposites.length) {
    const freeQ = qbo.filter((q) => !usedQ.has(q.id));
    const { pairs: wholePairs } = pairRows(hundieComposites, freeQ, { dateSlack });
    for (const c of wholePairs) {
      usedQ.add(c.q.id);
      for (const leg of c.h.legs) {
        usedH.add(leg.id);
        pairs.push({ h: leg, q: c.q, score: c.score, dayDiff: c.dayDiff, words: c.words, sameAccount: c.sameAccount, confidence: c.confidence, whole: { side: "hundieSplit", amount: c.h.amount } });
      }
    }
  }

  // QBO parents (split lines of one QBO entry) vs unpaired Hundie rows.
  const qboParents = new Map();
  for (const q of qbo) {
    if (!q.splitParent) continue;
    if (!qboParents.has(q.splitParent.key)) qboParents.set(q.splitParent.key, []);
    qboParents.get(q.splitParent.key).push(q);
  }
  const qboComposites = [];
  for (const [key, lines] of qboParents) {
    if (lines.some((l) => usedQ.has(l.id))) continue;
    const first = lines[0];
    qboComposites.push({
      id: `qparent-${key}`,
      date: first.date,
      amount: money(first.splitParent.amount),
      name: first.name,
      description: first.description,
      section: first.section,
      accountSlug: first.accountSlug,
      lines,
    });
  }
  if (qboComposites.length) {
    const freeH = hundie.filter((h) => !usedH.has(h.id));
    const { pairs: wholePairs } = pairRows(freeH, qboComposites, { dateSlack });
    for (const c of wholePairs) {
      usedH.add(c.h.id);
      for (const line of c.q.lines) {
        usedQ.add(line.id);
        pairs.push({ h: { ...c.h, amount: line.amount }, q: line, score: c.score, dayDiff: c.dayDiff, words: c.words, sameAccount: c.sameAccount, confidence: c.confidence, whole: { side: "qboSplit", amount: c.q.amount } });
      }
    }
  }
  return pairs;
}

/**
 * @param {object} input
 * @param {Array} input.qboRows       from parseQboDriftRows().rows
 * @param {Array} input.hundieRows    { id, date, amount, description, vendor, accountSlug, accountName, entitySlug, category, kind, isSplitLeg, parentId, parentAmount }
 *                                    entitySlug "gbsl" = a GBSL claim; anything else = context (pairs, never "only in Hundie")
 * @param {Array} input.hundieCategories  GBSL chart: { full_path, kind, is_active }
 * @param {Array} [input.accounts]    { slug, display_name, default_entity_slug }
 * @param {object} [input.options]    { from, to, dateSlack }
 */
export function analyzeDrift({ qboRows, hundieRows, hundieCategories = [], accounts = [], options = {} }) {
  const { from = null, to = null, dateSlack = 5 } = options;
  const inPeriod = (d) => (!from || d >= from) && (!to || d <= to);
  const reachableSlugs = new Set(Object.values(QBO_ACCOUNT_MAP));

  const accountBySlug = new Map(accounts.map((a) => [a.slug, a]));
  const hundie = hundieRows
    .filter((r) => inPeriod(r.date))
    .map((r) => ({
      ...r,
      amount: money(Number(r.amount)),
      entitySlug: r.entitySlug === undefined ? GBSL : r.entitySlug,
      kind: r.kind ?? hundieCategoryKind(r.category),
      accountName: r.accountName ?? accountBySlug.get(r.accountSlug)?.display_name ?? r.accountSlug,
    }));
  const claims = hundie.filter((r) => r.entitySlug === GBSL);
  const context = hundie.filter((r) => r.entitySlug !== GBSL);
  const qbo = qboRows.filter((r) => inPeriod(r.date)).map((r) => ({ ...r, amount: money(Number(r.amount)) }));

  const { pairs: atomic, usedH, usedQ } = pairRows(hundie, qbo, { dateSlack });
  const composite = pairComposites({ hundie, qbo, usedH, usedQ, dateSlack });
  const pairs = [...atomic, ...composite];

  const buckets = { agree: [], differ: [], kindDiffer: [], qboAsks: [], hundieReview: [], notGbsl: [] };
  for (const c of pairs) {
    const b = bucketFor(c.h, c.q);
    buckets[b].push(pairView(c, b));
  }
  const onlyHundie = claims.filter((r) => !usedH.has(r.id)).map((r) => rowView(r, reachableSlugs));
  const onlyQbo = qbo.filter((r) => !usedQ.has(r.id)).map((r) => rowView(r, reachableSlugs));
  const contextUnpaired = context.filter((r) => !usedH.has(r.id)).length;

  // Invariants: every claim and every QBO row lands in exactly one place; matched dollars agree.
  const pairedClaimIds = new Set(pairs.filter((c) => c.h.entitySlug === GBSL).map((c) => c.h.id));
  const pairedQboIds = new Set(pairs.map((c) => c.q.id));
  if (pairedClaimIds.size + onlyHundie.length !== claims.length) {
    throw new Error(`Invariant: Hundie claims ${claims.length} != paired ${pairedClaimIds.size} + onlyHundie ${onlyHundie.length}`);
  }
  if (pairedQboIds.size + onlyQbo.length !== qbo.length) {
    throw new Error(`Invariant: QBO rows ${qbo.length} != paired ${pairedQboIds.size} + onlyQbo ${onlyQbo.length}`);
  }
  const matchedH = money(pairs.reduce((s, c) => s + c.h.amount, 0));
  const matchedQ = money([...pairedQboIds].reduce((s, id) => s + qbo.find((q) => q.id === id).amount, 0));
  if (Math.abs(matchedH - matchedQ) > 0.005) {
    throw new Error(`Invariant: matched $ differ (Hundie ${matchedH} vs QBO ${matchedQ})`);
  }

  // Month scoreboard — expense kind only, GBSL claims only. Coverage counts only Hundie rows on
  // accounts QBO has; spend on other cards can never pair and is reported separately.
  const monthSet = new Set([...claims, ...qbo].map((r) => monthOf(r.date)));
  const claimPairViews = [...buckets.agree, ...buckets.differ, ...buckets.kindDiffer, ...buckets.qboAsks, ...buckets.hundieReview].filter(
    (p) => p.entitySlug === GBSL,
  );
  const months = [...monthSet].sort().map((month) => {
    const hRows = claims.filter((r) => monthOf(r.date) === month && r.kind === "expense");
    const reachable = hRows.filter((r) => reachableSlugs.has(r.accountSlug));
    const unreachable = hRows.filter((r) => !reachableSlugs.has(r.accountSlug));
    const qRows = qbo.filter((r) => monthOf(r.date) === month && r.kind === "expense");
    const mPairs = claimPairViews.filter((p) => p.month === month && p.hundieKind === "expense");
    const agree = mPairs.filter((p) => p.bucket === "agree").length;
    const differ = mPairs.filter((p) => p.bucket === "differ").length;
    const notGbsl = buckets.notGbsl.filter((p) => p.month === month).length;
    const oh = onlyHundie.filter((r) => r.month === month && r.kind === "expense" && r.reachable);
    const oq = onlyQbo.filter((r) => r.month === month && r.kind === "expense");
    const coverage = reachable.length ? mPairs.length / reachable.length : 0;
    return {
      month,
      hundieRows: hRows.length,
      hundieAmount: sumAmt(hRows),
      reachableRows: reachable.length,
      reachableAmount: sumAmt(reachable),
      unreachableRows: unreachable.length,
      unreachableAmount: sumAmt(unreachable),
      qboRows: qRows.length,
      qboAmount: sumAmt(qRows),
      matched: mPairs.length,
      agree,
      differ,
      otherDrift: mPairs.length - agree - differ,
      notGbsl,
      onlyHundieRows: oh.length,
      onlyHundieAmount: sumAmt(oh),
      onlyQboRows: oq.length,
      onlyQboAmount: sumAmt(oq),
      coverage,
      agreeRate: mPairs.length ? agree / mPairs.length : 0,
      qboBehind: reachable.length > 0 && coverage < 0.5,
    };
  });

  // Only-in-Hundie by account (expense kind), largest first.
  const byAccount = new Map();
  for (const r of onlyHundie) {
    if (r.kind !== "expense") continue;
    if (!byAccount.has(r.accountSlug)) {
      const acc = accountBySlug.get(r.accountSlug);
      byAccount.set(r.accountSlug, {
        accountSlug: r.accountSlug,
        accountName: r.accountName,
        isGbslAccount: acc ? acc.default_entity_slug === GBSL : reachableSlugs.has(r.accountSlug),
        inQbo: reachableSlugs.has(r.accountSlug),
        rows: 0,
        amount: 0,
      });
    }
    const a = byAccount.get(r.accountSlug);
    a.rows += 1;
    a.amount = money(a.amount + r.amount);
  }
  const onlyHundieByAccount = [...byAccount.values()].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  // Chart audit — GBSL chart vs the categories QBO used (claims only on the Hundie side).
  const chartMap = new Map();
  const ensure = (path, seed) => {
    const key = normalizePath(path);
    if (!chartMap.has(key)) {
      chartMap.set(key, {
        path,
        hundiePath: null,
        qboPath: null,
        kind: null,
        qboKind: null,
        isActive: null,
        inHundieChart: false,
        inQbo: false,
        hundieRows: 0,
        hundieAmount: 0,
        qboRows: 0,
        qboAmount: 0,
        flags: [],
        ...seed,
      });
    }
    return chartMap.get(key);
  };
  for (const c of hundieCategories) {
    const path = c.full_path ?? c.fullPath;
    const e = ensure(path, {});
    e.hundiePath = path;
    e.inHundieChart = true;
    e.kind = c.kind ?? categoryKind(path);
    e.isActive = c.is_active ?? c.isActive ?? true;
  }
  for (const r of claims) {
    if (!r.category) continue;
    const e = ensure(r.category, { hundiePath: r.category, inHundieChart: false, kind: r.kind });
    e.hundieRows += 1;
    e.hundieAmount = money(e.hundieAmount + r.amount);
  }
  for (const r of qbo) {
    if (!r.category || r.ownTransfer) continue;
    const e = ensure(r.category, {});
    e.qboPath = e.qboPath ?? r.category;
    e.inQbo = true;
    e.qboKind = e.qboKind ?? r.kind;
    if (!e.kind) e.kind = r.kind;
    e.qboRows += 1;
    e.qboAmount = money(e.qboAmount + r.amount);
  }
  const chart = [...chartMap.values()].map((e) => {
    const flags = [];
    const aliasOf = CATEGORY_ALIASES[normalizePath(e.path)];
    const aliasTarget = aliasOf ? chartMap.get(aliasOf) : null;
    if (e.inHundieChart && !e.inQbo) flags.push(aliasTarget?.inQbo ? "alias" : e.hundieRows > 0 ? "hundieOnly" : "unusedBoth");
    if (!e.inHundieChart && e.inQbo) flags.push("qboOnly");
    if (e.hundiePath && e.qboPath && e.hundiePath !== e.qboPath) flags.push("nameVariant");
    if (e.inHundieChart && e.hundieRows === 0 && e.qboRows === 0 && !flags.includes("unusedBoth")) flags.push("unusedBoth");
    // Same name, different treatment: Hundie's chart calls it an expense while QBO keeps it on the
    // balance sheet (or vice versa). Rows pair as agree by name; the chart is where it gets fixed.
    if (e.inHundieChart && e.qboKind && e.kind !== e.qboKind && e.kind !== "review" && e.qboKind !== "review") flags.push("kindMismatch");
    return { ...e, flags };
  });
  chart.sort((a, b) => a.path.localeCompare(b.path));

  const byKind = (rows) => {
    const m = {};
    for (const r of rows) {
      m[r.kind] = m[r.kind] ?? { rows: 0, amount: 0 };
      m[r.kind].rows += 1;
      m[r.kind].amount = money(m[r.kind].amount + r.amount);
    }
    return m;
  };

  const sumAbs = (rows) => money(rows.reduce((s, r) => s + Math.abs(Number(r.amount)), 0));
  const unreachableClaims = claims.filter((r) => !reachableSlugs.has(r.accountSlug) && r.kind === "expense");
  const claimsExpense = claims.filter((r) => r.kind === "expense");
  const reachableClaimsExpense = claimsExpense.filter((r) => reachableSlugs.has(r.accountSlug));
  const qboExpense = qbo.filter((r) => r.kind === "expense");
  const pairedExpense = claimPairViews.filter((p) => p.hundieKind === "expense");
  const agreeExpense = pairedExpense.filter((p) => p.bucket === "agree");

  const entityName = (slug) => accounts.find((a) => a.default_entity_slug === slug)?.default_entity_name ?? slug ?? "(no entity)";

  return {
    meta: {
      from,
      to,
      dateSlack,
      contextRows: context.length,
      contextUnpaired,
      accountMap: Object.entries(QBO_ACCOUNT_MAP).map(([section, slug]) => ({
        section,
        slug,
        name: accountBySlug.get(slug)?.display_name ?? slug,
      })),
    },
    totals: {
      hundie: {
        inScope: claims.length,
        inScopeAmount: sumAmt(claims),
        unreachableRows: unreachableClaims.length,
        unreachableAmount: sumAmt(unreachableClaims),
        byKind: byKind(claims),
      },
      qbo: { inScope: qbo.length, inScopeAmount: sumAmt(qbo), byKind: byKind(qbo) },
      paired: pairedQboIds.size,
      pairedClaims: pairedClaimIds.size,
      matchedAmount: matchedH,
      // Expense-kind, GBSL-claim view for the headline tiles: signed sums across kinds net income
      // against spend and mean nothing to a reader. Drift dollars are gross (absolute) so refunds count.
      expense: {
        hundieRows: claimsExpense.length,
        hundieAmount: sumAmt(claimsExpense),
        reachableRows: reachableClaimsExpense.length,
        qboRows: qboExpense.length,
        qboAmount: sumAmt(qboExpense),
        pairedRows: pairedExpense.length,
        pairedAmount: sumAmt(pairedExpense),
        agreeRows: agreeExpense.length,
        coverage: reachableClaimsExpense.length ? pairedExpense.length / reachableClaimsExpense.length : 0,
        agreeRate: pairedExpense.length ? agreeExpense.length / pairedExpense.length : 0,
        differAbs: sumAbs(buckets.differ.filter((p) => p.hundieKind === "expense")),
        kindDifferAbs: sumAbs(buckets.kindDiffer.filter((p) => p.hundieKind === "expense" || p.qboKind === "expense")),
        notGbslAbs: sumAbs(buckets.notGbsl),
      },
      buckets: {
        agree: buckets.agree.length,
        differ: buckets.differ.length,
        kindDiffer: buckets.kindDiffer.length,
        qboAsks: buckets.qboAsks.length,
        hundieReview: buckets.hundieReview.length,
        notGbsl: buckets.notGbsl.length,
        onlyHundie: onlyHundie.length,
        onlyQbo: onlyQbo.length,
      },
      bucketAmounts: {
        agree: sumAmt(buckets.agree),
        differ: sumAmt(buckets.differ),
        kindDiffer: sumAmt(buckets.kindDiffer),
        qboAsks: sumAmt(buckets.qboAsks),
        hundieReview: sumAmt(buckets.hundieReview),
        notGbsl: sumAmt(buckets.notGbsl),
        onlyHundie: sumAmt(onlyHundie),
        onlyHundieReachable: sumAmt(onlyHundie.filter((r) => r.reachable)),
        onlyQbo: sumAmt(onlyQbo),
        // Expense-kind only: the numbers the tiles show. Transfers and income sit in the drill-down.
        onlyHundieReachableExpense: sumAmt(onlyHundie.filter((r) => r.reachable && r.kind === "expense")),
        onlyQboExpense: sumAmt(onlyQbo.filter((r) => r.kind === "expense")),
      },
      bucketRowsExpense: {
        onlyHundieReachable: onlyHundie.filter((r) => r.reachable && r.kind === "expense").length,
        onlyQbo: onlyQbo.filter((r) => r.kind === "expense").length,
      },
      accountMismatchPairs: pairs.filter((c) => !c.sameAccount).length,
      compositePairs: composite.length,
    },
    months,
    onlyHundieByAccount,
    patterns: groupPatterns(buckets.differ),
    kindPatterns: groupPatterns(buckets.kindDiffer),
    notGbslPatterns: groupPatterns(buckets.notGbsl, {
      leftLabel: (v) => `${entityName(v.entitySlug)} · ${v.hundieCategory ?? "(unclassified)"}`,
    }),
    onlyHundiePatterns: groupOnly(onlyHundie.filter((r) => r.reachable)),
    onlyQboPatterns: groupOnly(onlyQbo),
    qboAsks: buckets.qboAsks,
    hundieReview: buckets.hundieReview,
    chart,
    rows: {
      agree: buckets.agree,
      differ: buckets.differ,
      kindDiffer: buckets.kindDiffer,
      notGbsl: buckets.notGbsl,
      onlyHundie,
      onlyQbo,
    },
  };
}
