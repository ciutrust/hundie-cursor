import { describe, expect, it } from "vitest";
import { escapeCsvCell, rowsToCsv } from "@/lib/csv";

describe("csv export", () => {
  it("neutralizes formula injection", () => {
    expect(escapeCsvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(escapeCsvCell("+cmd")).toBe("'+cmd");
  });

  it("quotes fields with commas", () => {
    expect(rowsToCsv(["a"], [["hello, world"]])).toBe("a\n\"hello, world\"");
  });
});
