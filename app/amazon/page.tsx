import { getClassifiableEntities, getCategoriesByEntity } from "@/lib/queries/review";
import { getAmazonDeskQueue } from "@/lib/queries/amazon";
import { AmazonLogo } from "@/components/amazon/amazon-logo";
import { AmazonUploadPanel } from "@/components/amazon/amazon-upload-panel";
import { AmazonDeskClient } from "@/components/amazon/amazon-desk-client";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type PageProps = { searchParams: Promise<{ status?: string }> };

export default async function AmazonDeskPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const statusRaw = params.status ?? "open";
  const status =
    statusRaw === "suggested" ||
    statusRaw === "confirmed" ||
    statusRaw === "all" ||
    statusRaw === "open"
      ? statusRaw
      : "open";

  const [entities, categoriesByEntity, queue] = await Promise.all([
    getClassifiableEntities(),
    getCategoriesByEntity(),
    getAmazonDeskQueue({ status }),
  ]);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Functions
        </p>
        <div className="flex items-center gap-2">
          <AmazonLogo className="h-7 w-7 text-[#232F3E] dark:text-amber-400" />
          <h1 className="text-3xl font-semibold tracking-tight">Amazon desk</h1>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Link card Amazon charges to real order shipments. Confirm entity/category (or split by
          item); notes get the purchase summary and order URL. Human confirm only — nothing
          auto-writes the books.
        </p>
      </div>

      <AmazonUploadPanel lastBatch={queue.lastBatch} />

      <AmazonDeskClient
        items={queue.items}
        counts={queue.counts}
        entities={entities}
        categoriesByEntity={categoriesByEntity}
        filter={status}
      />
    </div>
  );
}
