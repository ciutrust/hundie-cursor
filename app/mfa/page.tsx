import { Suspense } from "react";
import { MfaChallenge } from "./mfa-challenge";

export default function MfaPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Suspense fallback={<div className="text-sm text-muted-foreground">Loading…</div>}>
        <MfaChallenge />
      </Suspense>
    </main>
  );
}
