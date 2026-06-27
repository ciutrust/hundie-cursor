import Link from "next/link";

// Force the light palette on the legal pages (clean document look, matches the security PDF) even
// when the app is in dark mode. Overriding the design tokens here keeps every token-based class
// working without changing any markup.
const lightTheme = {
  "--color-background": "oklch(0.985 0.004 265)",
  "--color-foreground": "oklch(0.18 0.02 265)",
  "--color-card": "oklch(1 0 0)",
  "--color-muted": "oklch(0.965 0.006 265)",
  "--color-muted-foreground": "oklch(0.48 0.02 265)",
  "--color-border": "oklch(0.91 0.01 265)",
  "--color-primary": "oklch(0.52 0.16 145)",
  "--color-primary-foreground": "oklch(0.99 0 0)",
  colorScheme: "light",
} as React.CSSProperties;

/** Shared chrome for the public policy pages: Hundie logo header, titled body, footer with links. */
export function LegalShell({
  title,
  effective,
  children,
}: {
  title: string;
  effective: string;
  children: React.ReactNode;
}) {
  return (
    <div style={lightTheme} className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
              H
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold">Hundie</div>
              <div className="text-xs text-muted-foreground">Multi-entity ledger</div>
            </div>
          </Link>
          <Link href="/" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
            Back to app
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12 sm:py-16">
        <p className="text-xs font-medium uppercase tracking-wider text-primary">Ciunciusky Trust</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-3 text-sm text-muted-foreground">Effective {effective}</p>
        <div className="mt-10 space-y-8 text-[15px] leading-relaxed text-foreground/90">
          {children}
        </div>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Ciunciusky Trust</span>
          <nav className="flex flex-wrap gap-x-5 gap-y-1">
            <Link href="/privacy" className="transition-colors hover:text-foreground">
              Privacy Policy
            </Link>
            <Link href="/data-retention" className="transition-colors hover:text-foreground">
              Data Retention &amp; Disposal
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/** A titled section within a policy page. */
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
      {children}
    </section>
  );
}

export function LegalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-primary underline-offset-4 hover:underline"
    >
      {children}
    </a>
  );
}
