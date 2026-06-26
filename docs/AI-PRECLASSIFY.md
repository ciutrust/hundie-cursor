# AI pre-classifier

LLM-assisted **suggestions** for Personal uncategorized transactions (2025–2026). Never writes to `classifications` until you confirm in the UI.

## Setup

Add to `.env.local` (and Vercel env for production):

```
ANTHROPIC_API_KEY=sk-ant-...
AI_MODEL=claude-sonnet-4-6
```

Apply migration (already applied to remote Supabase `ihciuqpiavxhbulfkwod`; file in repo):

```bash
supabase db push   # fresh environments only — or apply 20260630120000_create_ai_suggestions.sql via dashboard
```

## In-app workflow

1. Open **AI review** at `/review/ai`  
   Personal · uncategorized · 2025–2026 (no period picker)

2. Transactions are **grouped by vendor** and sent to the model as **summarized packages** (not row-by-row).

3. Click **Ask AI (N)** for selected transactions, or **Ask AI (all)** for the full backlog.

4. After the run, click **Review AI** on a group. Confirm dialog lets you **uncheck individual transactions** again before **Accept selected** or **Reject selected**.

5. Accepted suggestions write to `classifications` via the normal reclassify path and log `suggestion_events` with `suggestion_source = 'ai_llm'`. That feeds the deterministic engine on the next visit.

## Relationship to deterministic engine

| | Deterministic (`lib/suggestions/*`) | AI pre-classifier |
|--|-------------------------------------|-------------------|
| When | Every reclassify dialog open | When you click Ask AI |
| Strength | Repeat vendors, QB/history | Cold-start, messy descriptions |
| Source tag | qb_training, blended, etc. | **ai_llm** (purple badge) |
| Ledger write | Only on your confirm | Only on your confirm |

Both compound: confirmed AI picks become `confirmed_history` training data.

## Measurement

**Reports → AI suggestions** (`/reports/ai-suggestions`) — accept/reject rates by entity and confidence band.

## Guardrails

- Suggestions only — no auto-apply, even at high confidence
- Categories must exist on the entity chart; invalid paths → unsure
- Only Personal + `category_id IS NULL` + 2025-01-01..2026-12-31
- Model confidence is calibrated down (high→medium, medium→low)

## Cost

Sonnet ~$15–40 for ~3k transactions. The UI shows an estimate before each run completes.
