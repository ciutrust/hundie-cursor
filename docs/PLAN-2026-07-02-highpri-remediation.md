# High-Priority Remediation Plan — hundie-cursor (2026-07-02)

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:subagent-driven-development` (or `executing-plans`) to implement each Work Package task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is structured for **parallel multi-agent (ultracode) execution**: one enabler package, then four independent lanes.

**Goal:** Fix the 8 "fix these first" findings from [REVIEW-2026-07-01.md](REVIEW-2026-07-01.md) §1 — the self-registration hole (S1), the three ledger-integrity silent-loss bugs (C1, C2, C3), missing CI + write-layer tests (T1, T2), and the destructive-script footguns (T3, C7).

**Architecture:** Each finding's fix extracts a **pure, unit-testable helper** where possible (matching the repo's `safe-redirect` / `resolveSyncFromDate` pattern), so security- and correctness-critical logic is covered by the offline Vitest suite rather than requiring a live DB. Work is grouped into 5 packages whose file sets are disjoint (except two trivially-mergeable `package.json` regions), so 4 of them run concurrently after CI lands.

**Tech Stack:** Next.js 16.2.9, React 19.2.7, TypeScript 6.0.3, Supabase (`@supabase/ssr` 0.12, authenticated-only RLS), Plaid 42.x, Vitest (offline, in-memory `fake-supabase.mjs` harness), Node 26.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Node runtime:** actual runtime is **Node v26**; scripts run bare `.ts` via `--experimental-strip-types` (unflagged since Node 23.6). Pin `engines.node` to `>=24`. Do **not** assume Node 20.
- **Ledger sign convention:** `positive = charge`, `negative = refund`. Plaid's raw sign is used **unflipped**. Never introduce a sign flip.
- **Single-tenant RLS:** every policy is `to authenticated using (true)`; there are **no `user_id` columns**. "authenticated == owner" is intentional. Do not add per-user predicates except where S1's *optional* defense-in-depth item explicitly calls for it.
- **This app is expense *management*, not tax/books.** "expense" = a tracked outflow. Do not reframe totals as deductible/Schedule E.
- **Live Supabase project `ihciuqpiavxhbulfkwod` (ciutrust org) is NOT reachable via the session's connected Supabase MCP.** Apply migrations via the Supabase dashboard SQL editor or the `supabase` CLI, or hand them to the operator. Never assume MCP can reach it.
- **Tests:** Vitest, fully offline. Add tests as `*.test.ts`; the default glob picks them up anywhere. Run `npm test` (`vitest run`), `npm run typecheck`, `npm run lint`. A package is "done" only when all three are green.
- **Branching:** repo normally goes direct-to-main, but land each WP as its own **PR/branch/worktree** so CI (WP1) gates it. Isolated git worktrees per lane avoid cross-lane collisions.

---

## Parallel execution map (ultracode dispatch)

| WP | Findings | Sev | Lane / subsystem | Effort | Runs |
|----|----------|-----|------------------|--------|------|
| **WP1** | T1 | High | CI enabler (`.github/`, `package.json` engines) | S | **FIRST — alone** |
| **WP2** | S1 | High | Auth lockdown (`login-form`, `lib/auth`) | S | parallel after WP1 |
| **WP3** | C1 + T2 | High | Proposals correctness + write-layer tests + harness | M–L | parallel after WP1 |
| **WP4** | C2 + C3 | High | Plaid ingestion integrity (`run-sync`, `map-accounts`, migration, UI) | M–L | parallel after WP1 |
| **WP5** | T3 + C7 | Med-High | Destructive-script safety (`package.json` scripts, cleanup + import-cards) | M | parallel after WP1 |

**Ordering rules:**
1. **WP1 lands first.** It creates CI (so WP2–5 arrive gated) and adds the `engines` field to `package.json` before WP5 edits the `scripts` block (different regions of the same file → trivial merge, but sequence avoids a hunk clash).
2. **WP2, WP3, WP4, WP5 then run fully in parallel** — their source files are mutually disjoint. Assign one ultracode agent (ideally one git worktree) per lane.
3. Within **WP3**, land the harness upgrade + reclassify/ai-suggestions tests, then C1's guard + proposals tests (same agent, ordered internally).
4. Within **WP4** and **WP5**, the two findings share files and are done by a single agent in one PR each.

**Cross-lane touchpoint to watch:** `package.json` is edited by WP1 (`engines`, top of file) and WP5 (`scripts`, middle). Land WP1 first; WP5 rebases cleanly.

---

## WP1 — CI enabler (T1)  ·  Severity: High  ·  Effort: S

**Why:** 213 tests pass offline in ~1.5s and gate nothing — there is no `.github/` at all. Any push can ship broken money logic.

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `package.json` (add `engines`, top of file — **not** the `scripts` block)
- Test: `tests/ci-workflow.test.ts`

**Operator actions (GitHub, not code):**
- After merge: repo Settings → Branches → add a protection rule on `main` requiring the **`CI / verify`** status check. Without it the workflow runs but does not *block* merges.
- Confirm the Actions tab shows a green `CI / verify` on the next PR.

### Task 1.1 — Add the CI workflow + engine pin (TDD)

- [ ] **Step 1 — Write the failing test** at `tests/ci-workflow.test.ts`:
```ts
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const root = process.cwd();
const workflowPath = path.join(root, ".github", "workflows", "ci.yml");

describe("T1 — CI gate parity", () => {
  test("a CI workflow file exists", () => {
    expect(existsSync(workflowPath)).toBe(true);
  });
  test("CI runs the offline gate scripts", () => {
    const yml = readFileSync(workflowPath, "utf8");
    expect(yml).toContain("npm ci");
    expect(yml).toContain("npm run typecheck");
    expect(yml).toContain("npm run lint");
    expect(yml).toContain("npm test");
  });
  test("referenced gate scripts exist in package.json", () => {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    expect(pkg.scripts.typecheck).toBeTruthy();
    expect(pkg.scripts.lint).toBeTruthy();
    expect(pkg.scripts.test).toBe("vitest run");
  });
  test("package.json pins a Node engine", () => {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    expect(pkg.engines?.node).toBeTruthy();
  });
});
```
- [ ] **Step 2 — Run it, verify it fails** (`npx vitest run tests/ci-workflow.test.ts`) — expect FAIL: workflow file does not exist.
- [ ] **Step 3 — Create `.github/workflows/ci.yml`:**
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 26
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
```
- [ ] **Step 4 — Add `engines` to `package.json`** immediately after the top-level `"type": "module",` line (preserve two-space indent):
```json
  "type": "module",
  "engines": {
    "node": ">=24"
  },
  "scripts": {
```
- [ ] **Step 5 — Run the full gate** (`npm run typecheck && npm run lint && npm test`) — all green; new test passes.
- [ ] **Step 6 — Commit:** `git commit -m "ci: add GitHub Actions gate (typecheck+lint+vitest) and pin Node engine"`

