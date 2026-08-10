import type { SupabaseClient } from "@supabase/supabase-js";
import type { PeriodRange } from "@/lib/period";
import { createClient } from "@/lib/supabase/server";
import { paginateAll } from "@/lib/supabase/paginate";
import { pgErrorMessage } from "@/lib/supabase/errors";
import { chunk } from "@/lib/supabase/chunk";
import {
  pairCandidates,
  type LinkKind,
  type PairLeg,
  type PairSuggestion,
} from "@/lib/intercompany-pairing";

// Re-exported so UI consumers import the whole pairing surface from one module.
export type { LinkKind, PairLeg, PairSuggestion };
import { CATEGORY_KIND_PATH_SETS } from "@/lib/category-kind";
import { amountToCents } from "@/lib/money";

/* ------------------------------------------------------------------------------------------------
 * Pairing review - explicit out<->in links, suggestions, and one-sided legs.
 * ---------------------------------------------------------------------------------------------- */

/**
 * Keep in lockstep with MIRROR_WINDOW_DAYS in lib/intercompany.ts (private there, so restated).
 * A transfer initiated May 31 lands Jun 1 - the fetch window is widened by this many days on both
 * sides purely so counterparts are FINDABLE; display filtering below still keys off the requested
 * period.
 */
const PAIR_WINDOW_DAYS = 3;

/**
 * Categories that mark a leg as pairing-relevant: the funding kinds (owner contribution /
 * distribution / transfer-to-business) plus the intercompany lease legs and the internal-transfer
 * bucket. Deliberately NOT all transfer paths - that set would pull in every card payment and
 * Zelle, which are not intercompany pairs. Path strings are data and must stay byte-exact.
 */
const PAIRING_CATEGORY_PATHS = new Set<string>([
  ...CATEGORY_KIND_PATH_SETS.funding,
  "Intercompany — 136 Anita",
  "Intercompany — 136 Anita (income)",
  "Intercompany — pending",
  "Internal transfer",
]);

const ONLINE_TRANSFER_RE = /ONLINE TRANSFER/i;

/**
 * `intercompany_links` / `intercompany_pair_dismissals` aren't in the generated Database type, so
 * reads go through one narrow cast - the same pattern stale-captures.ts uses.
 */
function db(supabase: Awaited<ReturnType<typeof createClient>>) {
  return supabase as unknown as SupabaseClient;
}

