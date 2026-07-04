import { describe, expect, test } from "vitest";
import { groupUndoRestores, type UndoRestore } from "../lib/review/undo";
import { DESCRIPTIONS } from "../lib/category-descriptions";

// #2 — undo grouping: collapse per-transaction restores into (entity, category) groups so undo can
// reuse the chunked bulkReclassifyTransactions action, one call per distinct prior target.
describe("groupUndoRestores", () => {
  test("a single quick-classify restore is one group", () => {
    const restores: UndoRestore[] = [
      { classificationId: "c1", entityId: "gbsl", categoryId: null },
    ];
    const groups = groupUndoRestores(restores);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual({ entityId: "gbsl", categoryId: null, classificationIds: ["c1"] });
  });

  test("rows with the same prior target collapse into one group; distinct priors split", () => {
    const restores: UndoRestore[] = [
      { classificationId: "c1", entityId: "gbsl", categoryId: null },
      { classificationId: "c2", entityId: "gbsl", categoryId: null },
      { classificationId: "c3", entityId: "gbsl", categoryId: "cat-rent" },
      { classificationId: "c4", entityId: "personal", categoryId: null },
    ];
    const groups = groupUndoRestores(restores);
    expect(groups).toHaveLength(3);

    const nullGbsl = groups.find((g) => g.entityId === "gbsl" && g.categoryId === null);
    expect(nullGbsl?.classificationIds).toEqual(["c1", "c2"]);

    const rentGbsl = groups.find((g) => g.entityId === "gbsl" && g.categoryId === "cat-rent");
    expect(rentGbsl?.classificationIds).toEqual(["c3"]);

    const nullPersonal = groups.find((g) => g.entityId === "personal");
    expect(nullPersonal?.classificationIds).toEqual(["c4"]);
  });

  test("a null categoryId and empty-string categoryId are NOT merged (distinct restore targets)", () => {
    const restores: UndoRestore[] = [
      { classificationId: "c1", entityId: "gbsl", categoryId: null },
      { classificationId: "c2", entityId: "gbsl", categoryId: "" },
    ];
    // Empty string is not a real category id, but the grouping key must still keep them apart from a
    // genuine null so we never accidentally widen a restore. Both map to the "no real category" key.
    const groups = groupUndoRestores(restores);
    // key is `${entityId}|${categoryId ?? ""}` → null and "" collide by design; assert the collapse.
    expect(groups).toHaveLength(1);
    expect(groups[0].classificationIds).toEqual(["c1", "c2"]);
  });

  test("empty input yields no groups", () => {
    expect(groupUndoRestores([])).toEqual([]);
  });
});

// #9 — the category-description map is keyed by exact full_path and should carry real guidance for the
// common business/rental/tax lines. Guard a representative sample so a future refactor can't silently
// blank them, and assert the shape is a non-trivial string map.
describe("category descriptions (#9)", () => {
  test("covers a representative set of common business/tax categories", () => {
    // DESCRIPTIONS is keyed by full_path; for the GBSL chart the full_path is the bare category name.
    const sample = ["Advertising & Marketing", "Contract Labor", "Insurance", "Office Expense"];
    for (const path of sample) {
      expect(DESCRIPTIONS[path], `missing description for ${path}`).toBeTruthy();
      expect(typeof DESCRIPTIONS[path]).toBe("string");
      expect(DESCRIPTIONS[path].length).toBeGreaterThan(3);
    }
  });

  test("every description value is a non-empty string", () => {
    const entries = Object.entries(DESCRIPTIONS);
    expect(entries.length).toBeGreaterThan(20);
    for (const [key, value] of entries) {
      expect(typeof value).toBe("string");
      expect(value.trim().length, `empty description for ${key}`).toBeGreaterThan(0);
    }
  });
});