**Notes / risks:** `lint` stays exit-0 despite the 10 pre-existing `react-hooks/set-state-in-effect` warnings (intentional). Do **not** add `--max-warnings=0` (out of scope; would fail today). CI intentionally does not run `next build` (needs secrets). `npm ci` requires the existing `package-lock.json`; the `engines` edit doesn't touch the lock.

---

## WP2 — Auth lockdown (S1)  ·  Severity: High  ·  Effort: S

**Why:** `signInWithOtp` has no `shouldCreateUser: false`, so the magic-link path is an open self-registration endpoint; every RLS policy trusts any `authenticated` JWT, and middleware only checks `if (!user)`. One dashboard toggle away from total-ledger exposure (read **and** write).

**Files:**
- Create: `lib/auth/sign-in-options.ts`, `lib/auth/sign-in-options.test.ts`
- Modify: `components/auth/login-form.tsx` (the `signInWithOtp` call, ~lines 34-39), `docs/SUPABASE.md`

**Operator actions (authoritative fix — the code below is defense-in-depth):**
- Supabase dashboard → project `ihciuqpiavxhbulfkwod` → Authentication → Providers → Email → set **"Allow new users to sign up" = OFF**. This stops signups even via direct REST/SDK calls that bypass the app.
- Authentication → Users → audit the list; confirm **only** the two intended accounts exist. Delete any unexpected self-registered users.
- Smoke test: login page → "Use magic link instead" → enter a NON-registered email → submit → expect an error / no link delivered.
- *Optional, deferred (do NOT bundle):* an email-allowlist RLS migration replacing `using (true)` with `using ((auth.jwt() ->> 'email') in (...))`. Higher-risk (a typo locks out a real user); only if explicitly prioritized.

### Task 2.1 — Extract a testable OTP-options helper with `shouldCreateUser: false` (TDD)

- [ ] **Step 1 — Write the failing test** at `lib/auth/sign-in-options.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { magicLinkOtpOptions } from "@/lib/auth/sign-in-options";

describe("magicLinkOtpOptions (S1: no self-registration)", () => {
  it("disables user creation on the magic-link path", () => {
    const opts = magicLinkOtpOptions("https://app.example.com", "/review");
    expect(opts.shouldCreateUser).toBe(false);
  });
  it("builds the auth callback redirect with the encoded redirect path", () => {
    const opts = magicLinkOtpOptions("https://app.example.com", "/review/gbsl");
    expect(opts.emailRedirectTo).toBe(
      "https://app.example.com/auth/callback?redirect=%2Freview%2Fgbsl",
    );
  });
});
```
- [ ] **Step 2 — Run it, verify it fails** — module does not exist.
- [ ] **Step 3 — Create `lib/auth/sign-in-options.ts`:**
```ts
import type { SignInWithPasswordlessCredentials } from "@supabase/supabase-js";

type OtpOptions = NonNullable<
  Extract<SignInWithPasswordlessCredentials, { email: string }>["options"]
>;

/**
 * Options for the magic-link (OTP) sign-in. shouldCreateUser is FALSE: this app is
 * single-tenant (allowlisted sign-ins only), so an OTP request for an unknown email
 * must fail rather than self-register a new authenticated user (every RLS policy today
 * trusts any authenticated JWT).
 */
export function magicLinkOtpOptions(origin: string, redirectTo: string): OtpOptions {
  return {
    shouldCreateUser: false,
    emailRedirectTo: `${origin}/auth/callback?redirect=${encodeURIComponent(redirectTo)}`,
  };
}
```
- [ ] **Step 4 — Wire it into `components/auth/login-form.tsx`.** Add the import (after the existing imports) and replace the inline options on the `signInWithOtp` call:
```ts
import { magicLinkOtpOptions } from "@/lib/auth/sign-in-options";

// in the magic-link branch, replace the signInWithOtp options:
      const { error: signInError } = await supabase.auth.signInWithOtp({
        email,
        options: magicLinkOtpOptions(window.location.origin, redirectTo),
      });
```
- [ ] **Step 5 — Run gate** (`npm run typecheck && npm run lint && npm test`) — green.
- [ ] **Step 6 — Commit:** `git commit -m "fix(auth): disable self-registration on magic-link sign-in (S1)"`

### Task 2.2 — Document the allowlist model

- [ ] **Step 1 — Add to `docs/SUPABASE.md`** under the RLS section:
```markdown
### Self-signup is disabled (allowlist model)

RLS trusts *any* authenticated JWT (`USING (true)`), so who can obtain a JWT is the real trust boundary. Sign-in is allowlist-only:

- **Client:** `login-form.tsx` sends magic links via `magicLinkOtpOptions()` (`lib/auth/sign-in-options.ts`) with `shouldCreateUser: false` — an OTP request for an unknown email fails instead of creating a user.
- **Dashboard:** Authentication → Providers → Email → **"Allow new users to sign up" = OFF** (project `ihciuqpiavxhbulfkwod`). Verified 2026-07-02.

Until per-user RLS exists (no `user_id` columns yet), do NOT enable signups. Adding a user = invite from the dashboard only.
```
- [ ] **Step 2 — Commit:** `git commit -m "docs(supabase): record allowlist/self-signup-disabled model (S1)"`

**Risk:** very low. `shouldCreateUser:false` only changes behavior for *unknown* emails (they now correctly fail); existing users still get links. The password path (`signInWithPassword`) is unaffected.

---

## WP3 — Proposals correctness + write-layer tests (C1 + T2)  ·  Severity: High  ·  Effort: M–L

**Why:**
- **C1:** `commitApprovedProposals` upserts every approved proposal wholesale on `transaction_id` with no freshness check — silently overwriting any classification a human made in `/review` since the proposal was generated, and wiping notes (`notes: rationale ?? null`). The history trigger only logs entity/category diffs, so a notes wipe is **invisible**.
- **T2:** `lib/actions/` (the only code that writes real classifications, incl. the service-role bulk committer) has **zero tests**.

These share `lib/actions/proposals.ts` (C1 fixes it, T2 tests it) and a **shared harness upgrade** → one lane, one agent.

**Files:**
- Modify: `lib/actions/proposals.ts` (C1), `tests/helpers/fake-supabase.mjs` (T2 harness upgrade)
- Create: `tests/proposals-commit-plan.test.ts` (C1 helper unit test), `lib/actions/__tests__/proposals.test.ts`, `lib/actions/__tests__/reclassify.test.ts`, `lib/actions/__tests__/ai-suggestions.test.ts` (T2)

