import { describe, expect, it } from "vitest";
import { parseDbDateTime } from "@/lib/time";
import { computeVisibleHourRange } from "@/components/base/calendar-grid";
import type { WeekSession, TimeBlockWithMeta } from "@/lib/db";

describe("SQLite datetime compatibility", () => {
  it("parses local SQLite timestamps without native Date string parsing", () => {
    const parsed = parseDbDateTime("2026-08-30 23:19:07");
    expect(Number.isNaN(parsed.getTime())).toBe(false);
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(7);
    expect(parsed.getDate()).toBe(30);
    expect(parsed.getHours()).toBe(23);
    expect(parsed.getMinutes()).toBe(19);
  });

  it("keeps a complete finite calendar range for historical SQLite rows", () => {
    const session = {
      id: 1,
      started_at: "2026-08-30 08:00:00",
      duration_sec: 3600,
    } as WeekSession;
    const block = {
      id: 1,
      start_time: "2026-08-30 22:00:00",
      end_time: "2026-08-30 23:30:00",
    } as TimeBlockWithMeta;

    expect(computeVisibleHourRange([session], [block], 0, 23)).toEqual({
      startHour: 0,
      endHour: 23,
    });
  });
});
