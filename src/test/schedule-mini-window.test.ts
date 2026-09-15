import { describe, expect, it } from "vitest";
import { shouldShowMiniWindow } from "@/components/schedule/schedule-mini-window";

describe("schedule mini-window startup visibility", () => {
  it("keeps an explicitly persisted Off preference hidden", () => {
    expect(shouldShowMiniWindow("off")).toBe(false);
  });

  it("allows enabled sizes and legacy missing preferences", () => {
    expect(shouldShowMiniWindow("small")).toBe(true);
    expect(shouldShowMiniWindow("medium")).toBe(true);
    expect(shouldShowMiniWindow("large")).toBe(true);
    expect(shouldShowMiniWindow(null)).toBe(true);
  });
});