**Operator action:** Before deploying C1, confirm `classification_proposals.status` permits `'skipped'`. Grep `supabase/migrations/*_create_classification_proposals.sql` (and later migrations) for a `CHECK` on `status`. If a CHECK excludes `'skipped'`, either add a migration to allow it or reuse an existing terminal status in the stale-retire step.

**Harness limitation (drives the test design):** `tests/helpers/fake-supabase.mjs` `upsert` implements **only ignore-on-conflict** (skips existing rows) — it cannot model update-on-conflict, so an end-to-end fake test **cannot observe** the C1 overwrite. That is why C1 is tested via an **extracted pure helper**. The `lib/actions` server actions import their own client internally, so tests use the **`vi.doMock` + dynamic `import()`** pattern (as in `lib/queries/ai-suggestions.test.ts`), not client injection.

### Task 3.1 — Upgrade the fake-Supabase harness (unblocks all lib/actions tests)

- [ ] **Step 1 — Generalize table seeding** in `tests/helpers/fake-supabase.mjs` (the constructor currently hardcodes 4 tables and drops the rest):
```js
export function makeFakeSupabase(initial = {}) {
  const db = {
    transactions: (initial.transactions ?? []).map((r) => ({ ...r })),
    classifications: (initial.classifications ?? []).map((r) => ({ ...r })),
    import_batches: (initial.import_batches ?? []).map((r) => ({ ...r })),
    raw_import_rows: (initial.raw_import_rows ?? []).map((r) => ({ ...r })),
  };
  // Seed any additional tables the caller provides (categories, entities,
  // classification_proposals, suggestion_events, ai_suggestions, ...).
  for (const [t, rows] of Object.entries(initial)) {
    if (!(t in db)) db[t] = (rows ?? []).map((r) => ({ ...r }));
  }
```
- [ ] **Step 2 — Add `maybeSingle()`** to the query builder (right after `single()`), since `reclassify` uses it:
```js
      maybeSingle() {
        this._single = true;
        return this;
      },
```
- [ ] **Step 3 — Run existing suite** (`npm test`) — confirm no regression in the 213 existing tests.
- [ ] **Step 4 — Commit:** `git commit -m "test(harness): generic table seeding + maybeSingle in fake-supabase (T2)"`

### Task 3.2 — T2 tests for reclassify + ai-suggestions (current behavior)

- [ ] **Step 1 — Create `lib/actions/__tests__/reclassify.test.ts`:**
```ts
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
```
- [ ] **Step 2 — Create `lib/actions/__tests__/ai-suggestions.test.ts`:**
```ts
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
```
> If a mocked boundary differs from the real import path (e.g. `reclassify`/`ai-suggestions` import `createClient` from a different module than `@/lib/supabase/server`), open the source file and match the exact specifier in `vi.doMock`. The two guards under test are stable; only the mock target may need adjusting.
- [ ] **Step 3 — Run** (`npx vitest run lib/actions`) — both pass. **Commit:** `git commit -m "test(actions): cover reclassify + acceptAiSuggestions write paths (T2)"`

### Task 3.3 — C1: freshness guard in `commitApprovedProposals` (TDD, pure helper)

- [ ] **Step 1 — Write the failing test** at `tests/proposals-commit-plan.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { partitionCommitPlan } from "@/lib/actions/proposals";

const cand = (over: Record<string, unknown> = {}) => ({
  proposalId: "p1", transactionId: "t1", entityId: "e1", categoryId: "c-proposed",
  rationale: "training says meals", source: "training", description: "CHIPOTLE", vendor: null, ...over,
});

describe("partitionCommitPlan", () => {
  it("writes a still-unclassified import row", () => {
    const existing = new Map([["t1", { category_id: null, classified_by: "import", notes: null }]]);
    const { toWrite, staleProposalIds } = partitionCommitPlan([cand()] as never, existing as never);
    expect(staleProposalIds).toEqual([]);
    expect(toWrite).toHaveLength(1);
    expect(toWrite[0].categoryId).toBe("c-proposed");
  });
  it("skips a txn already given a category (interim manual classification)", () => {
    const existing = new Map([["t1", { category_id: "c-manual", classified_by: "alex@example.com", notes: "keep me" }]]);
    const { toWrite, staleProposalIds } = partitionCommitPlan([cand()] as never, existing as never);
    expect(toWrite).toEqual([]);
    expect(staleProposalIds).toEqual(["p1"]);
  });
  it("skips a txn whose classifier is non-machine even when category is still null", () => {
    const existing = new Map([["t1", { category_id: null, classified_by: "alex@example.com", notes: null }]]);
    const { toWrite, staleProposalIds } = partitionCommitPlan([cand()] as never, existing as never);
    expect(toWrite).toEqual([]);
    expect(staleProposalIds).toEqual(["p1"]);
  });
  it("never overwrites an existing note with null when the row IS writable", () => {
    const existing = new Map([["t1", { category_id: null, classified_by: "import", notes: "prior note" }]]);
    const { toWrite } = partitionCommitPlan([cand({ rationale: null })] as never, existing as never);
    expect(toWrite[0].keepNote).toBe("prior note");
  });
  it("writes when there is no existing classification row at all", () => {
    const { toWrite, staleProposalIds } = partitionCommitPlan([cand()] as never, new Map() as never);
    expect(staleProposalIds).toEqual([]);
    expect(toWrite[0].keepNote).toBe("training says meals");
  });
});
```
- [ ] **Step 2 — Run it, verify it fails** — `partitionCommitPlan` not exported.
- [ ] **Step 3 — Add the pure helper** to `lib/actions/proposals.ts`, above `commitApprovedProposals`:
```ts
// Provenance values meaning "machine placeholder, safe to overwrite". Anything else (a user email,
// qb_backfill, refund_backfill, etc.) is a real classification we must not clobber.
const OVERWRITABLE_CLASSIFIERS = new Set(["import", "import-heal"]);

type ExistingClass = { category_id: string | null; classified_by: string | null; notes: string | null };

type CommitCandidate = {
  proposalId: string; transactionId: string; entityId: string; categoryId: string;
  rationale: string | null; source: string; description: string; vendor: string | null;
};

/** Guard against clobbering interim manual work: skip any candidate whose transaction already has a
 *  non-null category or a non-machine classifier, and never overwrite an existing note with null. */
export function partitionCommitPlan(
  candidates: CommitCandidate[],
  existingByTx: Map<string, ExistingClass>,
): { toWrite: (CommitCandidate & { keepNote: string | null })[]; staleProposalIds: string[] } {
  const toWrite: (CommitCandidate & { keepNote: string | null })[] = [];
  const staleProposalIds: string[] = [];
  for (const c of candidates) {
    const existing = existingByTx.get(c.transactionId);
    const protectedRow =
      !!existing &&
      (existing.category_id != null ||
        !OVERWRITABLE_CLASSIFIERS.has(existing.classified_by ?? "import"));
    if (protectedRow) { staleProposalIds.push(c.proposalId); continue; }
    const keepNote = existing?.notes ?? c.rationale ?? null;
    toWrite.push({ ...c, keepNote });
  }
  return { toWrite, staleProposalIds };
}
```
- [ ] **Step 4 — Run the helper test** — passes.
- [ ] **Step 5 — Wire the guard into `commitApprovedProposals`.** After the existing `plan` build loop and before the upsert, read current state, partition, retire stale proposals. (Hoist the existing `const now` / `const CHUNK` above this block.)
```ts
  if (plan.length === 0) return { error: `Nothing valid to commit (${skipped} skipped)` };

  const now = new Date().toISOString();
  const CHUNK = 500;

  // Freshness guard: re-read the current classification for each candidate txn so we never clobber
  // manual work done AFTER the proposal was generated (the history trigger wouldn't even log a
  // notes-only wipe). Batched IN() reads to stay within URL limits.
  const txIds = plan.map((x) => x.transactionId);
  const existingByTx = new Map<string, ExistingClass>();
  for (let i = 0; i < txIds.length; i += CHUNK) {
    const { data: exRows, error: exErr } = await admin
      .from("classifications")
      .select("transaction_id, category_id, classified_by, notes")
      .in("transaction_id", txIds.slice(i, i + CHUNK));
    if (exErr) return { error: `classification read failed: ${exErr.message}` };
    for (const r of exRows ?? [])
      existingByTx.set(r.transaction_id, { category_id: r.category_id, classified_by: r.classified_by, notes: r.notes });
  }

  const { toWrite, staleProposalIds } = partitionCommitPlan(plan, existingByTx);
  skipped += staleProposalIds.length;

  // Retire stale proposals so they don't linger as 'approved' and get retried next commit.
  for (let i = 0; i < staleProposalIds.length; i += CHUNK) {
    const ids = staleProposalIds.slice(i, i + CHUNK);
    const { error: skErr } = await admin
      .from("classification_proposals")
      .update({ status: "skipped", updated_at: now })
      .in("id", ids);
    if (skErr) return { error: `proposal skip update failed: ${skErr.message}` };
  }

  if (toWrite.length === 0) return { error: `Nothing valid to commit (${skipped} skipped)` };
```
- [ ] **Step 6 — Replace the three downstream `plan` references with `toWrite`** (the upsert-payload loop, the proposal→committed status update, the suggestion-events map), and change the upsert `notes` field:
```ts
      notes: x.keepNote, // was: x.rationale ?? null — never overwrite an interim manual note with null
```
Also change the success return count to `toWrite.length`.
- [ ] **Step 7 — Add the C1 end-to-end case to `lib/actions/__tests__/proposals.test.ts`** (created below) asserting a human-authored classification is not overwritten. Create that file now with the adapter (it hydrates the `transactions!inner(...)` join the commit selects and adds `auth.getUser`):
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeFakeSupabase } from '../../../tests/helpers/fake-supabase.mjs';

