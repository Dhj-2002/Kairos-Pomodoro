import { useEffect } from "react";
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import {
  getActiveTimeBlock,
  getDueReminderBlocks,
  markTimeBlockReminded,
  type TimeBlockWithMeta,
} from "@/lib/db";
import { sendNotification } from "@/lib/notifications";
import { isTauri } from "@/lib/tauri";
import { parseDbDateTime } from "@/lib/time";
import { formatMinutesAsDuration } from "@/lib/session-utils";

interface ScheduleRuntimeState {
  activeBlock: TimeBlockWithMeta | null;
  remainingSeconds: number;
  setActiveBlock: (block: TimeBlockWithMeta | null) => void;
  tick: () => void;
}

function remainingFor(block: TimeBlockWithMeta | null): number {
  if (!block) return 0;
  return Math.max(0, Math.ceil((parseDbDateTime(block.end_time).getTime() - Date.now()) / 1000));
}

export function formatScheduleMenuBarLabel(block: TimeBlockWithMeta | null): string {
  const seconds = remainingFor(block);
  if (!block || seconds <= 0) return "";
  const totalMinutes = Math.ceil(seconds / 60);
  const remaining = formatMinutesAsDuration(totalMinutes);
  const name = block.title || block.task_name || "Scheduled focus";
  return `${name} · ${remaining} remaining`;
}

function publishScheduleMenuBarStatus(block: TimeBlockWithMeta | null): void {
  if (!isTauri()) return;
  void invoke("menubar_set_title", { title: formatScheduleMenuBarLabel(block) }).catch(() => {});
}

export const useScheduleRuntimeStore = create<ScheduleRuntimeState>((set, get) => ({
  activeBlock: null,
  remainingSeconds: 0,
  setActiveBlock: (activeBlock) => {
    const remainingSeconds = remainingFor(activeBlock);
    set({ activeBlock, remainingSeconds });
    publishScheduleMenuBarStatus(activeBlock);
  },
  tick: () => {
    const activeBlock = get().activeBlock;
    const remainingSeconds = remainingFor(activeBlock);
    const nextBlock = remainingSeconds > 0 ? activeBlock : null;
    set({ remainingSeconds, activeBlock: nextBlock });
    publishScheduleMenuBarStatus(nextBlock);
  },
}));

function toLocalDbDateTime(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export async function refreshScheduleRuntime(): Promise<void> {
  const now = toLocalDbDateTime();
  const [activeBlock, dueBlocks] = await Promise.all([
    getActiveTimeBlock(now),
    getDueReminderBlocks(now),
  ]);
  useScheduleRuntimeStore.getState().setActiveBlock(activeBlock);

  for (const block of dueBlocks) {
    // Claim the reminder with its expected start time before sending. This
    // makes overlapping refreshes and app wake-ups idempotent.
    const claimed = await markTimeBlockReminded(block.id, block.start_time, now);
    if (!claimed) continue;
    const label = block.title || block.task_name || block.category_name || "Scheduled focus time";
    await sendNotification("schedule-start", `${label} starts now.`);
  }
}

/** Keep schedule awareness alive while the main webview is open or hidden.
 * Step 1 refreshes active schedule/reminder state, step 2 ticks the absolute
 * deadline, and both publish display-only state to the macOS menu bar.
 * No Timer action or session write occurs here. */
export function useScheduleRuntime(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;

    const refresh = () => {
      refreshScheduleRuntime().catch((error) => {
        if (!disposed) console.error("[Schedule] Runtime refresh failed:", error);
      });
    };
    refresh();
    const refreshId = window.setInterval(refresh, 15_000);
    const tickId = window.setInterval(() => useScheduleRuntimeStore.getState().tick(), 1_000);

    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", refresh);

    return () => {
      disposed = true;
      window.clearInterval(refreshId);
      window.clearInterval(tickId);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", refresh);
    };
  }, [enabled]);
}

export { toLocalDbDateTime };
