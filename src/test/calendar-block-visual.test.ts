import { describe, expect, it } from "vitest";
import {
  getCalendarBlockVisualInset,
  isCalendarBlockElapsed,
} from "@/components/base/calendar-time-block";

describe("calendar block visual density", () => {
  it("keeps 15-minute blocks usable and halves the 30-minute visual gap", () => {
    expect(getCalendarBlockVisualInset(12.5)).toBe(0.25);
    expect(12.5 - getCalendarBlockVisualInset(12.5) * 2).toBe(12);

    expect(getCalendarBlockVisualInset(25)).toBe(0.75);
    expect(25 - getCalendarBlockVisualInset(25) * 2).toBe(23.5);
  });

  it("caps long-block breathing room instead of scaling away duration", () => {
    expect(getCalendarBlockVisualInset(64)).toBe(1);
    expect(getCalendarBlockVisualInset(128)).toBe(1);
  });
});

describe("calendar block elapsed state", () => {
  it("keeps future and currently running blocks softly filled", () => {
    const now = new Date(2026, 8, 15, 10, 0).getTime();
    expect(isCalendarBlockElapsed("2026-09-15 10:01:00", now)).toBe(false);
    expect(isCalendarBlockElapsed("2026-09-15 11:00:00", now)).toBe(false);
  });

  it("switches to hollow exactly when the complete block ends", () => {
    const now = new Date(2026, 8, 15, 10, 0).getTime();
    expect(isCalendarBlockElapsed("2026-09-15 10:00:00", now)).toBe(true);
    expect(isCalendarBlockElapsed("2026-09-15 09:59:00", now)).toBe(true);
  });
});
