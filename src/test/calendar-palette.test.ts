import { afterEach, describe, expect, it, vi } from "vitest";
import { calendarTagColor, CATEGORY_PRESET_COLORS, generateCategoryColor } from "@/lib/category-colors";
import { calendarEventStyle } from "@/features/schedule/calendar-appearance";

afterEach(() => vi.restoreAllMocks());
describe("calendar display palette", () => {
  it("brightens only known legacy swatches, preserving custom colors", () => {
    expect(calendarTagColor("#5B8FA3")).toBe("#55B7FA");
    expect(calendarTagColor("#C17767")).toBe("#FF69AC");
    expect(calendarTagColor("#8B9E6B")).toBe("#65C65A");
    expect(calendarTagColor("#D4A574")).toBe("#FFCC49");
    expect(calendarTagColor("#123ABC")).toBe("#123ABC");
  });
  it("keeps the legacy and bright event surfaces identical without mutating inputs", () => {
    const tag = Object.freeze({ color: "#5B8FA3" });
    expect(calendarEventStyle(tag.color, false)).toEqual(calendarEventStyle("#55B7FA", false));
    expect(tag.color).toBe("#5B8FA3");
  });
  it("uses pale backgrounds, distinct tinted text and transparent past blocks", () => {
    for (const color of CATEGORY_PRESET_COLORS.slice(0, 7)) {
      const future = calendarEventStyle(color, false) as Record<string, string>;
      const past = calendarEventStyle(color, true) as Record<string, string>;
      expect(future["--event-fill"]).not.toBe(future["--event-ink"]);
      expect(past["--event-fill"]).toBe("transparent");
      expect(past["--event-dark-fill"]).toBe("transparent");
      expect(past["--event-ink"]).toBe(future["--event-ink"]);
    }
  });
  it("new random tags select only the seven bright selectable colors", () => {
    const random = vi.spyOn(Math, "random");
    CATEGORY_PRESET_COLORS.slice(0, 7).forEach((color, i) => {
      random.mockReturnValue((i + 0.5) / 7);
      expect(generateCategoryColor()).toBe(color.toLowerCase());
    });
  });
});