afterEach(() => { vi.resetModules(); vi.restoreAllMocks(); });

function makeClient(initial) {
  const sb = makeFakeSupabase(initial);
  const origFrom = sb.from.bind(sb);
  const from = (t) => {
    const q = origFrom(t);
    if (typeof q.maybeSingle !== 'function') q.maybeSingle = function () { this._single = true; return this; };
    const origSelect = q.select.bind(q);
    q.select = function (cols) {
      const m = cols.match(/,?\s*([a-z_]+)!inner\(([^)]*)\)/);
      if (m) { this._join = { table: m[1], cols: m[2].split(',').map((c) => c.trim()) }; cols = cols.replace(m[0], '').replace(/^,|,\s*$/g, ''); }
      return origSelect(cols);
    };
    const origThen = q.then.bind(q);
    q.then = function (resolve, reject) {
      return origThen((res) => {
        if (this._join && Array.isArray(res.data)) {
          const j = this._join; const fk = j.table.replace(/s$/, '') + '_id';
          res = { ...res, data: res.data.map((row) => { const jr = (sb.db[j.table] || []).find((x) => x.id === row[fk]); const proj = {}; for (const c of j.cols) proj[c] = jr ? jr[c] : null; return { ...row, [j.table]: jr ? proj : null }; }) };
        }
        return resolve(res);
      }, reject);
    };
    return q;
  };
  return { client: { from, auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'u@x.com' } }, error: null }) } }, db: sb.db };
}

function seed(overrides = {}) {
  return makeClient({
    categories: [{ id: 'cat-A', entity_id: 'ent-A' }],
    transactions: [{ id: 'tx-1', description: 'COFFEE', vendor: null }],
    classifications: [],
    classification_proposals: [{ id: 'p-1', transaction_id: 'tx-1', entity_id: 'ent-A', chosen_entity_id: null, source: 'confirmed_history', proposed_category_id: 'cat-A', chosen_category_id: null, rationale: 'seen', status: 'approved', entity_slug: 'ent-a', ...overrides }],
    suggestion_events: [],
  });
}

