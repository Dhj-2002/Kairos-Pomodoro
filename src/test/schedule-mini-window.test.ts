import { describe, expect, it } from "vitest";
import {
  formatMiniDateTime,
  formatMiniScheduleLabel,
} from "@/components/schedule/schedule-mini-window";

describe("schedule mini window label", () => {
  it("shows remaining minutes and the block name on one line", () => {
    expect(formatMiniScheduleLabel(true, 26, "休闲")).toBe("26 MIN · 休闲");
  });

  it("keeps the idle label when no block is active", () => {
    expect(formatMiniScheduleLabel(false, 0, "Ignored")).toBe("No active schedule");
  });

  it("formats local date and time as a compact first line", () => {
    expect(formatMiniDateTime(new Date(2026, 7, 24, 13, 6))).toBe("8/24 1:06pm");
    expect(formatMiniDateTime(new Date(2026, 7, 24, 0, 3))).toBe("8/24 12:03am");
  });
});
