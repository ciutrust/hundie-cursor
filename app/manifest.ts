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
    // No `icons` array on purpose: there is no /public directory and no icon file anywhere in
    // the repo yet. A manifest pointing at a file that does not exist installs worse than one
    // with no icons at all. Drop a 192px and 512px PNG in /public and add them here later.
  };
}