function mockAll(client) {
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
    expect(db.classifications.find((c) => c.transaction_id === 'tx-1').notes).toBe('mine');
    expect(db.classification_proposals[0].status).toBe('skipped');
  });
});
```
> The `count`/`skipped` shape in the first case must match the real return object — align the assertion with `commitApprovedProposals`'s actual success payload after Step 6.
- [ ] **Step 8 — Run** (`npx vitest run lib/actions tests/proposals-commit-plan.test.ts`) — all green. **Commit:** `git commit -m "fix(proposals): freshness guard so commit never overwrites manual work or wipes notes (C1) + tests (T2)"`

**Risks:** adds a batched read before the upsert (negligible). The stale-retire writes `status='skipped'` — verify the CHECK (operator action). `OVERWRITABLE_CLASSIFIERS` must track any script that seeds placeholder rows; an unknown value is treated as protected (fail-safe: conservative skip, no data loss).

---

## WP4 — Plaid ingestion integrity (C2 + C3)  ·  Severity: High  ·  Effort: M–L

**Why:**
- **C2:** unmapped-account transactions are `continue`d away while the forward-only cursor advances → permanent silent drop; mapping the account later never resets the cursor.
- **C3:** `bank_connections.sync_from_date` falls to the `current_date` column default, silently excluding the window between CSV end and Plaid link.

Both edit `app/api/plaid/map-accounts/route.ts` (C2 cursor-reset + C3 cutover) → **one agent, one PR.** Locate edit sites by anchor, not line number (lines shift as you edit).

**Files:**
- Modify: `lib/plaid/run-sync.ts` (C2), `app/api/plaid/map-accounts/route.ts` (C2 + C3), `app/settings/connections/connect-bank.tsx` (C3 UI), `supabase/migrations/20260702120000_create_bank_connections.sql` (C3, fresh-DB consistency)
- Create: `supabase/migrations/20260702130000_bank_connections_drop_sync_from_default.sql` (C3, live-DB fix), `tests/run-sync-helpers.test.ts` (C2), `tests/map-accounts-cutover.test.ts` (C3)

**Operator actions:**
- Apply migration `20260702130000` to live project `ihciuqpiavxhbulfkwod` via dashboard SQL editor / `supabase` CLI (**not** via the connected MCP).
- **C2 remediation** for connections mapped *after* their first sync: `UPDATE bank_connections SET sync_cursor = NULL WHERE id = '<conn>';` then re-sync. The re-pull is bounded by `sync_from_date`, so set that first if you need history.
- **C3 remediation** for already-linked connections whose `sync_from_date` was silently the link date: `UPDATE bank_connections SET sync_from_date = '<CSV-last-date + 1>' WHERE id = '<conn>';` **before** the next sync.
- Before shipping the `needs_mapping` status, grep for any code that `switch`/matches on `bank_connections.status` (free-text column, so no migration, but callers may assume a fixed set).
- Surface `needs_mapping` + `result.error` wherever `SyncSummary.connections` renders, so the operator sees the named unmapped accounts and the held cutover.

### Task 4.1 — C2: gate the cursor advance on all accounts being mapped (TDD)

- [ ] **Step 1 — Write the failing test** at `tests/run-sync-helpers.test.ts`:
```ts
import { unmappedPlaidAccountIds } from "@/lib/plaid/run-sync";

describe("C2 — unmappedPlaidAccountIds (cursor-advance gate)", () => {
  const linkMap = new Map<string, string>([["plaid-A", "acct-1"], ["plaid-B", "acct-2"]]);
  test("flags an incoming Plaid account with no link", () => {
    expect(unmappedPlaidAccountIds(["plaid-A", "plaid-Z"], linkMap)).toEqual(["plaid-Z"]);
  });
  test("returns empty when every incoming account is mapped (safe to advance cursor)", () => {
    expect(unmappedPlaidAccountIds(["plaid-A", "plaid-B"], linkMap)).toEqual([]);
  });
  test("dedupes repeated unmapped ids", () => {
    expect(unmappedPlaidAccountIds(["plaid-Z", "plaid-Z"], linkMap)).toEqual(["plaid-Z"]);
  });
});
```
- [ ] **Step 2 — Run it, verify it fails.**
- [ ] **Step 3 — Add the pure helper** to `lib/plaid/run-sync.ts`:
```ts
/**
 * C2: /transactions/sync is forward-only — a dropped `added` row never re-delivers. If any incoming
 * Plaid account id is unmapped (no plaid_account_links row) we must NOT advance the cursor, or those
 * rows are permanently lost. Returns the unmapped Plaid account ids (empty = safe to persist cursor).
 */
export function unmappedPlaidAccountIds(
  incomingPlaidAccountIds: Iterable<string>,
  accountIdByPlaid: Map<string, string>,
): string[] {
  const unmapped = new Set<string>();
  for (const id of incomingPlaidAccountIds) {
    if (!accountIdByPlaid.has(id)) unmapped.add(id);
  }
  return [...unmapped];
}
```
- [ ] **Step 4 — Run helper test — passes.**
- [ ] **Step 5 — Compute unmapped ids + zero-link skip** right after the `byPlaidAccount` map is built (before the per-account loop):
```ts
const connectionHasLinks = (accountIdsByConnection.get(conn.id) ?? []).length > 0;
const unmapped = unmappedPlaidAccountIds(byPlaidAccount.keys(), accountIdByPlaid);
if (!connectionHasLinks && byPlaidAccount.size > 0) {
  // Zero links yet: don't burn the initial full-sync cursor page — leave cursor untouched so a
  // later map-accounts run can still ingest this history.
  result.status = "needs_mapping";
  result.error = `${byPlaidAccount.size} Plaid account(s) not yet mapped — sync deferred until accounts are linked.`;
  summary.connections.push(result);
  continue;
}
```
> Confirm the exact name of the connection→accountIds map (`accountIdsByConnection`) and the per-connection `result`/`summary` locals by reading the surrounding code; adjust identifiers to match.
- [ ] **Step 6 — Gate the cursor-persistence block** (anchor: the `.update({ sync_cursor: synced.data.cursor, ... })` on `bank_connections`). Replace the unconditional update with:
```ts
if (unmapped.length === 0) {
  await admin
    .from("bank_connections")
    .update({ sync_cursor: synced.data.cursor, last_synced_at: new Date().toISOString(), status: "healthy", updated_at: new Date().toISOString() })
    .eq("id", conn.id);
  result.status = "healthy";
} else {
  // C2: do NOT advance the forward-only cursor — dropped rows would never re-deliver. Hold the
  // cursor so the next sync (after the operator maps these accounts) re-delivers the same window.
  await admin
    .from("bank_connections")
    .update({ status: "needs_mapping", updated_at: new Date().toISOString() })
    .eq("id", conn.id);
  result.status = "needs_mapping";
  result.error = `Unmapped Plaid account(s): ${unmapped.join(", ")}. Cursor held — map these accounts, then re-sync.`;
  console.warn(`  ${conn.id}: ${result.error}`);
}
```
- [ ] **Step 7 — Run gate — green. Commit:** `git commit -m "fix(plaid): hold forward-only cursor when accounts are unmapped (C2)"`

### Task 4.2 — C3: derive the Plaid cutover from the ledger (TDD)

- [ ] **Step 1 — Write the failing test** at `tests/map-accounts-cutover.test.ts` (mirrors the derivation the route runs; if you extract an exported helper, import it instead):
```ts
import { describe, expect, test } from "vitest";
import { makeFakeSupabase } from "./helpers/fake-supabase.mjs";

