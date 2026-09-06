import { Suspense } from "react";
import { getClassifiableEntities, getCategoriesByEntity } from "@/lib/queries/review";
import { getAmazonDeskQueue } from "@/lib/queries/amazon";
import { parseAmazonDeskStatus } from "@/lib/amazon/desk";
import { parsePeriodParams, periodQueryString, periodRangeFor } from "@/lib/period";
import { AmazonLogo } from "@/components/amazon/amazon-logo";
import { AmazonUploadPanel } from "@/components/amazon/amazon-upload-panel";
import { AmazonDeskClient } from "@/components/amazon/amazon-desk-client";
import { PeriodPicker } from "@/components/review/period-picker";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type PageProps = {
  searchParams: Promise<{
    status?: string;
    period?: string;
    at?: string;
    month?: string;
  }>;
};

export default async function AmazonDeskPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const period = parsePeriodParams(
    params,
    periodRangeFor("year", String(new Date().getFullYear())),
  );
  const status = parseAmazonDeskStatus(params.status);
  const periodQuery = periodQueryString(period);

  const [entities, categoriesByEntity, queue] = await Promise.all([
    getClassifiableEntities(),
    getCategoriesByEntity(),
    getAmazonDeskQueue({ status, period }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Functions
          </p>
          <div className="flex items-center gap-2">
            <AmazonLogo className="h-7 w-7 text-[#232F3E] dark:text-amber-400" />
            <h1 className="text-3xl font-semibold tracking-tight">Amazon desk</h1>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Link card Amazon charges to order shipments. Uncategorized still need a category;
            unmatched already have one. Done is archived. Paying an Amazon card from checking is
            hidden.
          </p>
        </div>
        <Suspense fallback={null}>
          <PeriodPicker period={period} />
        </Suspense>
      </div>

      <AmazonUploadPanel lastBatch={queue.lastBatch} />

      <AmazonDeskClient
        items={queue.items}
        counts={queue.counts}
        entities={entities}
        categoriesByEntity={categoriesByEntity}
        filter={status}
        queryBase={periodQuery}
      />
    </div>
  );
}
