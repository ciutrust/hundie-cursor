import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Hundie",
    short_name: "Hundie",
    description: "Multi-entity ledger and receipt capture",
    // Installed, the home-screen icon opens straight into a live camera. That is the whole
    // reason to install: one tap at the counter instead of five through the nav.
    start_url: "/capture",
    display: "standalone",
    // Matches the dark palette the app boots into (globals.css `.dark --color-background`),
    // so the splash and system chrome do not flash a different color on launch.
    background_color: "#05070c",
    theme_color: "#05070c",
    // 192 + 512 are what Chrome requires before it will offer "Install" at all.
    //
    // These are generated FULL-BLEED from AC's source art: the original had a baked-in white border
    // around a pre-rounded square, which both platforms would have framed in white, because they mask
    // icons themselves. The white was keyed out to the icon's own green (rgb(23,73,51)) so the art
    // runs edge to edge and the OS does the rounding.
    //
    // The maskable entry is separate and deliberately padded: Android crops a maskable icon to a
    // circle/squircle, and the full-bleed art sits at ~92% — the "Hundie" wordmark would be sliced.
    // It is shrunk to 76% on a green bed so everything lands inside the centre safe zone. `any` and
    // `maskable` are distinct purposes; one file cannot serve both well.
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
