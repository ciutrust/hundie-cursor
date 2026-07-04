import { describe, expect, test } from "vitest";
import {
  isActivatable,
  isEditableTarget,
  keyToAction,
  nextCursor,
  type KeyTarget,
} from "../lib/review/keyboard";

const el = (tagName: string, extra: Partial<{ isContentEditable: boolean; role: string }> = {}): KeyTarget => ({
  tagName,
  isContentEditable: extra.isContentEditable,
  getAttribute: (name) => (name === "role" ? (extra.role ?? null) : null),
});

describe("keyToAction", () => {
  test("maps the vim-style keys to their actions on a non-editable target", () => {
    const div = el("DIV");
    expect(keyToAction("j", div)).toEqual({ type: "move", delta: 1 });
    expect(keyToAction("k", div)).toEqual({ type: "move", delta: -1 });
    expect(keyToAction("x", div)).toEqual({ type: "toggleSelect" });
    expect(keyToAction("s", div)).toEqual({ type: "findSimilar" });
    expect(keyToAction("Escape", div)).toEqual({ type: "clear" });
    expect(keyToAction("Enter", div)).toEqual({ type: "accept" });
  });

  test("unmapped keys are no-ops", () => {
    expect(keyToAction("q", el("DIV"))).toEqual({ type: "none" });
    expect(keyToAction("1", el("DIV"))).toEqual({ type: "none" });
  });

  test("CRITICAL GUARD: no shortcut fires while typing in a field", () => {
    for (const tag of ["INPUT", "TEXTAREA", "SELECT"]) {
      expect(keyToAction("j", el(tag))).toEqual({ type: "none" });
      expect(keyToAction("x", el(tag))).toEqual({ type: "none" });
      expect(keyToAction("s", el(tag))).toEqual({ type: "none" });
      expect(keyToAction("Enter", el(tag))).toEqual({ type: "none" });
    }
    // contentEditable region (e.g. a rich text box) is also protected.
    expect(keyToAction("s", el("DIV", { isContentEditable: true }))).toEqual({ type: "none" });
  });

  test("Enter on a real button/link does not double-fire (native activation wins)", () => {
    expect(keyToAction("Enter", el("BUTTON"))).toEqual({ type: "none" });
    expect(keyToAction("Enter", el("A"))).toEqual({ type: "none" });
    expect(keyToAction("Enter", el("DIV", { role: "button" }))).toEqual({ type: "none" });
    // but j/k/x/s still work even with a button focused
    expect(keyToAction("j", el("BUTTON"))).toEqual({ type: "move", delta: 1 });
  });

  test("null target is treated as non-editable, non-activatable", () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isActivatable(null)).toBe(false);
    expect(keyToAction("Enter", null)).toEqual({ type: "accept" });
  });
});

describe("nextCursor", () => {
  test("first move from no-cursor lands on an end depending on direction", () => {
    expect(nextCursor(-1, 1, 5)).toBe(0);
    expect(nextCursor(-1, -1, 5)).toBe(4);
  });

  test("clamps at both ends", () => {
    expect(nextCursor(0, -1, 5)).toBe(0);
    expect(nextCursor(4, 1, 5)).toBe(4);
    expect(nextCursor(2, 1, 5)).toBe(3);
  });

  test("empty list -> no cursor", () => {
    expect(nextCursor(3, 1, 0)).toBe(-1);
  });
});
