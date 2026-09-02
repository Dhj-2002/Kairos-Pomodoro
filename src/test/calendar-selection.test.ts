import { describe, expect, it } from "vitest";
import {
  chronologicalBlockRange,
  selectionRectsIntersect,
} from "@/features/schedule/calendar-selection";
import type { TimeBlockWithMeta } from "@/lib/db";

function block(id: number, start: string): TimeBlockWithMeta {
  return {
    id,
    title: `Block ${id}`,
    start_time: start,
    end_time: new Date(new Date(start).getTime() + 30 * 60_000).toISOString(),
    task_id: null,
    category_id: null,
    color: null,
    completed: 0,
    created_at: "",
    session_id: id,
    source_template_id: null,
    source_template_block_id: null,
    notification_enabled: 1,
    reminded_at: null,
    task_name: null,
    category_name: null,
    category_color: null,
  };
}

describe("calendar multi-selection", () => {
  const blocks = [
    block(3, "2026-08-23 10:00:00"),
    block(1, "2026-08-23 08:00:00"),
    block(2, "2026-08-23 09:00:00"),
  ];

  it("selects one inclusive chronological range in either direction", () => {
    expect(chronologicalBlockRange(blocks, 1, 3)).toEqual([1, 2, 3]);
    expect(chronologicalBlockRange(blocks, 3, 1)).toEqual([1, 2, 3]);
  });

  it("falls back to only the target when the anchor is no longer visible", () => {
    expect(chronologicalBlockRange(blocks, 99, 2)).toEqual([2]);
  });

  it("includes blocks touched or crossed by the Shift-drag marquee", () => {
    expect(selectionRectsIntersect(
      { left: 10, top: 10, right: 50, bottom: 50 },
      { left: 50, top: 20, right: 70, bottom: 40 },
    )).toBe(true);
    expect(selectionRectsIntersect(
      { left: 10, top: 10, right: 50, bottom: 50 },
      { left: 51, top: 20, right: 70, bottom: 40 },
    )).toBe(false);
  });
});
