import type { Metadata } from "next";
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
