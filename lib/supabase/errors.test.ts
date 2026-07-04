import { describe, expect, it } from "vitest";
import { pgError, pgErrorMessage } from "@/lib/supabase/errors";

describe("pgErrorMessage (E1)", () => {
  it("composes a non-empty message from code/details/hint when .message is empty", () => {
    const msg = pgErrorMessage({ message: "", code: "PGRST116", details: "0 rows", hint: "check RLS" });
    expect(msg).toContain("code=PGRST116");
    expect(msg).toContain("0 rows");
    expect(msg).toContain("hint=check RLS");
  });

  it("uses .message when present", () => {
    expect(pgErrorMessage({ message: "boom" })).toContain("boom");
  });

  it("never returns an empty string, even for a fully-empty error or null", () => {
    expect(pgErrorMessage({ message: "" })).not.toBe("");
    expect(pgErrorMessage(null)).not.toBe("");
  });
});

describe("pgError (E1)", () => {
  it("prefixes the context and preserves the original error as cause", () => {
    const orig = { message: "", code: "X" };
    const err = pgError("sidebar", orig);
    expect(err.message).toContain("sidebar");
    expect(err.message).toContain("code=X");
    expect(err.cause).toBe(orig);
  });
});
