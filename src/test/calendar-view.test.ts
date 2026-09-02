import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  buildCenteredSevenDays,
  parseCalendarViewPreference,
  resolveCalendarCenter,
  shiftCalendarView,
  toLocalISODate,
} from "@/features/schedule/calendar-view";

describe("centered calendar view", () => {
  it("places the center date between the previous and next three days", () => {
    const days = buildCenteredSevenDays(new Date(2026, 7, 23, 18, 30));
    expect(days.map(toLocalISODate)).toEqual([
      "2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23",
      "2026-08-24", "2026-08-25", "2026-08-26",
    ]);
  });

  it("crosses month and year boundaries with calendar arithmetic", () => {
    const days = buildCenteredSevenDays(new Date(2026, 0, 1));
    expect(days.map(toLocalISODate)).toEqual([
      "2025-12-29", "2025-12-30", "2025-12-31", "2026-01-01",
      "2026-01-02", "2026-01-03", "2026-01-04",
    ]);
    expect(toLocalISODate(addCalendarDays(new Date(2024, 1, 28), 1))).toBe("2024-02-29");
  });

  it("restores a valid custom center and rejects malformed persisted state", () => {
    const custom = parseCalendarViewPreference('{"mode":"custom","centerDate":"2026-09-04"}');
    expect(custom).toEqual({ mode: "custom", centerDate: "2026-09-04" });
    expect(toLocalISODate(resolveCalendarCenter(custom, new Date(2030, 0, 1)))).toBe("2026-09-04");
    expect(parseCalendarViewPreference('{"mode":"custom","centerDate":"2026-02-31"}')).toEqual({ mode: "today" });
    expect(parseCalendarViewPreference("broken")).toEqual({ mode: "today" });
  });

  it("moves exactly one day and changes Today mode into persisted custom mode", () => {
    const now = new Date(2026, 7, 23, 15, 0);
    expect(shiftCalendarView({ mode: "today" }, 1, now)).toEqual({ mode: "custom", centerDate: "2026-08-24" });
    expect(shiftCalendarView({ mode: "custom", centerDate: "2026-08-24" }, -1, now)).toEqual({ mode: "custom", centerDate: "2026-08-23" });
  });
});
