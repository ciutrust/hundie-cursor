import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const root = process.cwd();
const workflowPath = path.join(root, ".github", "workflows", "ci.yml");

describe("T1 — CI gate parity", () => {
  test("a CI workflow file exists", () => {
    expect(existsSync(workflowPath)).toBe(true);
  });
  test("CI runs the offline gate scripts", () => {
    const yml = readFileSync(workflowPath, "utf8");
    expect(yml).toContain("npm ci");
    expect(yml).toContain("npm run typecheck");
    expect(yml).toContain("npm run lint");
    expect(yml).toContain("npm test");
  });
  test("referenced gate scripts exist in package.json", () => {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    expect(pkg.scripts.typecheck).toBeTruthy();
    expect(pkg.scripts.lint).toBeTruthy();
    expect(pkg.scripts.test).toBe("vitest run");
  });
  test("package.json pins a Node engine", () => {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    expect(pkg.engines?.node).toBeTruthy();
  });
});