async function deriveCutoverDate(admin: any, accountIds: string[]): Promise<string | null> {
  const { data } = await admin
    .from("transactions").select("transaction_date")
    .in("account_id", accountIds).order("transaction_date", { ascending: false }).range(0, 0);
  const maxDate = data?.[0]?.transaction_date as string | undefined;
  if (!maxDate) return null;
  const d = new Date(`${maxDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

describe("C3 — Plaid cutover derivation", () => {
  test("returns MAX(transaction_date)+1 across the mapped accounts", async () => {
    const sb: any = makeFakeSupabase({ transactions: [
      { id: "t1", account_id: "acct-1", transaction_date: "2026-06-10" },
      { id: "t2", account_id: "acct-1", transaction_date: "2026-06-30" },
      { id: "t3", account_id: "acct-2", transaction_date: "2026-05-01" },
    ]});
    expect(await deriveCutoverDate(sb, ["acct-1", "acct-2"])).toBe("2026-07-01");
  });
  test("returns null when no ledger rows exist (run-sync null-guard then applies)", async () => {
    const sb: any = makeFakeSupabase({ transactions: [] });
    expect(await deriveCutoverDate(sb, ["acct-1"])).toBeNull();
  });
  test("crosses a month boundary", async () => {
    const sb: any = makeFakeSupabase({ transactions: [{ id: "t1", account_id: "acct-1", transaction_date: "2026-01-31" }] });
    expect(await deriveCutoverDate(sb, ["acct-1"])).toBe("2026-02-01");
  });
});
```
- [ ] **Step 2 — Run it — passes with the mirrored helper** (this test locks the derivation contract; it fails only if the route later diverges). Prefer extracting `deriveCutoverDate(admin, accountIds)` into `lib/plaid/cutover.ts` and importing it in both the test and the route.
- [ ] **Step 3 — In `app/api/plaid/map-accounts/route.ts`**, accept an optional `cutoverDate` in the body; after validating links and **before** the `plaid_account_links` upsert, derive the cutover; after a successful upsert, persist it onto `bank_connections.sync_from_date` **only when currently null** (so re-mapping never silently moves an established cutover). Also apply C2's cursor reset here (belt-and-suspenders for connections whose cursor advanced before the WP4 fix shipped):
```ts
// body type gains: cutoverDate?: string | null

let cutoverDate: string | null =
  typeof body.cutoverDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.cutoverDate) ? body.cutoverDate : null;
if (!cutoverDate) {
  const { data: latest } = await admin
    .from("transactions").select("transaction_date")
    .in("account_id", accountIds).order("transaction_date", { ascending: false }).range(0, 0);
  const maxDate = latest?.[0]?.transaction_date as string | undefined;
  if (maxDate) {
    const d = new Date(`${maxDate}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    cutoverDate = d.toISOString().slice(0, 10);
  }
}

// ...after the successful plaid_account_links upsert, before the final response:
if (cutoverDate) {
  await admin
    .from("bank_connections")
    .update({ sync_from_date: cutoverDate, updated_at: new Date().toISOString() })
    .eq("id", body.connectionId)
    .is("sync_from_date", null);
}
// C2: a link added after an earlier sync can't recover already-passed transactions unless the
// forward-only cursor is reset. Null it so the next sync re-pulls from sync_from_date.
await admin
  .from("bank_connections")
  .update({ sync_cursor: null, updated_at: new Date().toISOString() })
  .eq("id", body.connectionId);

return NextResponse.json({ linked: rows.length, cutoverDate });
```
> `accountIds` is the list of mapped Hundie account ids — confirm the exact local name in the route (it builds `rows` from `valid.map(...)`). Reuse that array.
- [ ] **Step 4 — Create the live-DB migration** `supabase/migrations/20260702130000_bank_connections_drop_sync_from_default.sql`:
```sql
-- The current_date default silently set the Plaid cutover to the LINK date, dropping the gap
-- between the CSV's last row and the link date. The cutover is now derived in map-accounts as
-- MAX(transaction_date)+1 of the mapped accounts (or an operator override). Remove the default so
-- an unmapped connection stays NULL and run-sync's null-guard (fall back to today + warn) applies.
alter table bank_connections alter column sync_from_date drop default;
```
- [ ] **Step 5 — Keep fresh DBs consistent:** in `supabase/migrations/20260702120000_create_bank_connections.sql`, change `sync_from_date date default current_date,` to `sync_from_date date,` and update the adjacent comment to say the cutover is set by map-accounts, not the DB default.
- [ ] **Step 6 — Add the cutover input** to the mapping step in `app/settings/connections/connect-bank.tsx`:
```tsx
const [cutoverDate, setCutoverDate] = useState<string>("");

// in saveMapping(), extend the POST body:
body: JSON.stringify({ connectionId: exchange.connectionId, links, cutoverDate: cutoverDate || null }),

// in the mapping JSX (inside the `if (exchange)` block):
<label className="flex flex-col gap-1 text-sm">
  <span className="font-medium">Plaid start date (cutover)</span>
  <input type="date" value={cutoverDate} onChange={(e) => setCutoverDate(e.target.value)}
    className="rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
  <span className="text-muted-foreground">
    Leave blank to start the day after the last imported transaction for the mapped accounts.
  </span>
</label>
```
- [ ] **Step 7 — Run gate — green. Commit:** `git commit -m "fix(plaid): derive CSV→Plaid cutover from ledger + reset cursor on remap (C3+C2)"`

**Risks:** keep the UTC `${maxDate}T00:00:00.000Z` + `setUTCDate` form (avoids off-by-one). Persisting only when null means a wrong first mapping can't be corrected by re-mapping alone (operator clears it or passes an override) — acceptable, safer than silently moving cutovers. The cursor reset re-processes a window on each remap; the pipeline dedupes via `external_id`, so no double-count. If a connection has Plaid accounts that will *never* be mapped, the C2 hold blocks its syncs forever — document that every returned Plaid account must be mapped (future: an operator "ignore" flag).

---

## WP5 — Destructive-script safety (T3 + C7)  ·  Severity: Med-High  ·  Effort: M

**Why:**
- **T3:** bare `npm run cleanup:ledger-dupes` (and the import family) map to `--apply`; dry-run is the opt-in suffix — inverted from convention. `import-cards.mjs` defaults `dryRun:false`. Muscle-memory data loss.
- **C7:** `cleanup-ledger-duplicates.mjs` groups only by the coarse business key (ignores `import_hash`/`external_id`) and hard-DELETEs all but one — destroying genuine same-day/same-amount charges that BUG-03 deliberately preserved. Also paginates on a non-unique sort.

Both edit `scripts/cleanup-ledger-duplicates.mjs`, `package.json`, and `tests/cleanup-ledger-duplicates.test.ts` → **one agent, one PR.** Land the T3 safe-default first (or together) so C7's deletion-logic changes are never exposed behind a bare `--apply`.

**Files:**
- Modify: `package.json` (scripts), `scripts/import-cards.mjs` (T3), `scripts/cleanup-ledger-duplicates.mjs` (T3 export + C7 logic), `tests/cleanup-ledger-duplicates.test.ts` (extend)
- Create: `tests/import-cards-args.test.ts`
- Docs sweep: `RUN.md`, `docs/SUPABASE.md`, `docs/STAGE2-RUNBOOK.md`, `docs/STAGE2-MIGRATION-AUDIT.md`, `docs/OVERNIGHT_HANDOFF.md`, `docs/CLASSIFICATION.md`, `docs/CHANGELOG.md`

**Operator action:** before running `cleanup:ledger-dupes:apply` on prod, take a fresh backup (`scripts/export-ledger-backup.mjs`). After the C7 fix, re-run in dry-run and confirm "Rows to delete" **drops** vs. before.

### Task 5.1 — C7: make cleanup occurrence-/external_id-aware + stable pagination (TDD)

- [ ] **Step 1 — Extend `tests/cleanup-ledger-duplicates.test.ts`** (it already imports from the same `.mjs`):
```ts
import { describe, expect, it } from "vitest";
import { chooseDuplicateKeeper, groupDuplicates } from "../scripts/cleanup-ledger-duplicates.mjs";
import { buildTransactionHash, withOccurrence } from "../scripts/lib/import-hash.mjs";

