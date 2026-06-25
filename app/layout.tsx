import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hundie",
  description: "Weekly transaction classifier for multi-entity bookkeeping",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
