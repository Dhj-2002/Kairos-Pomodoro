import { describe, it, expect } from "vitest";
import {
  computeDayLayout,
  computeVisibleHourRange,
  exceedsBlockDragThreshold,
  resolveSnappedSlot,
  resolveSnappedStart,
} from "@/components/base/calendar-grid";
import type { WeekSession, TimeBlockWithMeta } from "@/lib/db";

/**
 * Regression tests for the calendar positioning bug where a logged time block
 * (e.g. 12:30–13:30) rendered at the wrong axis row (~09:00).
 *
 * Root cause: session cards used to *expand* their containing hour row, and the
 * shared time axis took the per-column max — so a block's pixel position in its
 * own column no longer lined up with the axis labels. These tests pin the
 * invariant that fixes it: every hour row is exactly BASE_HOUR_HEIGHT tall
 * regardless of content, and a card's topPx is derived purely from its time.
 */

const START_HOUR = 6;
const END_HOUR = 22;
const BASE_HOUR_HEIGHT = 64;

function makeSession(over: Partial<WeekSession>): WeekSession {
  return {
    id: 1,
    task_id: null,
    task_name: null,
    phase: "work",
    started_at: "2026-07-05 09:00:00",
    duration_sec: 1500,
    completed: 1,
    category_id: null,
    category_name: null,
    category_color: null,
    intention: null,
    mood: null,
    notes: null,
    ...over,
  };
}

function makeBlock(over: Partial<TimeBlockWithMeta>): TimeBlockWithMeta {
  return {
    id: 1,
    title: null,
    start_time: "2026-07-05 12:30:00",
    end_time: "2026-07-05 13:30:00",
    task_id: null,
    category_id: null,
    color: null,
    completed: 0,
    created_at: "",
    session_id: null,
    source_template_id: null,
    source_template_block_id: null,
    notification_enabled: 1,
    reminded_at: null,
    task_name: null,
    category_name: null,
    category_color: null,
    ...over,
  };
}

