import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, select } = vi.hoisted(() => ({
  execute: vi.fn().mockResolvedValue({ lastInsertId: 1, rowsAffected: 1 }),
  select: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/db/schema", () => ({
  getDb: vi.fn().mockResolvedValue({ execute, select }),
  withSerializedWrite: vi.fn(async (work) => work({ execute, select })),
}));

import {
  addScheduleTemplate,
  addTemplateBlock,
  duplicateScheduleTemplate,
  getScheduleTemplates,
  timeBlockToTemplateInput,
} from "@/lib/db/schedule-templates";
import type { TimeBlockWithMeta } from "@/lib/db";

beforeEach(() => vi.clearAllMocks());

describe("schedule template repository", () => {
  it("lists templates with block counts", async () => {
    select.mockResolvedValueOnce([{ id: 1, name: "Research", block_count: 3 }]);
    const rows = await getScheduleTemplates();
    expect(rows[0].block_count).toBe(3);
    expect(select.mock.calls[0][0]).toMatch(/COUNT\(tb\.id\)/);
  });

  it("creates editable templates and validates blocks", async () => {
    execute.mockResolvedValueOnce({ lastInsertId: 8, rowsAffected: 1 });
    await expect(addScheduleTemplate({ name: "   ", color: "#fff" })).rejects.toThrow("required");
    expect(await addScheduleTemplate({ name: "Research", color: "#fff" })).toBe(8);

    await expect(addTemplateBlock(8, { start_minute: 1440, duration_minutes: 30 })).rejects.toThrow("1439");
    await addTemplateBlock(8, {
      title: "Writing",
      start_minute: 540,
      duration_minutes: 90,
      notification_enabled: true,
    });
    expect(execute.mock.calls.at(-1)?.[1]).toEqual([8, "Writing", null, 540, 90, 1, 0]);
  });

  it("duplicates a template and all of its blocks", async () => {
    select.mockResolvedValueOnce([{ id: 2, name: "Light Day", color: "#abc", description: null }]);
    execute.mockResolvedValueOnce({ lastInsertId: 9, rowsAffected: 1 });
    const id = await duplicateScheduleTemplate(2);
    expect(id).toBe(9);
    expect(execute.mock.calls[1][0]).toMatch(/INSERT INTO template_blocks/);
    expect(execute.mock.calls[1][1]).toEqual([9, 2]);
  });

  it("captures local wall-clock time and duration from a day block", () => {
    const block: TimeBlockWithMeta = {
      id: 1,
      title: "Read",
      start_time: "2026-08-22 09:15:00",
      end_time: "2026-08-22 10:45:00",
      task_id: null,
      category_id: 2,
      color: null,
      completed: 0,
      created_at: "",
      session_id: 7,
      source_template_id: null,
      source_template_block_id: null,
      notification_enabled: 1,
      reminded_at: null,
      task_name: null,
      category_name: "Reading",
      category_color: "#abc",
    };
    expect(timeBlockToTemplateInput(block, 4)).toMatchObject({
      start_minute: 555,
      duration_minutes: 90,
      category_id: 2,
      sort_order: 4,
    });
  });
});

