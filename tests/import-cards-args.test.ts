import { describe, expect, it } from "vitest";
import { parseArgs } from "../scripts/import-cards.mjs";

describe("import-cards parseArgs", () => {
  it("defaults to dry-run when no write flag is given", () => {
    expect(parseArgs(["node", "import-cards.mjs", "--all"]).dryRun).toBe(true);
  });
  it("only writes when --apply is passed", () => {
    expect(parseArgs(["node", "import-cards.mjs", "--all", "--apply"]).dryRun).toBe(false);
  });
  it("stays dry-run with explicit --dry-run", () => {
    expect(parseArgs(["node", "import-cards.mjs", "--dry-run"]).dryRun).toBe(true);
  });
  it("defaults force to false", () => {
    expect(parseArgs(["node", "import-cards.mjs", "--all"]).force).toBe(false);
  });
  it("sets force true with --force (bypasses the C6 Plaid-cutover cap)", () => {
    expect(parseArgs(["node", "import-cards.mjs", "--all", "--force"]).force).toBe(true);
  });
});
