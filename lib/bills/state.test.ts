import { describe, expect, it } from "vitest";
import { deriveBillState, isOutstanding } from "@/lib/bills/state";

const today = "2026-07-15";

describe("deriveBillState", () => {
  it("returns paid/skipped from the stored status regardless of due date", () => {
    expect(deriveBillState({ dueDate: "2026-01-01", status: "paid", today })).toBe("paid");
    expect(deriveBillState({ dueDate: "2026-12-31", status: "skipped", today })).toBe("skipped");
  });

  it("flags an open instance whose due date has passed as overdue", () => {
    expect(deriveBillState({ dueDate: "2026-07-14", status: "open", today })).toBe("overdue");
    expect(deriveBillState({ dueDate: "2026-06-01", status: "open", today })).toBe("overdue");
  });

  it("treats today and the due-soon window (default 7 days) as due_soon", () => {
    expect(deriveBillState({ dueDate: "2026-07-15", status: "open", today })).toBe("due_soon");
    expect(deriveBillState({ dueDate: "2026-07-22", status: "open", today })).toBe("due_soon"); // +7 inclusive
  });

  it("treats anything beyond the window as upcoming", () => {
    expect(deriveBillState({ dueDate: "2026-07-23", status: "open", today })).toBe("upcoming"); // +8
  });

  it("respects a custom dueSoonDays window", () => {
    expect(deriveBillState({ dueDate: "2026-07-18", status: "open", today, dueSoonDays: 2 })).toBe(
      "upcoming",
    );
    expect(deriveBillState({ dueDate: "2026-07-17", status: "open", today, dueSoonDays: 2 })).toBe(
      "due_soon",
    );
  });
});

describe("isOutstanding", () => {
  it("is true for states that still owe money", () => {
    expect(isOutstanding("overdue")).toBe(true);
    expect(isOutstanding("due_soon")).toBe(true);
    expect(isOutstanding("upcoming")).toBe(true);
    expect(isOutstanding("paid")).toBe(false);
    expect(isOutstanding("skipped")).toBe(false);
  });
});