describe("computeDayLayout — uniform hour grid", () => {
  it("keeps clicks and drag gestures separate at the six-pixel threshold", () => {
    expect(exceedsBlockDragThreshold(100, 100, 104, 103)).toBe(false);
    expect(exceedsBlockDragThreshold(100, 100, 106, 100)).toBe(true);
    expect(exceedsBlockDragThreshold(100, 100, 104, 105)).toBe(true);
  });

  it("snaps empty-grid clicks down to 15-minute start slots", () => {
    const date = new Date(2026, 6, 5, 0, 0, 0, 0);
    const layout = computeDayLayout([], [], START_HOUR, END_HOUR);
    const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
    const rowNine = (9 - START_HOUR) * BASE_HOUR_HEIGHT;
    const atMinute = (minute: number) => rowNine + (minute / 60) * BASE_HOUR_HEIGHT;

    expect(resolveSnappedStart(date, atMinute(14), layout, hours).getMinutes()).toBe(0);
    expect(resolveSnappedStart(date, atMinute(15), layout, hours).getMinutes()).toBe(15);
    expect(resolveSnappedStart(date, atMinute(37), layout, hours).getMinutes()).toBe(30);
    expect(resolveSnappedStart(date, atMinute(59), layout, hours).getMinutes()).toBe(45);
    expect(resolveSnappedStart(date, atMinute(37), layout, hours).getHours()).toBe(9);
  });

  it("uses the same snapped time and top position for hover feedback", () => {
    const date = new Date(2026, 6, 5, 0, 0, 0, 0);
    const layout = computeDayLayout([], [], START_HOUR, END_HOUR);
    const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
    const rowTwenty = (20 - START_HOUR) * BASE_HOUR_HEIGHT;

    const expected = [
      { y: rowTwenty + 1, minute: 0, topPx: rowTwenty, quarterIndex: 0 },
      { y: rowTwenty + 17, minute: 15, topPx: rowTwenty + 16, quarterIndex: 1 },
      { y: rowTwenty + 33, minute: 30, topPx: rowTwenty + 32, quarterIndex: 2 },
      { y: rowTwenty + 49, minute: 45, topPx: rowTwenty + 48, quarterIndex: 3 },
    ];

    for (const item of expected) {
      const slot = resolveSnappedSlot(date, item.y, layout, hours);
      expect(slot.startDate.getHours()).toBe(20);
      expect(slot.startDate.getMinutes()).toBe(item.minute);
      expect(slot.topPx).toBe(item.topPx);
      expect(slot.quarterIndex).toBe(item.quarterIndex);
      expect(resolveSnappedStart(date, item.y, layout, hours).getTime()).toBe(slot.startDate.getTime());
    }
  });

  it("every hour row is exactly BASE_HOUR_HEIGHT, even when sessions are present", () => {
    // A session that previously inflated its hour row (old min-height was 100px).
    const sessions = [
      makeSession({ id: 1, started_at: "2026-07-05 09:00:00", duration_sec: 1500 }),
    ];
    const layout = computeDayLayout(sessions, [], START_HOUR, END_HOUR);

    for (let h = 0; h < layout.hourTopPx.length - 1; h++) {
      expect(layout.hourTopPx[h + 1] - layout.hourTopPx[h]).toBe(BASE_HOUR_HEIGHT);
    }
  });

  it("a block at 12:30 sits on the 12:00 axis row (the reported bug)", () => {
    const block = makeBlock({ start_time: "2026-07-05 12:30:00", end_time: "2026-07-05 13:30:00" });
    const layout = computeDayLayout([], [block], START_HOUR, END_HOUR);

    const positioned = layout.positionedBlocks[0];
    // hours[0] === START_HOUR (6), so the 12:00 row is index 6.
    const row12Start = layout.hourTopPx[12 - START_HOUR];
    const row12End = layout.hourTopPx[12 - START_HOUR + 1];
    expect(positioned.topPx).toBeGreaterThanOrEqual(row12Start);
    expect(positioned.topPx).toBeLessThan(row12End);

    // And its topPx is the pure time-derived value (6.5h * 64 = 416),
    // computed from the same Date parse the production code uses so the
    // assertion holds in any runtime timezone.
    const d = new Date(block.start_time);
    const startMin = (d.getHours() - START_HOUR) * 60 + d.getMinutes();
    expect(positioned.topPx).toBe((startMin / 60) * BASE_HOUR_HEIGHT);
  });

  it("a block's position is not affected by sessions on the same day", () => {
    // Morning sessions on the same column must not shift an afternoon block.
    const sessions = [
      makeSession({ id: 1, started_at: "2026-07-05 08:00:00", duration_sec: 3600 }),
      makeSession({ id: 2, started_at: "2026-07-05 10:00:00", duration_sec: 3600 }),
    ];
    const block = makeBlock({ start_time: "2026-07-05 12:30:00", end_time: "2026-07-05 13:30:00" });

    const withSessions = computeDayLayout(sessions, [block], START_HOUR, END_HOUR);
    const withoutSessions = computeDayLayout([], [block], START_HOUR, END_HOUR);

    expect(withSessions.positionedBlocks[0].topPx).toBe(
      withoutSessions.positionedBlocks[0].topPx,
    );
  });

  it("back-to-back sessions keep their true time positions (no overlap-shift)", () => {
    // Two adjacent 25-min sessions at 09:00 and 09:25. Previously the second
    // was nudged to existingEnd + 4, detaching it from its labeled time.
    const sessions = [
      makeSession({ id: 1, started_at: "2026-07-05 09:00:00", duration_sec: 1500 }),
      makeSession({ id: 2, started_at: "2026-07-05 09:25:00", duration_sec: 1500 }),
    ];
    const layout = computeDayLayout(sessions, [], START_HOUR, END_HOUR);

    const d2 = new Date(sessions[1].started_at);
    const startMin = (d2.getHours() - START_HOUR) * 60 + d2.getMinutes();
    expect(layout.positioned[1].topPx).toBe((startMin / 60) * BASE_HOUR_HEIGHT);
  });

  it("places overlapping time blocks in horizontal lanes", () => {
    const layout = computeDayLayout([], [
      makeBlock({ id: 1, start_time: "2026-07-05 16:00:00", end_time: "2026-07-05 16:25:00" }),
      makeBlock({ id: 2, start_time: "2026-07-05 16:00:00", end_time: "2026-07-05 16:25:00" }),
      makeBlock({ id: 3, start_time: "2026-07-05 17:00:00", end_time: "2026-07-05 17:25:00" }),
    ], START_HOUR, END_HOUR);

    const [first, second, backToBack] = layout.positionedBlocks;
    expect(first.columnCount).toBe(2);
    expect(second.columnCount).toBe(2);
    expect(first.columnIndex).toBe(0);
    expect(second.columnIndex).toBe(1);
    expect(first.stackIndex).toBe(0);
    expect(second.stackIndex).toBe(1);
    expect(backToBack.columnCount).toBe(1);
    expect(backToBack.columnIndex).toBe(0);
  });

  it("keeps consecutive 30-minute focus blocks on their exact grid lines", () => {
    const layout = computeDayLayout([], [
      makeBlock({ id: 1, start_time: "2026-07-05 08:00:00", end_time: "2026-07-05 08:30:00" }),
      makeBlock({ id: 2, start_time: "2026-07-05 08:30:00", end_time: "2026-07-05 09:00:00" }),
      makeBlock({ id: 3, start_time: "2026-07-05 09:00:00", end_time: "2026-07-05 09:30:00" }),
      makeBlock({ id: 4, start_time: "2026-07-05 09:30:00", end_time: "2026-07-05 10:00:00" }),
    ], START_HOUR, END_HOUR);

    expect(layout.positionedBlocks.map((block) => block.topPx)).toEqual([128, 160, 192, 224]);
    expect(layout.positionedBlocks.map((block) => block.heightPx)).toEqual([32, 32, 32, 32]);
    expect(layout.positionedBlocks.map((block) => block.stackIndex)).toEqual([0, 0, 0, 0]);
  });

  it("never changes the vertical position of truly overlapping focus blocks", () => {
    const layout = computeDayLayout([], [
      makeBlock({ id: 1, start_time: "2026-07-05 08:00:00", end_time: "2026-07-05 08:30:00" }),
      makeBlock({ id: 2, start_time: "2026-07-05 08:00:00", end_time: "2026-07-05 08:30:00" }),
    ], START_HOUR, END_HOUR);

    expect(layout.positionedBlocks.map((block) => block.topPx)).toEqual([128, 128]);
    expect(layout.positionedBlocks.map((block) => block.heightPx)).toEqual([32, 32]);
    expect(layout.positionedBlocks.map((block) => block.columnIndex)).toEqual([0, 1]);
    expect(layout.positionedBlocks.map((block) => block.columnCount)).toEqual([2, 2]);
  });

  it("splits dense overlap groups into readable horizontal lanes", () => {
    const layout = computeDayLayout([], [
      makeBlock({ id: 1, start_time: "2026-07-05 16:00:00", end_time: "2026-07-05 16:25:00" }),
      makeBlock({ id: 2, start_time: "2026-07-05 16:00:00", end_time: "2026-07-05 16:25:00" }),
      makeBlock({ id: 3, start_time: "2026-07-05 16:00:00", end_time: "2026-07-05 16:25:00" }),
      makeBlock({ id: 4, start_time: "2026-07-05 16:00:00", end_time: "2026-07-05 16:25:00" }),
    ], START_HOUR, END_HOUR);

    expect(layout.positionedBlocks.map((block) => [
      block.columnIndex,
      block.columnCount,
      block.stackIndex,
    ])).toEqual([
      [0, 4, 0],
      [1, 4, 1],
      [2, 4, 2],
      [3, 4, 3],
    ]);
  });
});

