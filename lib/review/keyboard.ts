/**
 * #7 — keyboard flow for the classify list. The key→action mapping is a pure function so it can be
 * unit-tested (incl. the critical "don't hijack typing" guard); the DOM wiring in transaction-list.tsx
 * is thin and manual-QA'd.
 *
 * Keys (vim-style, single-key, no modifiers):
 *   j / k  — move the row cursor down / up
 *   Enter  — accept the focused row's inline suggestion (one-click classify)
 *   x      — toggle-select the focused row
 *   s      — Find-similar on the focused row
 *   Esc    — clear selection + cursor
 */
export type KeyAction =
  | { type: "none" }
  | { type: "move"; delta: 1 | -1 }
  | { type: "accept" }
  | { type: "toggleSelect" }
  | { type: "findSimilar" }
  | { type: "clear" };

/** Minimal shape of an event target — kept DOM-free so the mapping is testable in node. */
export type KeyTarget = {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
} | null;

/**
 * CRITICAL GUARD: never hijack keys while the user is typing in a field. Covers input/textarea/select
 * and any contentEditable region (the search box, the category picker, the notes textarea).
 */
export function isEditableTarget(target: KeyTarget): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = (target.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** A natively-activatable control (button / link / role=button) — let it handle its own Enter. */
export function isActivatable(target: KeyTarget): boolean {
  if (!target) return false;
  const tag = (target.tagName ?? "").toUpperCase();
  if (tag === "BUTTON" || tag === "A") return true;
  return target.getAttribute?.("role") === "button";
}

export function keyToAction(key: string, target: KeyTarget): KeyAction {
  // Typing in a field always wins — no shortcut fires.
  if (isEditableTarget(target)) return { type: "none" };

  switch (key) {
    case "j":
      return { type: "move", delta: 1 };
    case "k":
      return { type: "move", delta: -1 };
    case "x":
      return { type: "toggleSelect" };
    case "s":
      return { type: "findSimilar" };
    case "Escape":
      return { type: "clear" };
    case "Enter":
      // Don't double-fire when a real button/link is focused — let it activate natively.
      if (isActivatable(target)) return { type: "none" };
      return { type: "accept" };
    default:
      return { type: "none" };
  }
}

/** Clamp the cursor into [0, count-1]; a first move from "no cursor" (-1) lands on row 0. */
export function nextCursor(current: number, delta: 1 | -1, count: number): number {
  if (count <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : count - 1;
  const next = current + delta;
  if (next < 0) return 0;
  if (next > count - 1) return count - 1;
  return next;
}
