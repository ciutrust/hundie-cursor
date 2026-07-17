/**
 * The money rules for an expense report, as pure functions.
 *
 * A report's lines are heterogeneous: real card charges (`transactions`) and captures (receipts AC
 * snapped at the counter). The whole correctness problem is that ONE spend can have BOTH — a $47
 * capture and, days later, the $47 "SQ *XXXX 4471" charge. Count both and he files $94.
 *
 * THE RULE: a capture is suppressed (stops being its own line, and instead enriches the charge's row
 * with its photo/note/GPS) ONLY when its twin is a COUNTED MEMBER OF THIS SAME REPORT.
 *
 * Not "whenever it's matched" — that was the first draft and it loses money in the other direction:
 * reconcile before the charge joins the report and the report silently drops $47, so he files short.
 * Scoping the check to counted members of this report also self-heals: remove the charge from the
 * report and its capture automatically reappears as a line, instead of the money vanishing.
 *
 * `transactions` passed in here is ALREADY only the counted members (in this report, not Plaid-reversed,
 * not a split parent) — the fetcher owns that filter, which is why membership is just a Set lookup.
 */

export type MemberTransaction = {
  id: string;
  transaction_date: string;
  description: string;
  vendor: string | null;
  amount: number;
  account_name: string;
  notes: string | null;
  expensed_at: string | null;
};

export type MemberCapture = {
  id: string;
  captured_at: string;
  vendor: string | null;
  amount: number | null;
  note: string | null;
  capture_kind: "card" | "cash";
  match_status: string;
  matched_transaction_id: string | null;
  photo_path: string | null;
  photo_status: string;
  latitude: number | null;
  longitude: number | null;
  expensed_at: string | null;
};

/** The capture riding along on a charge's row once reconciled (photo, note, where he was). */
export type LineEnrichment = {
  captureId: string;
  photoPath: string | null;
  photoStatus: string;
  note: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type ExpenseReportLine = {
  kind: "transaction" | "capture";
  /** transaction id, or capture id */
  id: string;
  /** YYYY-MM-DD — the charge's post date, or when the receipt was snapped. */
  date: string;
  label: string;
  /** Account name for a charge; "Cash" / "Card (awaiting charge)" for a standalone capture. */
  sublabel: string;
  /** Signed. A charge is positive (outflow); a refund is negative and nets the report down. */
  amount: number;
  note: string | null;
  expensedAt: string | null;
  /** Set on a `capture` line only. */
  capture?: {
    captureKind: "card" | "cash";
    photoPath: string | null;
    photoStatus: string;
    latitude: number | null;
    longitude: number | null;
  };
  /** Set on a `transaction` line that a reconciled capture is backing. */
  enrichedBy?: LineEnrichment;
};

export type ExpenseReportTotals = {
  /** What the trip cost: every line. Never moves as he toggles Expensed. */
  total: number;
  /** Of that, how much he has actually filed. */
  expensedTotal: number;
  expensedCount: number;
  count: number;
};

function captureSublabel(capture: MemberCapture): string {
  if (capture.capture_kind === "cash") return "Cash";
  // A 'card' capture still standing on its own means its charge hasn't been reconciled into this
  // report yet — that's the state that becomes a double-count if he adds the charge and forgets.
  return "Card · awaiting charge";
}

/**
 * Merge a report's charges and captures into one line list, applying the suppression rule.
 *
 * @param transactions counted members of this report only (already filtered by the fetcher)
 * @param captures     captures whose expense_report_id is this report
 */
export function buildExpenseReportLines(
  transactions: MemberTransaction[],
  captures: MemberCapture[],
): ExpenseReportLine[] {
  const memberIds = new Set(transactions.map((tx) => tx.id));

  // Split captures: those whose twin is a counted member here (suppressed -> enrich the charge), and
  // those that stand alone (cash, or a card capture whose charge isn't in this report yet).
  const enrichmentByTxId = new Map<string, LineEnrichment>();
  const standalone: MemberCapture[] = [];

  for (const capture of captures) {
    const twinIsCountedMemberHere =
      capture.matched_transaction_id !== null && memberIds.has(capture.matched_transaction_id);

    if (twinIsCountedMemberHere) {
      enrichmentByTxId.set(capture.matched_transaction_id as string, {
        captureId: capture.id,
        photoPath: capture.photo_path,
        photoStatus: capture.photo_status,
        note: capture.note,
        latitude: capture.latitude,
        longitude: capture.longitude,
      });
      continue;
    }
    standalone.push(capture);
  }

  const lines: ExpenseReportLine[] = [];

  for (const tx of transactions) {
    lines.push({
      kind: "transaction",
      id: tx.id,
      date: tx.transaction_date,
      label: tx.description,
      sublabel: tx.account_name,
      amount: Number(tx.amount),
      note: tx.notes,
      expensedAt: tx.expensed_at,
      enrichedBy: enrichmentByTxId.get(tx.id),
    });
  }

  for (const capture of standalone) {
    lines.push({
      kind: "capture",
      id: capture.id,
      date: capture.captured_at.slice(0, 10),
      label: capture.vendor?.trim() || "Receipt",
      sublabel: captureSublabel(capture),
      // A capture with no amount yet (photo saved, details not filled in) contributes nothing to the
      // total rather than NaN-ing it.
      amount: capture.amount == null ? 0 : Number(capture.amount),
      note: capture.note,
      expensedAt: capture.expensed_at,
      capture: {
        captureKind: capture.capture_kind,
        photoPath: capture.photo_path,
        photoStatus: capture.photo_status,
        latitude: capture.latitude,
        longitude: capture.longitude,
      },
    });
  }

  // Newest first, id as a stable tiebreaker so the order never flickers between renders.
  return lines.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

/** Both numbers AC asked for: what the trip cost, and how much of it he has filed. */
export function sumExpenseReportLines(lines: ExpenseReportLine[]): ExpenseReportTotals {
  let total = 0;
  let expensedTotal = 0;
  let expensedCount = 0;

  for (const line of lines) {
    total += line.amount;
    if (line.expensedAt) {
      expensedTotal += line.amount;
      expensedCount += 1;
    }
  }

  return { total, expensedTotal, expensedCount, count: lines.length };
}

/**
 * Card captures in this report still waiting on their charge. Used to warn before a double-count:
 * when a charge is added to a report holding one of these, offer to reconcile instead of stacking.
 */
export function pendingCardCaptures(lines: ExpenseReportLine[]): ExpenseReportLine[] {
  return lines.filter((line) => line.kind === "capture" && line.capture?.captureKind === "card");
}
