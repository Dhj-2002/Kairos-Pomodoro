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
  addQuickBlock,
  appendQuickBlockToSequence,
  deleteQuickBlock,
  getSequenceTemplates,
  reorderSequenceTemplateItems,
  updateQuickBlock,
} from "@/lib/db/sequence-templates";

beforeEach(() => vi.clearAllMocks());

describe("lightweight sequence templates", () => {
  it("validates and creates customizable quick blocks", async () => {
    await expect(addQuickBlock({ name: "", duration_minutes: 30, color: "#fff" })).rejects.toThrow("required");
    await expect(addQuickBlock({ name: "Read", duration_minutes: 0, color: "#fff" })).rejects.toThrow("between 1 and 1440");

    select.mockResolvedValueOnce([{ value: 4 }]);
    execute.mockResolvedValueOnce({ lastInsertId: 8, rowsAffected: 1 });
    expect(await addQuickBlock({ name: "Read", duration_minutes: 45, color: "#123456", notification_enabled: false })).toBe(8);
    expect(execute.mock.calls[0][1]).toEqual(["Read", 45, "#123456", null, 0, 4]);
  });

  it("appends a snapshot instead of a mutable palette reference only", async () => {
    select
      .mockResolvedValueOnce([{
        id: 3,
        name: "Writing",
        duration_minutes: 60,
        color: "#c96a2b",
        category_id: 4,
        notification_enabled: 1,
      }])
      .mockResolvedValueOnce([{ value: 2 }]);
    execute.mockResolvedValueOnce({ lastInsertId: 12, rowsAffected: 1 });

    expect(await appendQuickBlockToSequence(5, 3)).toBe(12);
    expect(execute.mock.calls[0][1]).toEqual([5, 3, "Writing", 60, "#c96a2b", 4, 1, 2]);
  });

  it("synchronizes a changed name and tag to template references only", async () => {
    await updateQuickBlock(3, {
      name: "Deep Writing",
      duration_minutes: 60,
      category_id: 9,
      notification_enabled: true,
    });

    expect(execute.mock.calls[0][1]).toEqual(["Deep Writing", 60, "#C17767", 9, 1, 3]);
    expect(execute.mock.calls[1][0]).toMatch(/UPDATE sequence_template_items SET title/);
    expect(execute.mock.calls[1][1]).toEqual(["Deep Writing", 9, 3]);
  });

  it("persists exact drag order", async () => {
    await reorderSequenceTemplateItems(5, [9, 4, 7]);
    expect(execute.mock.calls.map((call) => call[1])).toEqual([
      [0, 9, 5],
      [1, 4, 5],
      [2, 7, 5],
    ]);
  });

  it("keeps saved snapshots when a palette block is deleted", async () => {
    await deleteQuickBlock(3);
    expect(execute.mock.calls[0][0]).toMatch(/SET quick_block_id = NULL/);
    expect(execute.mock.calls[1][0]).toMatch(/DELETE FROM quick_blocks/);
  });

  it("reports sequence block count and total duration", async () => {
    select.mockResolvedValueOnce([{ id: 1, name: "Focus Flow", item_count: 3, total_minutes: 195 }]);
    const rows = await getSequenceTemplates();
    expect(rows[0]).toMatchObject({ item_count: 3, total_minutes: 195 });
    expect(select.mock.calls[0][0]).toMatch(/SUM\(si\.duration_minutes\)/);
  });
});
