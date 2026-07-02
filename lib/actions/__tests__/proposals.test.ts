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
});
