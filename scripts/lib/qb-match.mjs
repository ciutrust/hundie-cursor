/**
 * QBO <-> ledger "same transaction" matcher.
 *
 * Single source of truth for the scoring that decides whether a card-ledger row
 * and a QuickBooks Online export line are the same transaction. Shared by the
 * category backfill script (scripts/apply-qb-categories-to-ledger.mjs) and the
 * drift report (scripts/lib/qb-drift.mjs). Pure functions, plain node, no I/O.
 *
 * Shapes:
 *   card: { transaction_date: "YYYY-MM-DD", amount, vendor, description }
 *   qb:   { transaction_date: "YYYY-MM-DD", amount, vendor_name, description }
 *
 * matchScore compares ABSOLUTE amounts: card exports and QBO exports disagree on
 * sign convention, so only the magnitude has to agree.
 */

export function normalizeText(text) {
  return (text ?? "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function significantWords(text) {
  const stop = new Set(["payment", "purchase", "online", "card", "thank", "you", "the", "inc", "llc"]);
  return normalizeText(text)
    .split(" ")
    .filter((word) => word.length >= 3 && !stop.has(word));
}

export function dateAmountKey(row) {
  return `${row.transaction_date}|${Math.abs(Number(row.amount)).toFixed(2)}`;
}

export function stripQboCardSuffix(text) {
  return (text ?? "").replace(/\s*-\s*\d{4}\s*$/, "").trim();
}

export function addDaysIso(isoDate, days) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function dateAmountKeys(row, slackDays = 0) {
  const amount = Math.abs(Number(row.amount)).toFixed(2);
  const keys = [`${row.transaction_date}|${amount}`];
  if (slackDays > 0) {
    for (let delta = 1; delta <= slackDays; delta += 1) {
      keys.push(`${addDaysIso(row.transaction_date, delta)}|${amount}`);
      keys.push(`${addDaysIso(row.transaction_date, -delta)}|${amount}`);
    }
  }
  return keys;
}

export function matchScore(card, qb, maxDateSlack = 0) {
  const cardAmount = Math.abs(Number(card.amount));
  const qbAmount = Math.abs(Number(qb.amount));
  if (cardAmount !== qbAmount) {
    return 0;
  }

  const cardDate = card.transaction_date;
  const qbDate = qb.transaction_date;
  let score = 10;
  if (cardDate !== qbDate) {
    const cardTime = new Date(`${cardDate}T12:00:00`).getTime();
    const qbTime = new Date(`${qbDate}T12:00:00`).getTime();
    const dayDiff = Math.round(Math.abs(cardTime - qbTime) / (1000 * 60 * 60 * 24));
    if (dayDiff > maxDateSlack) return 0;
    score = 8;
  }
  const cardText = normalizeText(`${card.vendor ?? ""} ${card.description ?? ""}`);
  const qbText = normalizeText(`${stripQboCardSuffix(qb.vendor_name ?? "")} ${stripQboCardSuffix(qb.description ?? "")}`);
  const cardWords = new Set(significantWords(cardText));

  for (const word of significantWords(qbText)) {
    if (cardWords.has(word)) score += 4;
  }

  if (cardText && qbText && (cardText.includes(qbText.slice(0, 10)) || qbText.includes(cardText.slice(0, 10)))) {
    score += 3;
  }

  return score;
}

export function pickBestMatch(card, indexedCandidates, maxDateSlack = 0) {
  const scored = indexedCandidates
    .map(({ qb, index }) => ({ qb, index, score: matchScore(card, qb, maxDateSlack) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.qb.transaction_date.localeCompare(b.qb.transaction_date));

  if (scored.length === 0) return null;

  const best = scored[0];
  const tied = scored.filter((item) => item.score === best.score);
  if (tied.length > 1) return null;

  const hasExactDate = best.qb.transaction_date === card.transaction_date;
  const minScore =
    indexedCandidates.length === 1 ? (hasExactDate ? 10 : 12) : hasExactDate ? 13 : 15;
  return best.score >= minScore ? best : null;
}