describe("computeVisibleHourRange — dynamic axis window", () => {
  // Default window is 6–22; it must expand (in whole-hour steps) to include any
  // session or block that falls outside it, so a 12:30 AM block no longer
  // clamps to the 6 AM row (the reported bug) and an 11 PM session isn't cut.
  it("returns the default 6–22 window when all content fits inside it", () => {
    const range = computeVisibleHourRange(
      [makeSession({ started_at: "2026-07-05 09:00:00", duration_sec: 1500 })],
      [makeBlock({ start_time: "2026-07-05 12:30:00", end_time: "2026-07-05 13:30:00" })],
      START_HOUR,
      END_HOUR,
    );
    expect(range).toEqual({ startHour: 6, endHour: 22 });
  });

  it("expands the start hour down to cover a block before 6 AM", () => {
    // 00:30 block → axis must start at 0 so the card lands on the 00:00 row.
    const range = computeVisibleHourRange(
      [],
      [makeBlock({ start_time: "2026-07-05 00:30:00", end_time: "2026-07-05 01:15:00" })],
      START_HOUR,
      END_HOUR,
    );
    expect(range).toEqual({ startHour: 0, endHour: 22 });
  });

  it("expands the end hour up to cover a session after 22:00", () => {
    // 23:00 session → axis must end at 23 so the card isn't clamped to 22:00.
    const range = computeVisibleHourRange(
      [makeSession({ started_at: "2026-07-05 23:00:00", duration_sec: 1500 })],
      [],
      START_HOUR,
      END_HOUR,
    );
    expect(range).toEqual({ startHour: 6, endHour: 23 });
  });

  it("expands both ends when content spans before 6 AM and after 22:00", () => {
    const range = computeVisibleHourRange(
      [makeSession({ started_at: "2026-07-05 23:30:00", duration_sec: 900 })],
      [makeBlock({ start_time: "2026-07-05 02:00:00", end_time: "2026-07-05 02:45:00" })],
      START_HOUR,
      END_HOUR,
    );
    expect(range).toEqual({ startHour: 2, endHour: 23 });
  });

  it("ignores out-of-window content whose hour is already covered", () => {
    // 18:00 is inside 6–22; the window must not change.
    const range = computeVisibleHourRange(
      [],
      [makeBlock({ start_time: "2026-07-05 18:00:00", end_time: "2026-07-05 18:30:00" })],
      START_HOUR,
      END_HOUR,
    );
    expect(range).toEqual({ startHour: 6, endHour: 22 });
  });
});
