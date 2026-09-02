import { describe, expect, it } from "vitest";
import { resolveScheduleBlockColor } from "@/features/schedule/schedule-block-color";

describe("schedule block Tag colors", () => {
  it("uses the Tag color and ignores a legacy block-level color", () => {
    expect(resolveScheduleBlockColor({ category_id: 4, category_color: "#123456" })).toBe("#123456");
  });

  it("renders every untagged or missing Tag block in neutral gray", () => {
    expect(resolveScheduleBlockColor({ category_id: null, category_color: "#ffcc00" })).toBe("#94A3B8");
    expect(resolveScheduleBlockColor({ category_id: 4, category_color: null })).toBe("#94A3B8");
    expect(resolveScheduleBlockColor(null)).toBe("#94A3B8");
  });
});
