import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeFakeSupabase } from '../../../tests/helpers/fake-supabase.mjs';

afterEach(() => { vi.resetModules(); vi.restoreAllMocks(); });

function makeClient(initial: Record<string, unknown[]>) {
  const sb = makeFakeSupabase(initial) as any;
  const origFrom = sb.from.bind(sb);
  const from = (t: string) => {
    const q = origFrom(t);
    if (typeof q.maybeSingle !== 'function') q.maybeSingle = function () { this._single = true; return this; };
    const origSelect = q.select.bind(q);
    q.select = function (cols: string) {
      const m = cols.match(/,?\s*([a-z_]+)!inner\(([^)]*)\)/);
      if (m) { this._join = { table: m[1], cols: m[2].split(',').map((c: string) => c.trim()) }; cols = cols.replace(m[0], '').replace(/^,|,\s*$/g, ''); }
      return origSelect(cols);
    };
    const origThen = q.then.bind(q);
    q.then = function (resolve: (v: any) => unknown, reject: (e: unknown) => unknown) {
      return origThen((res: any) => {
        if (this._join && Array.isArray(res.data)) {
          const j = this._join; const fk = j.table.replace(/s$/, '') + '_id';
          res = { ...res, data: res.data.map((row: any) => { const jr = (sb.db[j.table] || []).find((x: any) => x.id === row[fk]); const proj: Record<string, unknown> = {}; for (const c of j.cols) proj[c] = jr ? jr[c] : null; return { ...row, [j.table]: jr ? proj : null }; }) };
        }
        return resolve(res);
      }, reject);
    };
    return q;
  };
  return { client: { from, auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'u@x.com' } }, error: null }) } }, db: sb.db as any };
}

function seed(overrides: Record<string, unknown> = {}) {
  return makeClient({
    categories: [{ id: 'cat-A', entity_id: 'ent-A' }],
    transactions: [{ id: 'tx-1', description: 'COFFEE', vendor: null }],
    classifications: [],
    classification_proposals: [{ id: 'p-1', transaction_id: 'tx-1', entity_id: 'ent-A', chosen_entity_id: null, source: 'confirmed_history', proposed_category_id: 'cat-A', chosen_category_id: null, rationale: 'seen', status: 'approved', entity_slug: 'ent-a', ...overrides }],
    suggestion_events: [],
  });
}

function mockAll(client: unknown) {
  vi.doMock('@/lib/auth/require-user', () => ({ requireUser: async () => ({ error: null, user: { id: 'u1', email: 'u@x.com' }, supabase: client }) }));
  vi.doMock('@/lib/supabase/service-role', () => ({ createServiceRoleClient: () => client }));
  vi.doMock('next/cache', () => ({ revalidatePath: () => {} }));
}

describe('commitApprovedProposals', () => {
  it('commits an approved proposal', async () => {
    const { client, db } = seed(); mockAll(client);
    const { commitApprovedProposals } = await import('@/lib/actions/proposals');
    const res = await commitApprovedProposals();
    expect(res).toMatchObject({ success: true, count: 1, skipped: 0 });
    expect(db.classifications).toHaveLength(1);
    expect(db.classifications[0].category_id).toBe('cat-A');
    expect(db.classification_proposals[0].status).toBe('committed');
  });
  it('skips a category that does not belong to the (overridden) entity', async () => {
    const { client, db } = seed({ chosen_category_id: 'cat-A', chosen_entity_id: 'ent-OTHER' }); mockAll(client);
    const { commitApprovedProposals } = await import('@/lib/actions/proposals');
    const res = await commitApprovedProposals();
    expect(res).toEqual({ error: 'Nothing valid to commit (1 skipped)' });
    expect(db.classifications).toHaveLength(0);
  });
  it('is idempotent: an already-committed proposal is not re-selected', async () => {
    const { client, db } = seed({ status: 'committed' }); mockAll(client);
    const { commitApprovedProposals } = await import('@/lib/actions/proposals');
    const res = await commitApprovedProposals();
    expect(res).toEqual({ error: 'No approved proposals to commit' });
    expect(db.classifications).toHaveLength(0);
  });
  // C1 guard: an interim human classification must NOT be overwritten by a stale proposal.
  it('skips a proposal whose txn was manually classified after generation', async () => {
    const { client, db } = seed();
    db.classifications.push({ id: 'k1', transaction_id: 'tx-1', entity_id: 'ent-A', category_id: 'cat-A', classified_by: 'alex@example.com', notes: 'mine' });
    mockAll(client);
    const { commitApprovedProposals } = await import('@/lib/actions/proposals');
    const res = await commitApprovedProposals();
    expect(res).toEqual({ error: 'Nothing valid to commit (1 skipped)' });
    expect(db.classifications.find((c: any) => c.transaction_id === 'tx-1').notes).toBe('mine');
    expect(db.classification_proposals[0].status).toBe('skipped');
  });

  // C16: a kept proposal logs an accept; an overridden one logs a reject with the PROPOSED category
  // as suggested_category_id, so the engine's accept-rate isn't inflated.
  it('logs an accept event when the proposed category is kept', async () => {
    const { client, db } = seed(); mockAll(client);
    const { commitApprovedProposals } = await import('@/lib/actions/proposals');
    await commitApprovedProposals();
    expect(db.suggestion_events).toHaveLength(1);
    expect(db.suggestion_events[0]).toMatchObject({
      event_type: 'accept', suggested_category_id: 'cat-A', chosen_category_id: 'cat-A',
    });
  });
  it('logs a reject event when the operator overrode the proposed category', async () => {
    // proposed cat-A, but operator chose cat-B (which also belongs to ent-A so it commits).
    const { client, db } = seed({ chosen_category_id: 'cat-B' });
    db.categories.push({ id: 'cat-B', entity_id: 'ent-A' });
    mockAll(client);
    const { commitApprovedProposals } = await import('@/lib/actions/proposals');
    const res = await commitApprovedProposals();
    expect(res).toMatchObject({ success: true, count: 1 });
    expect(db.suggestion_events).toHaveLength(1);
    expect(db.suggestion_events[0]).toMatchObject({
      event_type: 'reject', suggested_category_id: 'cat-A', chosen_category_id: 'cat-B',
    });
  });

  // B1: the approved-proposals read is paginated (paginateAll + .order('id')), and the URL-side
  // .in() loops chunk at 200 — a commit spanning >1000 rows (past the page boundary and many chunks)
  // must commit ALL of them, not silently drop past 1000.
  it('B1: commits every approved proposal past the 1000-row page boundary', async () => {
    const n = 1050;
    const transactions = Array.from({ length: n }, (_, i) => ({ id: `tx-${i}`, description: 'X', vendor: null }));
    const classification_proposals = Array.from({ length: n }, (_, i) => ({
      id: `p-${i}`, transaction_id: `tx-${i}`, entity_id: 'ent-A', chosen_entity_id: null,
      source: 'confirmed_history', proposed_category_id: 'cat-A', chosen_category_id: null,
      rationale: null, status: 'approved', entity_slug: 'ent-a',
    }));
    const { client, db } = makeClient({
      categories: [{ id: 'cat-A', entity_id: 'ent-A' }],
      transactions, classifications: [], classification_proposals, suggestion_events: [],
    });
    mockAll(client);
    const { commitApprovedProposals } = await import('@/lib/actions/proposals');
    const res = await commitApprovedProposals();
    expect(res).toMatchObject({ success: true, count: n });
    expect(db.classifications).toHaveLength(n);
    expect(db.classification_proposals.every((p: any) => p.status === 'committed')).toBe(true);
  });
});

