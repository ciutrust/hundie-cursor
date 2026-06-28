"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

type AppError = Error & { digest?: string };

export default function Error({ error, reset }: { error: AppError; reset: () => void }) {
  useEffect(() => {
    console.error("Review section error:", error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-8">
      <h2 className="text-lg font-semibold">Couldn&rsquo;t load this section</h2>
      <p className="text-sm text-muted-foreground">
        An error occurred while loading review. Try again, or check the logs for the trace.
      </p>
      <div>
        <Button type="button" variant="outline" onClick={() => reset()}>
          Try again
        </Button>
      </div>
    </div>
  );
}
