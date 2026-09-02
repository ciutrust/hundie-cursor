/**
 * GBSL ↔ QuickBooks Online drift analysis. Pure: no I/O, no Supabase, no DOM.
 *
 * Spec: docs/superpowers/specs/2026-09-02-qb-drift-report-design.md
 *
 * Two inputs, one report:
 *   - QBO rows  — parseQboDriftRows(csvText) over a "Transaction Detail by Account" export.
 *   - Hundie rows — the GBSL ledger (unsplit rows + GBSL split legs), fetched by the CLI.
 * analyzeDrift() pairs them one-to-one, buckets every row exactly once, and rolls up the
 * month scoreboard, disagreement patterns, and chart audit. Invariants are asserted, not hoped.
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

const KEPT_TYPES = new Set(["Expense", "Credit Card Expense", "Check", "Credit Card Credit", "Deposit"]);
const PAYMENT_TYPES = new Set(["Credit Card Payment", "Transfer"]);
export const REVIEW_CATEGORY = "Ask My Accountant";
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
 * Kind of a QBO category. Hundie's chart wins when the path exists there (case-insensitive);
 * otherwise the shared categoryKind dispatch, then QBO-only naming rules.
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
 *     sections (same date / payee / memo / account, amounts summing to the parent);
 *   - a movement between two mapped accounts is listed under both; the asset-side copy is kept as a
 *     `transfer` row (the leg Hundie imports) and the liability-side mirror is dropped.
 * Every drop is counted.
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
  const liabilitySplits = new Set(unmappedPaymentSections);
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
      const splitIsMapped = mappedSectionNorms.has(splitNorm);

      if (PAYMENT_TYPES.has(l.type) || splitIsMapped) {
        // Own-account movement between two mapped accounts. Keep one copy: the asset side, or for a
        // liability→liability move the copy under the section that appears first in the file.
        const splitIsAsset = isAssetSection(l.split);
        const keep = asset || (!splitIsAsset && (sectionIndexByNorm.get(normalizeSection(section)) ?? 0) < (sectionIndexByNorm.get(splitNorm) ?? Infinity));
        if (!keep || !splitIsMapped) {
          if (!keep) {
            dropped.ownTransferMirror.rows += 1;
            dropped.ownTransferMirror.amount = money(dropped.ownTransferMirror.amount + amount);
            continue;
          }
        }
        push({ ...base, category: l.split || null, kind: "transfer", ownTransfer: true, amount });
        continue;
      }
      if (!KEPT_TYPES.has(l.type)) {
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
          for (const x of lines) {
            push({ ...base, category: x.category, kind: kindOf(x.category), amount: x.amount, splitLine: true });
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
 * Same mapped account: accepted on amount+date alone. Cross-account: needs ≥1 shared vendor word.
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

function bucketFor(h, q) {
  if (h.kind === "review") return "hundieReview";
  if (q.kind === "review") return "qboAsks";
  if (normalizePath(h.category) === normalizePath(q.category)) return "agree";
  // Two own-account movements name their counter-account differently by design; nothing to settle.
  if (h.kind === "transfer" && q.kind === "transfer") return "agree";
  if (h.kind === q.kind) return "differ";
  return "kindDiffer";
}

/** Strip bank-memo noise (dates, REF numbers, trailing ON) so the same payee groups as one vendor. */
export function cleanVendor(text) {
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

function vendorKey(h, q) {
  const raw = (q?.name && q.name.trim().slice(0, 40)) || cleanVendor(h?.vendor) || cleanVendor(h?.description ?? q?.description ?? "");
  return raw || "(no vendor)";
}

function pairView(c, bucket) {
  const { h, q } = c;
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
    hundieCategory: h.category,
    qboCategory: q.category,
    hundieKind: h.kind,
    qboKind: q.kind,
    confidence: c.confidence,
    dayDiff: c.dayDiff,
    sharedWords: c.words,
    isSplitLeg: Boolean(h.isSplitLeg),
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
  return list.sort((a, b) => Number(a.kind !== "expense") - Number(b.kind !== "expense") || Math.abs(b.amount) - Math.abs(a.amount) || b.rows - a.rows);
}

function groupPatterns(views) {
  const byPair = new Map();
  for (const v of views) {
    const key = `${v.hundieCategory ?? "(none)"}→${v.qboCategory ?? "(none)"}`;
    if (!byPair.has(key)) {
      byPair.set(key, { hundieCategory: v.hundieCategory, qboCategory: v.qboCategory, hundieKind: v.hundieKind, qboKind: v.qboKind, kind: v.hundieKind, rows: 0, amount: 0, vendors: new Map() });
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
 * @param {object} input
 * @param {Array} input.qboRows       from parseQboDriftRows().rows
 * @param {Array} input.hundieRows    { id, date, amount, description, vendor, accountSlug, accountName, category, kind, isSplitLeg }
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
      kind: r.kind ?? hundieCategoryKind(r.category),
      accountName: r.accountName ?? accountBySlug.get(r.accountSlug)?.display_name ?? r.accountSlug,
    }));
  const qbo = qboRows.filter((r) => inPeriod(r.date)).map((r) => ({ ...r, amount: money(Number(r.amount)) }));

  const { pairs, usedH, usedQ } = pairRows(hundie, qbo, { dateSlack });

  const buckets = { agree: [], differ: [], kindDiffer: [], qboAsks: [], hundieReview: [] };
  for (const c of pairs) {
    const b = bucketFor(c.h, c.q);
    buckets[b].push(pairView(c, b));
  }
  const onlyHundie = hundie.filter((r) => !usedH.has(r.id)).map((r) => rowView(r, reachableSlugs));
  const onlyQbo = qbo.filter((r) => !usedQ.has(r.id)).map((r) => rowView(r, reachableSlugs));

  const pairedCount = pairs.length;
  if (pairedCount + onlyHundie.length !== hundie.length) {
    throw new Error(`Invariant: Hundie rows ${hundie.length} != paired ${pairedCount} + onlyHundie ${onlyHundie.length}`);
  }
  if (pairedCount + onlyQbo.length !== qbo.length) {
    throw new Error(`Invariant: QBO rows ${qbo.length} != paired ${pairedCount} + onlyQbo ${onlyQbo.length}`);
  }
  const matchedH = money(pairs.reduce((s, c) => s + c.h.amount, 0));
  const matchedQ = money(pairs.reduce((s, c) => s + c.q.amount, 0));
  if (Math.abs(matchedH - matchedQ) > 0.005) {
    throw new Error(`Invariant: matched $ differ (Hundie ${matchedH} vs QBO ${matchedQ})`);
  }

  // Month scoreboard — expense kind only. Coverage counts only Hundie rows on accounts QBO has;
  // spend on other cards can never pair and is reported separately as "unreachable".
  const monthSet = new Set([...hundie, ...qbo].map((r) => monthOf(r.date)));
  const pairViews = [...buckets.agree, ...buckets.differ, ...buckets.kindDiffer, ...buckets.qboAsks, ...buckets.hundieReview];
  const months = [...monthSet].sort().map((month) => {
    const hRows = hundie.filter((r) => monthOf(r.date) === month && r.kind === "expense");
    const reachable = hRows.filter((r) => reachableSlugs.has(r.accountSlug));
    const unreachable = hRows.filter((r) => !reachableSlugs.has(r.accountSlug));
    const qRows = qbo.filter((r) => monthOf(r.date) === month && r.kind === "expense");
    const mPairs = pairViews.filter((p) => p.month === month && p.hundieKind === "expense");
    const agree = mPairs.filter((p) => p.bucket === "agree").length;
    const differ = mPairs.filter((p) => p.bucket === "differ").length;
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
        isGbslAccount: acc ? acc.default_entity_slug === "gbsl" : reachableSlugs.has(r.accountSlug),
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

  // Chart audit.
  const chartMap = new Map();
  const ensure = (path, seed) => {
    const key = normalizePath(path);
    if (!chartMap.has(key)) {
      chartMap.set(key, {
        path,
        hundiePath: null,
        qboPath: null,
        kind: null,
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
  for (const r of hundie) {
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
    if (!e.kind) e.kind = r.kind;
    e.qboRows += 1;
    e.qboAmount = money(e.qboAmount + r.amount);
  }
  const chart = [...chartMap.values()].map((e) => {
    const flags = [];
    if (e.inHundieChart && !e.inQbo) flags.push(e.hundieRows > 0 ? "hundieOnly" : "unusedBoth");
    if (!e.inHundieChart && e.inQbo) flags.push("qboOnly");
    if (e.hundiePath && e.qboPath && e.hundiePath !== e.qboPath) flags.push("nameVariant");
    if (e.inHundieChart && e.hundieRows === 0 && e.qboRows === 0 && !flags.includes("unusedBoth")) flags.push("unusedBoth");
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

  const unreachableHundie = hundie.filter((r) => !reachableSlugs.has(r.accountSlug) && r.kind === "expense");
  const sumAbs = (rows) => money(rows.reduce((s, r) => s + Math.abs(Number(r.amount)), 0));
  const hundieExpense = hundie.filter((r) => r.kind === "expense");
  const qboExpense = qbo.filter((r) => r.kind === "expense");
  const pairedExpense = pairViews.filter((p) => p.hundieKind === "expense");

  return {
    meta: {
      from,
      to,
      dateSlack,
      accountMap: Object.entries(QBO_ACCOUNT_MAP).map(([section, slug]) => ({
        section,
        slug,
        name: accountBySlug.get(slug)?.display_name ?? slug,
      })),
    },
    totals: {
      hundie: {
        inScope: hundie.length,
        inScopeAmount: sumAmt(hundie),
        unreachableRows: unreachableHundie.length,
        unreachableAmount: sumAmt(unreachableHundie),
        byKind: byKind(hundie),
      },
      qbo: { inScope: qbo.length, inScopeAmount: sumAmt(qbo), byKind: byKind(qbo) },
      paired: pairedCount,
      matchedAmount: matchedH,
      // Expense-kind view for the headline tiles: signed sums across kinds net income against
      // spend and mean nothing to a reader. Drift dollars are gross (absolute) so refunds count.
      expense: {
        hundieRows: hundieExpense.length,
        hundieAmount: sumAmt(hundieExpense),
        qboRows: qboExpense.length,
        qboAmount: sumAmt(qboExpense),
        pairedRows: pairedExpense.length,
        pairedAmount: sumAmt(pairedExpense),
        differAbs: sumAbs(buckets.differ.filter((p) => p.hundieKind === "expense")),
        kindDifferAbs: sumAbs(buckets.kindDiffer),
      },
      buckets: {
        agree: buckets.agree.length,
        differ: buckets.differ.length,
        kindDiffer: buckets.kindDiffer.length,
        qboAsks: buckets.qboAsks.length,
        hundieReview: buckets.hundieReview.length,
        onlyHundie: onlyHundie.length,
        onlyQbo: onlyQbo.length,
      },
      bucketAmounts: {
        agree: sumAmt(buckets.agree),
        differ: sumAmt(buckets.differ),
        kindDiffer: sumAmt(buckets.kindDiffer),
        qboAsks: sumAmt(buckets.qboAsks),
        hundieReview: sumAmt(buckets.hundieReview),
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
    },
    months,
    onlyHundieByAccount,
    patterns: groupPatterns(buckets.differ),
    kindPatterns: groupPatterns(buckets.kindDiffer),
    onlyHundiePatterns: groupOnly(onlyHundie.filter((r) => r.reachable)),
    onlyQboPatterns: groupOnly(onlyQbo),
    qboAsks: buckets.qboAsks,
    hundieReview: buckets.hundieReview,
    chart,
    rows: {
      agree: buckets.agree,
      differ: buckets.differ,
      kindDiffer: buckets.kindDiffer,
      onlyHundie,
      onlyQbo,
    },
  };
}