describe("groupDuplicates — C7 genuine-charge preservation", () => {
  const h = buildTransactionHash({ accountId: "acct-1", transactionDate: "2026-06-01", amount: 5, description: "COFFEE" });
  const mk = (id, importHash, extra = {}) => ({
    id, account_id: "acct-1", transaction_date: "2026-06-01", amount: 5, description: "COFFEE",
    import_hash: importHash, external_id: null, created_at: "2026-06-25T00:00:00Z", ...extra,
  });

  it("keeps BOTH genuine same-day charges (distinct occurrence-suffixed hashes) — no duplicate group", () => {
    expect(groupDuplicates([mk("a", h), mk("b", withOccurrence(h, 1))])).toHaveLength(0);
  });
  it("does NOT collapse two distinct Plaid charges sharing a business key (distinct external_id)", () => {
    const groups = groupDuplicates([
      mk("p1", buildTransactionHash({ accountId: "acct-1", transactionDate: "2026-06-01", amount: 5, description: "COFFEE", issuerReference: "plaid-1" }), { external_id: "plaid-1" }),
      mk("p2", buildTransactionHash({ accountId: "acct-1", transactionDate: "2026-06-01", amount: 5, description: "COFFEE", issuerReference: "plaid-2" }), { external_id: "plaid-2" }),
    ]);
    expect(groups).toHaveLength(0);
  });
  it("still collapses TRUE duplicates sharing the same import_hash", () => {
    const groups = groupDuplicates([mk("keep", h), mk("del", h)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
    expect(chooseDuplicateKeeper(groups[0]).id).toBeDefined();
  });
  it("still collapses legacy pre-hash duplicates (null import_hash) via the business-key fallback", () => {
    expect(groupDuplicates([mk("a", null), mk("b", null)])).toHaveLength(1);
  });
});
```
- [ ] **Step 2 — Run it, verify it fails** (`groupDuplicates` not exported / still collapses genuine charges).
- [ ] **Step 3 — Rewrite + export `groupDuplicates`** in `scripts/cleanup-ledger-duplicates.mjs`:
```js
function distinctExternalIds(group) {
  return new Set(group.map((tx) => tx.external_id).filter((v) => v != null)).size;
}

// C7/BUG-03: identity is the import_hash — the SAME key idempotent import uses. Occurrence-suffixed CSV
// charges and distinct Plaid txns already have distinct hashes, so two genuine same-day/same-amount
// charges land in DIFFERENT buckets and both survive. Only hash-less legacy rows fall back to the
// coarse business key.
export function groupDuplicates(transactions) {
  const groups = new Map();
  for (const tx of transactions) {
    const key =
      tx.import_hash ??
      `nohash:${buildTransactionDedupeKey({
        accountId: tx.account_id, transactionDate: tx.transaction_date, amount: tx.amount, description: tx.description,
      })}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(tx);
    groups.set(key, bucket);
  }
  return [...groups.values()].filter((group) => group.length > 1 && distinctExternalIds(group) <= 1);
}
```
- [ ] **Step 4 — Select `external_id` + stable sort** in `fetchTransactions`: add `external_id,` to the SELECT and replace `.order("transaction_date", { ascending: true })` with `.order("id")` (mirrors the BUG-05 fix in `scripts/lib/ledger-import.mjs`).
- [ ] **Step 5 — Run gate — green. Commit:** `git commit -m "fix(cleanup): key dedupe on import_hash + external_id, stable pagination (C7)"`

### Task 5.2 — T3: invert destructive defaults to dry-run (TDD)

- [ ] **Step 1 — Write the failing test** at `tests/import-cards-args.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseArgs } from "../scripts/import-cards.mjs";

describe("import-cards parseArgs", () => {
  it("defaults to dry-run when no write flag is given", () => {
    expect(parseArgs(["node", "import-cards.mjs", "--all"]).dryRun).toBe(true);
  });
  it("only writes when --apply is passed", () => {
    expect(parseArgs(["node", "import-cards.mjs", "--all", "--apply"]).dryRun).toBe(false);
  });
  it("stays dry-run with explicit --dry-run", () => {
    expect(parseArgs(["node", "import-cards.mjs", "--dry-run"]).dryRun).toBe(true);
  });
});
```
- [ ] **Step 2 — Run it, verify it fails** — `parseArgs` not exported; default is `false`.
- [ ] **Step 3 — In `scripts/import-cards.mjs`:** flip the `parseArgs` default `dryRun: true`, add `--apply` handling, `export` the function, and add an `isMain` guard around the top-level run body (pattern from `cleanup-ledger-duplicates.mjs`) so importing it in the test does not execute the script:
```js
export function parseArgs(argv) {
  const args = { dryRun: true, all: false, slug: null, filePath: null, verifyOnly: false, csvDir: null, dateFrom: null, dateTo: null, exportJson: null };
  // ...existing loop... and add:
  //   else if (arg === "--apply") args.dryRun = false;
  return args;
}

// wrap the existing top-level run (parseArgs(process.argv) + DB branch) in:
import { fileURLToPath } from "node:url";
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  // ...existing run body...
}
```
- [ ] **Step 4 — Export `parseArgs` from `scripts/cleanup-ledger-duplicates.mjs`** (it already defaults `apply:false`) and add a guard case to `tests/cleanup-ledger-duplicates.test.ts`:
```ts
import { parseArgs } from "../scripts/cleanup-ledger-duplicates.mjs";

describe("cleanup parseArgs", () => {
  it("defaults apply=false (dry run)", () => {
    expect(parseArgs(["node", "cleanup.mjs"]).apply).toBe(false);
  });
  it("enables delete only with --apply", () => {
    expect(parseArgs(["node", "cleanup.mjs", "--apply"]).apply).toBe(true);
  });
});
```
- [ ] **Step 5 — Invert the `package.json` scripts** so bare = dry-run and `:apply` = write. Keep `:dry-run` aliases for back-compat. Full set:
```json
"import:qb-apply-categories": "node scripts/apply-qb-categories-to-ledger.mjs --dry-run",
"import:qb-apply-categories:apply": "node scripts/apply-qb-categories-to-ledger.mjs --apply",
"import:qb-apply-categories:dry-run": "node scripts/apply-qb-categories-to-ledger.mjs --dry-run",
"import:cards": "node scripts/import-cards.mjs --all --dry-run",
"import:cards:apply": "node scripts/import-cards.mjs --all --apply",
"import:cards:dry-run": "node scripts/import-cards.mjs --dry-run",
"import:cards:verify": "node scripts/import-cards.mjs --verify",
"import:2025": "node scripts/import-2025-batch.mjs --dry-run",
"import:2025:apply": "node scripts/import-2025-batch.mjs --apply",
"import:2025:dry-run": "node scripts/import-2025-batch.mjs --dry-run",
"import:sheet": "node scripts/import-business-sheet.mjs --dry-run",
"import:sheet:apply": "node scripts/import-business-sheet.mjs --apply",
"import:sheet:dry-run": "node scripts/import-business-sheet.mjs --dry-run",
"import:qb-keller": "node scripts/import-qb-keller.mjs --dry-run",
"import:qb-keller:apply": "node scripts/import-qb-keller.mjs --apply",
"import:qb-keller:dry-run": "node scripts/import-qb-keller.mjs --dry-run",
"import:qb-2025": "node scripts/apply-qb-categories-to-ledger.mjs --dry-run --from 2025-01-01 --to 2026-01-01",
"import:qb-2025:apply": "node scripts/apply-qb-categories-to-ledger.mjs --apply --from 2025-01-01 --to 2026-01-01",
"import:qb-quicksilver": "node scripts/apply-qb-categories-to-ledger.mjs --dry-run --account cap-one-quicksilver-claudia --qb-source \"Capital One\" --from 2025-07-01 --to 2026-07-01",
"import:qb-quicksilver:apply": "node scripts/apply-qb-categories-to-ledger.mjs --apply --account cap-one-quicksilver-claudia --qb-source \"Capital One\" --from 2025-07-01 --to 2026-07-01",
"import:cards:csv-2025-2026": "node scripts/import-cards.mjs --dry-run --all --csv-dir '/Users/ac/Downloads/CSV 2025-2026'",
"import:cards:csv-2025-2026:apply": "node scripts/import-cards.mjs --apply --all --csv-dir '/Users/ac/Downloads/CSV 2025-2026'",
"import:classify-refunds": "node scripts/classify-refund-imports.mjs --dry-run",
"import:classify-refunds:apply": "node scripts/classify-refund-imports.mjs --apply",
"cleanup:ledger-dupes": "node scripts/cleanup-ledger-duplicates.mjs --dry-run",
"cleanup:ledger-dupes:apply": "node scripts/cleanup-ledger-duplicates.mjs --apply",
"cleanup:ledger-dupes:dry-run": "node scripts/cleanup-ledger-duplicates.mjs --dry-run"
```
> These scripts already treat "no `--apply`" as dry-run at the CLI level, so the bare-name change is safe; the footgun was only the npm aliases injecting `--apply`. Verify each referenced script name still exists before saving; preserve JSON quoting on the Capital One args.
- [ ] **Step 6 — Docs sweep** (same PR): update every runbook command that assumed bare = apply to the `:apply` suffix — `RUN.md` (`import:cards:csv-2025-2026`, `cleanup:ledger-dupes`), `docs/SUPABASE.md` (`import:cards`), `docs/STAGE2-RUNBOOK.md` (import:2025/sheet/cards apply steps), `docs/STAGE2-MIGRATION-AUDIT.md` (`import:sheet`), `docs/OVERNIGHT_HANDOFF.md` (cleanup apply step), `docs/CLASSIFICATION.md` (`import:cards` re-import). Add a `docs/CHANGELOG.md` entry noting the convention flip (bare = dry-run).
- [ ] **Step 7 — Run gate — green. Commit:** `git commit -m "fix(scripts): bare npm scripts default to dry-run; :apply for writes (T3)"`

**Risk:** a stale caller (operator memory / cron) running the old bare `npm run import:cards` now silently **dry-runs** and writes nothing — a completeness surprise, not corruption. Mitigate with the docs sweep + kept `:dry-run` aliases. The `isMain` guard is required so the `parseArgs` export doesn't execute the script on import.

---

## Consolidated operator checklist (non-code — you must do these)

| # | WP | Action |
|---|-----|--------|
| 1 | WP2 | **Supabase dashboard → Auth → Providers → Email → "Allow new users to sign up" = OFF** (`ihciuqpiavxhbulfkwod`). *The authoritative S1 fix.* |
| 2 | WP2 | Audit Auth → Users; delete any unexpected self-registered accounts. |
| 3 | WP1 | GitHub → repo Settings → Branches → require the `CI / verify` check on `main`. |
| 4 | WP3 | Confirm `classification_proposals.status` CHECK allows `'skipped'` (else add a migration or reuse a terminal status). |
| 5 | WP4 | Apply migration `20260702130000` to the live DB via dashboard/CLI (**not** the connected MCP). |
| 6 | WP4 | Remediate connections mapped after first sync: `sync_cursor = NULL` (C2). Remediate silent cutovers: `sync_from_date = CSV-last + 1` (C3), before next sync. |
| 7 | WP5 | Fresh `scripts/export-ledger-backup.mjs` backup before any `cleanup:ledger-dupes:apply`; re-run dry-run after the C7 fix and confirm the delete count drops. |

---

## Self-review

- **Spec coverage:** all 8 §1 findings mapped — S1→WP2, C1→WP3, C2+C3→WP4, T1→WP1, T2→WP3, T3+C7→WP5. ✅
- **Out of scope (by design):** the ~13 Medium findings (C4–C13, S2–S12, T4–T9) and the §3 product ideas. Fold into a WP6+ second wave if desired.
- **Placeholder scan:** every code/test step carries real code from the live-code investigation; identifiers to confirm against source are called out inline (they exist, only names/lines may shift).
- **Type/name consistency:** `partitionCommitPlan`, `OVERWRITABLE_CLASSIFIERS`, `unmappedPlaidAccountIds`, `magicLinkOtpOptions`, `groupDuplicates`, `parseArgs` are used consistently across their tasks and tests.
- **Known harness caveats baked in:** fake-supabase `upsert` = ignore-on-conflict (→ C1 tests the pure helper); `import-cards.mjs` needs `isMain` guard for import-safety; `groupDuplicates`/`parseArgs`/`partitionCommitPlan` require `export`.
