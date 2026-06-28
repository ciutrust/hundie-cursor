import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "generate-qb-import-sql.mjs"), "utf8");

describe("SEC-07 — entityId is routed through sqlString()", () => {
  test("no raw '${entityId}' interpolation remains", () => {
    // Every SQL literal in this generator must go through the sqlString() escaper.
    // A raw `'${entityId}'` would be the one inconsistent (un-escaped) site.
    expect(source).not.toMatch(/'\$\{entityId\}'/);
  });

  test("an escaped entityIdLiteral is defined and used for entity_id", () => {
    expect(source).toContain("const entityIdLiteral = sqlString(entityId);");
    expect(source).toContain("entity_id = ${entityIdLiteral}");
  });
});
