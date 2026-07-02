import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeFakeSupabase } from '../../../tests/helpers/fake-supabase.mjs';

afterEach(() => { vi.resetModules(); vi.restoreAllMocks(); });

function makeClient(initial) {
  const sb = makeFakeSupabase(initial);
  const origFrom = sb.from.bind(sb);
  const from = (t) => { const q = origFrom(t); if (typeof q.maybeSingle !== 'function') q.maybeSingle = function () { this._single = true; return this; }; return q; };
  return { client: { from, auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'u@x.com' } }, error: null }) } }, db: sb.db };
}

describe('acceptAiSuggestions', () => {
  it('writes classification, marks suggestion not current, logs an accept event', async () => {
    const { client, db } = makeClient({ classifications: [{ id: 'c1', entity_id: 'ent-old', category_id: null }], ai_suggestions: [{ id: 's1', transaction_id: 'tx-1', is_current: true }], suggestion_events: [] });
    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => client }));
    vi.doMock('next/cache', () => ({ revalidatePath: () => {} }));
    const { acceptAiSuggestions } = await import('@/lib/actions/ai-suggestions');
    const res = await acceptAiSuggestions([{ classificationId: 'c1', transactionId: 'tx-1', entityId: 'ent-A', categoryId: 'cat-1', aiSuggestedCategoryId: 'cat-1', description: 'COFFEE', vendor: null }]);
    expect(res).toEqual({ success: true, count: 1 });
    expect(db.classifications[0].category_id).toBe('cat-1');
    expect(db.ai_suggestions[0].is_current).toBe(false);
    expect(db.suggestion_events).toHaveLength(1);
    expect(db.suggestion_events[0].event_type).toBe('accept');
  });
});
