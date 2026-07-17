import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { DM_Sans } from "next/font/google";
import { ThemeProvider } from "@/components/theme/theme-provider";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
});

export const metadata: Metadata = {
  title: "Hundie",
  description: "Weekly transaction classifier for multi-entity bookkeeping",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Required for `env(safe-area-inset-*)` to report real values on iOS. Without it the inset
  // resolves to 0 and the bottom nav sits under the home indicator.
  viewportFit: "cover",
  // A single value, not a prefers-color-scheme pair: this app picks its theme from
  // localStorage (`hundie-theme`, dark unless explicitly 'light'), not from the OS, so keying
  // the status bar off the OS would mismatch the page more often than it would match it.
  themeColor: "#05070c",
};

const themeScript = `(function(){try{var t=localStorage.getItem('hundie-theme');var d=t!=='light';document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light'}catch(e){document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark'}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={dmSans.variable} suppressHydrationWarning>
      <body className="font-[family-name:var(--font-dm-sans)]">
        <Script id="hundie-theme" strategy="beforeInteractive">
          {themeScript}
        </Script>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
