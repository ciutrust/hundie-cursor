import Link from "next/link";
import { SignOutButton } from "@/components/auth/sign-out-button";

export function AppHeader({ title, backHref }: { title: string; backHref?: string }) {
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
        <div className="flex min-w-0 items-center gap-3">
          {backHref ? (
            <Link href={backHref} className="text-sm text-muted-foreground hover:text-foreground">
              ← Back
            </Link>
          ) : (
            <Link href="/review" className="text-sm font-semibold tracking-tight">
              Hundie
            </Link>
          )}
          <h1 className="truncate text-lg font-semibold">{title}</h1>
        </div>
        <SignOutButton />
      </div>
    </header>
  );
}
