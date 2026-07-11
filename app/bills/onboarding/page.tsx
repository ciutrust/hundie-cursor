import Link from "next/link";
import { Sparkles } from "lucide-react";
import { getClassifiableEntities } from "@/lib/queries/review";
import { getBillSeedCandidates } from "@/lib/queries/bills";
import { BillSeedPanel } from "@/components/bills/bill-seed-panel";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function BillsOnboardingPage() {
  const [entities, candidatesByEntity] = await Promise.all([
    getClassifiableEntities(),
    getBillSeedCandidates(),
  ]);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Bills · setup
        </p>
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-emerald-500" />
          <h1 className="text-3xl font-semibold tracking-tight">Suggested bills</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          We scanned your imported transactions for recurring charges. Pick the ones to track as
          bills — skip the rest. You can edit any of them afterward.
        </p>
        <Link
          href="/bills"
          className="inline-block pt-1 text-sm text-emerald-600 hover:underline dark:text-emerald-400"
        >
          ← Back to bills
        </Link>
      </div>

      <BillSeedPanel candidatesByEntity={candidatesByEntity} entities={entities} />
    </div>
  );
}
