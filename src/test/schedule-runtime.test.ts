import { beforeEach, describe, expect, it, vi } from "vitest";

const { getActiveTimeBlock, getDueReminderBlocks, markTimeBlockReminded, sendNotification } = vi.hoisted(() => ({
  getActiveTimeBlock: vi.fn(),
  getDueReminderBlocks: vi.fn(),
  markTimeBlockReminded: vi.fn(),
  sendNotification: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getActiveTimeBlock, getDueReminderBlocks, markTimeBlockReminded }));
vi.mock("@/lib/notifications", () => ({ sendNotification }));

import {
  formatScheduleMenuBarLabel,
  refreshScheduleRuntime,
  useScheduleRuntimeStore,
} from "@/features/schedule/use-schedule-runtime";

const active = {
  id: 3,
  title: "Paper writing",
  start_time: "2026-08-22 09:00:00",
  end_time: "2099-08-22 11:00:00",
  task_id: null,
  category_id: 4,
  color: null,
  completed: 0,
  created_at: "",
  session_id: 12,
  source_template_id: 1,
  source_template_block_id: 2,
  notification_enabled: 1,
  reminded_at: null,
  task_name: null,
  category_name: null,
  category_color: "#4F46E5",
};

beforeEach(() => {
  vi.clearAllMocks();
  getActiveTimeBlock.mockResolvedValue(active);
  getDueReminderBlocks.mockResolvedValue([active]);
  markTimeBlockReminded.mockResolvedValue(true);
  sendNotification.mockResolvedValue(undefined);
  useScheduleRuntimeStore.setState({ activeBlock: null, remainingSeconds: 0 });
});

describe("schedule runtime", () => {
  it("formats the macOS menu-bar as one schedule line", () => {
    expect(formatScheduleMenuBarLabel(active)).toMatch(
      /^Paper writing · \d+ hours? \d+ minutes? remaining$/,
    );
    expect(formatScheduleMenuBarLabel(null)).toBe("");
  });

  it("sends exactly one schedule alert without starting a timer session", async () => {
    await refreshScheduleRuntime();
    expect(markTimeBlockReminded).toHaveBeenCalledWith(active.id, active.start_time, expect.any(String));
    expect(sendNotification).toHaveBeenCalledWith("schedule-start", "Paper writing starts now.");
    expect(useScheduleRuntimeStore.getState().activeBlock?.id).toBe(active.id);
  });

  it("does not notify when another refresh already claimed the block", async () => {
    markTimeBlockReminded.mockResolvedValue(false);
    await refreshScheduleRuntime();
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
