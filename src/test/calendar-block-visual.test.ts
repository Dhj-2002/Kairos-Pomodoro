import { describe, expect, it } from "vitest";
import { getCalendarBlockVisualInset } from "@/components/base/calendar-time-block";

describe("calendar block visual density", () => {
  it("keeps 15-minute blocks usable and halves the 30-minute visual gap", () => {
    expect(getCalendarBlockVisualInset(16)).toBe(0.25);
    expect(16 - getCalendarBlockVisualInset(16) * 2).toBe(15.5);

    expect(getCalendarBlockVisualInset(32)).toBe(0.75);
    expect(32 - getCalendarBlockVisualInset(32) * 2).toBe(30.5);
  });

  it("caps long-block breathing room instead of scaling away duration", () => {
    expect(getCalendarBlockVisualInset(64)).toBe(1);
    expect(getCalendarBlockVisualInset(128)).toBe(1);
  });
});
