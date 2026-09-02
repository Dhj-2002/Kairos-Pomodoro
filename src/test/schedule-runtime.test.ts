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
  buildScheduleWindowStatus,
  refreshScheduleRuntime,
  useScheduleRuntimeStore,
} from "@/features/schedule/use-schedule-runtime";
import { DEFAULT_CATEGORY_COLOR } from "@/lib/constants";

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
  it("builds display-only state for the Windows mini window", () => {
    expect(buildScheduleWindowStatus(active)).toMatchObject({
      active: true,
      label: "Paper writing",
      color: "#4F46E5",
      endTime: active.end_time,
    });
    expect(buildScheduleWindowStatus(null)).toEqual({
      active: false,
      label: "Scheduled focus",
      color: DEFAULT_CATEGORY_COLOR,
      endTime: null,
      remainingSeconds: 0,
    });
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
