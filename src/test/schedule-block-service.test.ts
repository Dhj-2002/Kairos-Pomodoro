import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({}));

import {
  buildMovedTimeBlockInput,
  buildResizedTimeBlockInput,
  buildShiftedTimeBlockInputs,
  buildSequenceTimeBlockInputs,
  templateMinuteToDateTime,
  timeRangesOverlap,
} from "@/features/schedule/schedule-block-service";
import type { SequenceTemplateItem, TimeBlockWithMeta } from "@/lib/db";

describe("schedule block conversion", () => {
  it("applies template minutes to a local date and carries past midnight", () => {
    expect(templateMinuteToDateTime("2026-08-22", 555)).toBe("2026-08-22 09:15:00");
    expect(templateMinuteToDateTime("2026-08-22", 1500)).toBe("2026-08-23 01:00:00");
  });

  it("detects real overlap but permits touching boundaries", () => {
    const first = { start_time: "2026-08-22 09:00:00", end_time: "2026-08-22 10:00:00" };
    expect(timeRangesOverlap(first, { start_time: "2026-08-22 09:30:00", end_time: "2026-08-22 10:30:00" })).toBe(true);
    expect(timeRangesOverlap(first, { start_time: "2026-08-22 10:00:00", end_time: "2026-08-22 11:00:00" })).toBe(false);
  });

  it("moves a block across days while preserving duration and metadata", () => {
    const block = {
      id: 7,
      title: "Research",
      start_time: "2026-08-22 08:00:00",
      end_time: "2026-08-22 08:30:00",
      task_id: 2,
      category_id: 3,
      color: null,
      completed: 0,
      created_at: "2026-08-22 07:00:00",
      session_id: 9,
      source_template_id: 4,
      source_template_block_id: 5,
      notification_enabled: 1,
      reminded_at: null,
      task_name: null,
      category_name: "Study",
      category_color: "#123456",
    } satisfies TimeBlockWithMeta;

    const moved = buildMovedTimeBlockInput(block, new Date(2026, 7, 23, 10, 15, 0));
    expect(moved.start_time).toBe("2026-08-23 10:15:00");
    expect(moved.end_time).toBe("2026-08-23 10:45:00");
    expect(moved.category_id).toBe(3);
    expect(moved.source_template_id).toBe(4);
    expect(moved.notification_enabled).toBe(1);
  });

  it("moves a selected group by one shared delta without changing spacing", () => {
    const base = {
      id: 7,
      title: "Research",
      start_time: "2026-08-22 23:30:00",
      end_time: "2026-08-23 00:00:00",
      task_id: null,
      category_id: 3,
      color: "#123456",
      completed: 0,
      created_at: "",
      session_id: 9,
      source_template_id: null,
      source_template_block_id: null,
      notification_enabled: 1,
      reminded_at: null,
      task_name: null,
      category_name: "Study",
      category_color: "#123456",
    } satisfies TimeBlockWithMeta;
    const second = {
      ...base,
      id: 8,
      start_time: "2026-08-23 00:15:00",
      end_time: "2026-08-23 01:15:00",
      session_id: 10,
    } satisfies TimeBlockWithMeta;

    const moves = buildShiftedTimeBlockInputs([base, second], 30 * 60_000);
    expect(moves.map(({ input }) => [input.start_time, input.end_time])).toEqual([
      ["2026-08-23 00:00:00", "2026-08-23 00:30:00"],
      ["2026-08-23 00:45:00", "2026-08-23 01:45:00"],
    ]);
  });

  it("resizes a block on the 15-minute grid with a 15-minute minimum", () => {
    const block = {
      id: 7,
      title: "Research",
      start_time: "2026-08-22 08:00:00",
      end_time: "2026-08-22 08:30:00",
      task_id: 2,
      category_id: 3,
      color: null,
      completed: 0,
      created_at: "2026-08-22 07:00:00",
      session_id: 9,
      source_template_id: 4,
      source_template_block_id: 5,
      notification_enabled: 1,
      reminded_at: null,
      task_name: null,
      category_name: "Study",
      category_color: "#123456",
    } satisfies TimeBlockWithMeta;

    const longer = buildResizedTimeBlockInput(block, new Date(2026, 7, 22, 9, 8));
    expect(longer.start_time).toBe("2026-08-22 08:00:00");
    expect(longer.end_time).toBe("2026-08-22 09:15:00");
    expect(longer.category_id).toBe(3);
    expect(longer.source_template_id).toBe(4);

    const minimum = buildResizedTimeBlockInput(block, new Date(2026, 7, 22, 7, 0));
    expect(minimum.end_time).toBe("2026-08-22 08:15:00");
  });

  it("builds a consecutive sequence from the clicked slot across midnight", () => {
    const items = [
      {
        id: 1,
        template_id: 3,
        quick_block_id: 2,
        title: "Research",
        duration_minutes: 30,
        color: "#224466",
        category_id: 7,
        notification_enabled: 1,
        sort_order: 0,
      },
      {
        id: 2,
        template_id: 3,
        quick_block_id: null,
        title: "Sleep",
        duration_minutes: 480,
        color: "#443366",
        category_id: null,
        notification_enabled: 0,
        sort_order: 1,
      },
    ] satisfies SequenceTemplateItem[];

    const inputs = buildSequenceTimeBlockInputs(
      items,
      new Date(2026, 7, 22, 23, 45, 0),
    );

    expect(inputs).toEqual([
      {
        title: "Research",
        start_time: "2026-08-22 23:45:00",
        end_time: "2026-08-23 00:15:00",
        category_id: 7,
        color: null,
        notification_enabled: 1,
      },
      {
        title: "Sleep",
        start_time: "2026-08-23 00:15:00",
        end_time: "2026-08-23 08:15:00",
        category_id: null,
        color: "#94A3B8",
        notification_enabled: 0,
      },
    ]);
  });
});
