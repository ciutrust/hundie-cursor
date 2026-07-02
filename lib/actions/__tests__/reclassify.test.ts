import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeFakeSupabase } from '../../../tests/helpers/fake-supabase.mjs';

afterEach(() => { vi.resetModules(); vi.restoreAllMocks(); });

function makeClient(initial) {
  const sb = makeFakeSupabase(initial);
  const origFrom = sb.from.bind(sb);
  const from = (t) => { const q = origFrom(t); if (typeof q.maybeSingle !== 'function') q.maybeSingle = function () { this._single = true; return this; }; return q; };
  return { client: { from, auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'u@x.com' } }, error: null }) } }, db: sb.db };
}

describe('reclassifyTransaction', () => {
  it('rejects a category that does not belong to the entity', async () => {
    const { client, db } = makeClient({ categories: [{ id: 'cat-1', entity_id: 'ent-A' }], classifications: [{ id: 'c1', entity_id: 'ent-old', category_id: null }] });
    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => client }));
    vi.doMock('next/cache', () => ({ revalidatePath: () => {} }));
    const { reclassifyTransaction } = await import('@/lib/actions/reclassify');
    const res = await reclassifyTransaction({ classificationId: 'c1', entityId: 'ent-B', categoryId: 'cat-1', notes: null, month: '2026-06', entitySlug: 'biz' });
    expect(res).toEqual({ error: 'Category does not belong to the selected entity' });
    expect(db.classifications[0].category_id).toBeNull();
  });

  it('updates the classification when the category belongs to the entity', async () => {
    const { client, db } = makeClient({ categories: [{ id: 'cat-1', entity_id: 'ent-A' }], classifications: [{ id: 'c1', entity_id: 'ent-old', category_id: null }], suggestion_events: [] });
    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => client }));
    vi.doMock('next/cache', () => ({ revalidatePath: () => {} }));
    const { reclassifyTransaction } = await import('@/lib/actions/reclassify');
    const res = await reclassifyTransaction({ classificationId: 'c1', entityId: 'ent-A', categoryId: 'cat-1', notes: 'hi', month: '2026-06', entitySlug: 'biz', suggestionOutcome: null });
    expect(res).toEqual({ success: true });
    expect(db.classifications[0].category_id).toBe('cat-1');
    expect(db.classifications[0].entity_id).toBe('ent-A');
  });
});