describe('setProposalDecision', () => {
  function seedDecision(overrides: Record<string, unknown> = {}) {
    return makeClient({
      classification_proposals: [
        { id: 'p-1', transaction_id: 'tx-1', entity_id: 'ent-A', status: 'pending', entity_slug: 'ent-a', ...overrides },
      ],
    });
  }

  it('does not flip a committed proposal back to approved and reports a 0 count', async () => {
    const { client, db } = seedDecision({ status: 'committed' }); mockAll(client);
    const { setProposalDecision } = await import('@/lib/actions/proposals');
    const res = await setProposalDecision(['p-1'], 'approved');
    expect(res).toEqual({ success: true, count: 0 });
    expect(db.classification_proposals[0].status).toBe('committed'); // unchanged
  });

  it('does not flip a skipped proposal back to approved', async () => {
    const { client, db } = seedDecision({ status: 'skipped' }); mockAll(client);
    const { setProposalDecision } = await import('@/lib/actions/proposals');
    const res = await setProposalDecision(['p-1'], 'approved');
    expect(res).toEqual({ success: true, count: 0 });
    expect(db.classification_proposals[0].status).toBe('skipped');
  });

  it('updates a pending proposal and returns the real matched count', async () => {
    const { client, db } = seedDecision({ status: 'pending' }); mockAll(client);
    const { setProposalDecision } = await import('@/lib/actions/proposals');
    const res = await setProposalDecision(['p-1'], 'approved', 'cat-A');
    expect(res).toEqual({ success: true, count: 1 });
    expect(db.classification_proposals[0].status).toBe('approved');
    expect(db.classification_proposals[0].chosen_category_id).toBe('cat-A');
  });

  it('counts only the eligible rows in a mixed batch', async () => {
    const client = makeClient({
      classification_proposals: [
        { id: 'p-1', transaction_id: 'tx-1', entity_id: 'ent-A', status: 'pending', entity_slug: 'ent-a' },
        { id: 'p-2', transaction_id: 'tx-2', entity_id: 'ent-A', status: 'committed', entity_slug: 'ent-a' },
      ],
    });
    mockAll(client.client);
    const { setProposalDecision } = await import('@/lib/actions/proposals');
    const res = await setProposalDecision(['p-1', 'p-2'], 'approved');
    expect(res).toEqual({ success: true, count: 1 }); // only p-1 flipped; p-2 stays committed
    expect(client.db.classification_proposals.find((p: any) => p.id === 'p-2').status).toBe('committed');
  });

  // A1: the id list is chunked at 200 (an "Approve all" over >420 ids would otherwise 400 on the URL).
  // Approving 450 pending proposals must flip all 450 and return the full matched count.
  it('A1: chunks a large id list and returns the full matched count', async () => {
    const n = 450;
    const classification_proposals = Array.from({ length: n }, (_, i) => ({
      id: `p-${i}`, transaction_id: `tx-${i}`, entity_id: 'ent-A', status: 'pending', entity_slug: 'ent-a',
    }));
    const client = makeClient({ classification_proposals });
    mockAll(client.client);
    const { setProposalDecision } = await import('@/lib/actions/proposals');
    const res = await setProposalDecision(classification_proposals.map((p) => p.id), 'approved');
    expect(res).toEqual({ success: true, count: n });
    expect(client.db.classification_proposals.every((p: any) => p.status === 'approved')).toBe(true);
  });
});