/** Whole-day shift of a `YYYY-MM-DD` date, computed in UTC ms so DST can't skew it. */
function shiftIsoDate(iso: string, days: number): string {
  const ms = Date.parse(`${iso}T00:00:00.000Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

type PairingTxRow = {
  id: string;
  account_id: string;
  transaction_date: string;
  amount: number;
  description: string;
  split_at: string | null;
  account: { account_type: string };
  classification: {
    entity_id: string;
    category_id: string | null;
    entity: { slug: string };
    category: { full_path: string } | null;
  };
};

/** Link legs are fetched WITHOUT the removed/split filters, so both flags ride along. */
type LinkedLegRow = PairingTxRow & { plaid_removed_at: string | null };

type LinkRow = {
  id: string;
  out_transaction_id: string;
  in_transaction_id: string;
  link_kind: string;
  ref_token: string | null;
  note: string | null;
  created_at: string;
};

type DismissalRow = {
  out_transaction_id: string;
  in_transaction_id: string;
};

export type LinkedPairLeg = PairLeg & { plaidRemoved: boolean; split: boolean };

export type LinkedPair = {
  linkId: string;
  kind: LinkKind;
  refToken: string | null;
  /** Free text on the LINK (not either leg) - the accounting trail for a pair, export-ready. */
  note: string | null;
  createdAt: string;
  out: LinkedPairLeg;
  in: LinkedPairLeg;
  broken: boolean;
  brokenReason: "removed" | "split" | "amount-drift" | null;
};

export type PairingReview = {
  suggestions: PairSuggestion[];
  linkedPairs: LinkedPair[];
  /** Pairing-relevant in-period rows with no link and no suggestion (no candidates found). */
  oneSided: PairLeg[];
  /** In-period one-sided legs hidden because AC acknowledged the counterpart isn't tracked. */
  acknowledgedCount: number;
  /** Linked pairs only; total = sum of out amounts (summed in cents, returned as dollars). */
  totalsByKind: Array<{ kind: LinkKind; count: number; total: number }>;
};

const TX_LEG_SELECT = `
  id,
  account_id,
  transaction_date,
  amount,
  description,
  split_at,
  account:accounts!inner(account_type),
  classification:classifications!inner(
    entity_id,
    category_id,
    entity:entities!inner(slug),
    category:categories(full_path)
  )
`;

function toPairLeg(row: PairingTxRow): PairLeg {
  return {
    transactionId: row.id,
    accountId: row.account_id,
    entitySlug: row.classification.entity.slug,
    transactionDate: row.transaction_date,
    amount: Number(row.amount),
    description: row.description,
    categoryId: row.classification.category_id,
    categoryPath: row.classification.category?.full_path ?? null,
  };
}

function toLinkedPairLeg(row: LinkedLegRow): LinkedPairLeg {
  return {
    ...toPairLeg(row),
    plaidRemoved: row.plaid_removed_at != null,
    split: row.split_at != null,
  };
}

function isPairingRelevant(description: string, categoryPath: string | null): boolean {
  // Deliberately NOT "any REF token": Zelle descriptions carry REF # WFCT tokens too, and treating
  // every Zelle-to-a-person as pairing-relevant floods One-sided with external payments and invites
  // false tier-2 prompts against them (review finding F3/L4). Internal moves say ONLINE TRANSFER.
  if (ONLINE_TRANSFER_RE.test(description)) return true;
  return categoryPath != null && PAIRING_CATEGORY_PATHS.has(categoryPath);
}

const LINK_KIND_ORDER: LinkKind[] = ["owner_funding", "intercompany_service", "internal_transfer"];

/**
 * Everything the pairing review page needs in one call:
 *  - `suggestions`: unlinked, undismissed out legs with their candidate in legs, from
 *    pairCandidates over a window widened by PAIR_WINDOW_DAYS on both sides (so a transfer that
 *    settles across the month boundary still finds its counterpart). Display-filtered to
 *    suggestions whose OUT leg is inside the requested period.
 *  - `linkedPairs`: confirmed links where EITHER leg is in-period. Legs are fetched WITHOUT the
 *    removed/split filters - a broken leg must stay visible so the break can be seen and the link
 *    unlinked, not silently vanish. brokenReason precedence: removed > split > amount-drift
 *    (drift compared in integer cents, never floats).
 *  - `oneSided`: pairing-relevant in-period legs that are neither linked nor part of any
 *    suggestion - the "money left and never arrived" review queue.
 */
export async function getIntercompanyPairingReview(period: PeriodRange): Promise<PairingReview> {
  const supabase = await createClient();
  const widenedStart = shiftIsoDate(period.start, -PAIR_WINDOW_DAYS);
  const widenedEnd = shiftIsoDate(period.end, PAIR_WINDOW_DAYS);
  const inPeriod = (isoDate: string) => isoDate >= period.start && isoDate < period.end;

  const [txRows, linkRows, dismissalRows, ackRows] = await Promise.all([
    // One widened fetch of candidate legs. Removed/split rows are excluded here - a reversed or
    // split charge is not a live transfer leg and must not generate suggestions.
    paginateAll<PairingTxRow>(
      async (from, pageSize) => {
        const { data, error } = await supabase
          .from("transactions")
          .select(TX_LEG_SELECT)
          .gte("transaction_date", widenedStart)
          .lt("transaction_date", widenedEnd)
          .is("plaid_removed_at", null)
          .is("split_at", null)
          .order("transaction_date", { ascending: true })
          .order("id", { ascending: true })
          .range(from, from + pageSize - 1);
        return { data: data as unknown as PairingTxRow[] | null, error };
      },
      undefined,
      (row) => row.id,
    ),
    // ALL links, not just in-period ones: linkedIds must suppress suggestions for every linked
    // transaction, and the display filter is applied after the legs are known.
    paginateAll<LinkRow>(
      async (from, pageSize) => {
        const { data, error } = await db(supabase)
          .from("intercompany_links")
          .select("id, out_transaction_id, in_transaction_id, link_kind, ref_token, note, created_at")
          .order("id", { ascending: true })
          .range(from, from + pageSize - 1);
        return { data: data as LinkRow[] | null, error };
      },
      undefined,
      (row) => row.id,
    ),
    paginateAll<DismissalRow>(
      async (from, pageSize) => {
        const { data, error } = await db(supabase)
          .from("intercompany_pair_dismissals")
          .select("out_transaction_id, in_transaction_id")
          .order("out_transaction_id", { ascending: true })
          .order("in_transaction_id", { ascending: true })
          .range(from, from + pageSize - 1);
        return { data: data as DismissalRow[] | null, error };
      },
      undefined,
      (row) => `${row.out_transaction_id}:${row.in_transaction_id}`,
    ),
    paginateAll<{ transaction_id: string }>(
      async (from, pageSize) => {
        const { data, error } = await db(supabase)
          .from("intercompany_one_sided_acks")
          .select("transaction_id")
          .order("transaction_id", { ascending: true })
          .range(from, from + pageSize - 1);
        return { data: data as { transaction_id: string }[] | null, error };
      },
      undefined,
      (row) => row.transaction_id,
    ),
  ]);

  const linkedIds = new Set<string>();
  for (const link of linkRows) {
    linkedIds.add(link.out_transaction_id);
    linkedIds.add(link.in_transaction_id);
  }
  const dismissedPairs = new Set(
    dismissalRows.map((d) => `${d.out_transaction_id}:${d.in_transaction_id}`),
  );

  // Fetch the linked legs by id, WITHOUT the removed/split filters (broken legs stay visible).
  const legRowById = new Map<string, LinkedLegRow>();
  for (const ids of chunk([...linkedIds], 200)) {
    const { data, error } = await supabase
      .from("transactions")
      .select(`${TX_LEG_SELECT}, plaid_removed_at`)
      .in("id", ids);
    if (error) throw new Error(pgErrorMessage(error), { cause: error });
    for (const row of (data ?? []) as unknown as LinkedLegRow[]) {
      legRowById.set(row.id, row);
    }
  }

  const legs = txRows
    .filter((row) => {
      // Card accounts hold charges and refunds only - the imports deliberately carry no payment
      // credits - so a card row can never be one leg of a transfer pair. This also keeps a card
      // charge booked to a funding category (a $2.84 owner draw on a swipe) out of One-sided:
      // a draw booked on spend is one-legged by nature. Revisit if payment credits ever import.
      if (row.account.account_type === "credit_card") return false;
      const categoryPath = row.classification.category?.full_path ?? null;
      // A checking OUTFLOW already filed as Credit card payment is settled money movement whose
      // twin is by-design absent from the ledger - noise, not an open question. An INFLOW filed
      // that way stays visible: money arriving INTO a checking labeled "card payment" is exactly
      // the kind of miscategorization the One-sided list exists to surface.
      if (categoryPath === "Credit card payment" && Number(row.amount) > 0) return false;
      return isPairingRelevant(row.description, categoryPath);
    })
    .map(toPairLeg);

  const allSuggestions = pairCandidates(legs, { linkedIds, dismissedPairs });
  // The widening exists only so counterparts are findable - display keeps a suggestion when EITHER
  // leg sits inside the requested period (matching linkedPairs). Out-leg-only display had a hole: a
  // tier-1 token pair straddling a period edge by more than the widening was linkable from NO view
  // (review finding F2). An empty-candidates suggestion (every candidate dismissed, or none found)
  // is not a suggestion the UI can act on; its out leg falls through to oneSided instead.
  const suggestions = allSuggestions.filter(
    (s) =>
      s.candidates.length > 0 &&
      (inPeriod(s.out.transactionDate) ||
        s.candidates.some((candidate) => inPeriod(candidate.transactionDate))),
  );

  const linkedPairs: LinkedPair[] = [];
  for (const link of linkRows) {
    const outRow = legRowById.get(link.out_transaction_id);
    const inRow = legRowById.get(link.in_transaction_id);
    // Defensive: a leg row missing entirely (deleted transaction) leaves nothing to render.
    if (!outRow || !inRow) continue;
    if (!inPeriod(outRow.transaction_date) && !inPeriod(inRow.transaction_date)) continue;

    const out = toLinkedPairLeg(outRow);
    const inLeg = toLinkedPairLeg(inRow);
    const brokenReason: LinkedPair["brokenReason"] =
      out.plaidRemoved || inLeg.plaidRemoved
        ? "removed"
        : out.split || inLeg.split
          ? "split"
          : amountToCents(out.amount) !== -amountToCents(inLeg.amount)
            ? "amount-drift"
            : null;

    linkedPairs.push({
      linkId: link.id,
      kind: link.link_kind as LinkKind,
      refToken: link.ref_token,
      note: link.note,
      createdAt: link.created_at,
      out,
      in: inLeg,
      broken: brokenReason != null,
      brokenReason,
    });
  }
  linkedPairs.sort((a, b) =>
    a.out.transactionDate === b.out.transactionDate
      ? a.linkId.localeCompare(b.linkId)
      : a.out.transactionDate.localeCompare(b.out.transactionDate),
  );

  // Membership check runs against ALL suggestions (pre display filter): a leg whose counterpart
  // sits just outside the period has a suggestion (visible when that period is viewed) and is not
  // "one-sided".
  const suggestedIds = new Set<string>();
  for (const s of allSuggestions) {
    if (s.candidates.length === 0) continue;
    suggestedIds.add(s.out.transactionId);
    for (const c of s.candidates) suggestedIds.add(c.transactionId);
  }
  // Acknowledged legs ("counterpart isn't tracked in Hundie") leave the list but stay countable,
  // so the page can say how many were consciously resolved rather than pretending they vanished.
  const ackedIds = new Set(ackRows.map((row) => row.transaction_id));
  const oneSidedAll = legs.filter(
    (leg) =>
      inPeriod(leg.transactionDate) &&
      !linkedIds.has(leg.transactionId) &&
      !suggestedIds.has(leg.transactionId),
  );
  const oneSided = oneSidedAll.filter((leg) => !ackedIds.has(leg.transactionId));
  const acknowledgedCount = oneSidedAll.length - oneSided.length;

  // Sum in integer cents (never floats), convert back once. Only kinds actually present, in a
  // fixed canonical order so the UI renders stably.
  const totals = new Map<LinkKind, { count: number; totalCents: number }>();
  for (const pair of linkedPairs) {
    const entry = totals.get(pair.kind) ?? { count: 0, totalCents: 0 };
    entry.count += 1;
    entry.totalCents += amountToCents(pair.out.amount);
    totals.set(pair.kind, entry);
  }
  const totalsByKind = LINK_KIND_ORDER.filter((kind) => totals.has(kind)).map((kind) => ({
    kind,
    count: totals.get(kind)!.count,
    total: totals.get(kind)!.totalCents / 100,
  }));

  return { suggestions, linkedPairs, oneSided, acknowledgedCount, totalsByKind };
}
