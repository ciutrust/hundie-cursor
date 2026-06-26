import { Suspense } from "react";
import { Sparkles } from "lucide-react";
import { AiReviewPanel } from "@/components/review/ai-review-panel";
import { getCategoriesByEntity, getClassifiableEntities } from "@/lib/queries/review";
import { getPersonalAiBacklog } from "@/lib/queries/ai-suggestions";

export const maxDuration = 300;

export default async function AiReviewPage() {
  const [transactions, entities, categoriesByEntity] = await Promise.all([
    getPersonalAiBacklog(),
    getClassifiableEntities(),
    getCategoriesByEntity(),
  ]);

  const withAi = transactions.filter((tx) => tx.ai_suggestion).length;

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Classify · AI review
        </p>
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-violet-500" />
          <h1 className="text-3xl font-semibold tracking-tight">AI review</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Personal · uncategorized · 2025–2026 · {transactions.length.toLocaleString()} transactions ·{" "}
          {withAi.toLocaleString()} with AI suggestions
        </p>
      </div>

      <AiReviewPanel
        transactions={transactions}
        entities={entities}
        categoriesByEntity={categoriesByEntity}
      />
    </div>
  );
}
