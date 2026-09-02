import { useEffect, useMemo, useState } from "react";
import { Clock3, GripVertical } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalPosition } from "@tauri-apps/api/window";
import {
  restoreStateCurrent,
  saveWindowState,
  StateFlags,
} from "@tauri-apps/plugin-window-state";
import {
  SCHEDULE_WINDOW_EVENT,
  type ScheduleWindowStatus,
} from "@/features/schedule/use-schedule-runtime";
import { DEFAULT_CATEGORY_COLOR } from "@/lib/constants";

const MINI_WIDTH = 360;
const MINI_HEIGHT = 84;
const EDGE_MARGIN = 20;
const MINI_POSITION_SAVED_KEY = "kairos-mini-position-saved";

const IDLE_STATUS: ScheduleWindowStatus = {
  active: false,
  label: "No active schedule",
  color: DEFAULT_CATEGORY_COLOR,
  endTime: null,
  remainingSeconds: 0,
};

function remainingFromStatus(status: ScheduleWindowStatus): number {
  if (!status.active || !status.endTime) return 0;
  return Math.max(0, Math.ceil((new Date(status.endTime).getTime() - Date.now()) / 1000));
}

/** Build the mini window's bounded status line from time and block name. */
export function formatMiniScheduleLabel(
  active: boolean,
  minutes: number,
  blockName: string,
): string {
  // mini label step 1: Keep time compact and identify the block, not its tag.
  if (active) return `${minutes} MIN · ${blockName}`;

  // mini label step 2: Preserve an explicit idle state in the same one-line slot.
  return "No active schedule";
}

/** Format the mini window's local clock without locale-specific punctuation. */
export function formatMiniDateTime(now: Date): string {
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const period = now.getHours() >= 12 ? "pm" : "am";
  const hour = now.getHours() % 12 || 12;
  const minute = String(now.getMinutes()).padStart(2, "0");
  return `${month}/${day} ${hour}:${minute}${period}`;
}

/** Render the compact, display-only, always-on-top Windows schedule surface.
 * The colored clock identifies the active category, the first text line shows
 * local date/time, and the second shows remaining time plus the block name.
 * Clicking restores the main window, and native window state restores the
 * user's last dragged position. This component never writes sessions or reminders. */
export function ScheduleMiniWindow() {
  const [status, setStatus] = useState<ScheduleWindowStatus>(IDLE_STATUS);
  const [nowTick, setNowTick] = useState(0);

  // mini window step 1: Restore the last user-selected position before showing
  // the transparent surface; first-time users receive the bottom-right default.
  useEffect(() => {
    const mini = getCurrentWindow();
    document.body.style.background = "transparent";
    document.documentElement.style.background = "transparent";
    let disposed = false;
    let unlistenMoved: (() => void) | undefined;
    let saveTimeout: ReturnType<typeof window.setTimeout> | undefined;

    const positionAndShow = async () => {
      await mini.setAlwaysOnTop(true);
      let restored = false;
      if (window.localStorage.getItem(MINI_POSITION_SAVED_KEY) === "1") {
        try {
          await restoreStateCurrent(StateFlags.POSITION);
          restored = true;
        } catch (error) {
          console.warn("[ScheduleMiniWindow] Failed to restore the saved position:", error);
        }
      }
      if (!restored) {
        const x = Math.max(EDGE_MARGIN, window.screen.availWidth - MINI_WIDTH - EDGE_MARGIN);
        const y = Math.max(EDGE_MARGIN, window.screen.availHeight - MINI_HEIGHT - EDGE_MARGIN);
        await mini.setPosition(new LogicalPosition(x, y));
      }
      await mini.show();

      // mini window step 2: Debounce native move events, then persist only
      // position state after the user releases the drag.
      unlistenMoved = await mini.onMoved(() => {
        if (saveTimeout) window.clearTimeout(saveTimeout);
        saveTimeout = window.setTimeout(() => {
          void saveWindowState(StateFlags.POSITION)
            .then(() => window.localStorage.setItem(MINI_POSITION_SAVED_KEY, "1"))
            .catch((error) => console.warn("[ScheduleMiniWindow] Failed to save position:", error));
        }, 250);
      });
      if (disposed) unlistenMoved();
    };

    void positionAndShow();
    return () => {
      disposed = true;
      if (saveTimeout) window.clearTimeout(saveTimeout);
      unlistenMoved?.();
    };
  }, []);

  // mini window step 3: Receive read-only schedule snapshots from the main
  // webview. The mini window never opens a second database connection.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listen<ScheduleWindowStatus>(SCHEDULE_WINDOW_EVENT, ({ payload }) => {
      if (!disposed) setStatus(payload);
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // mini window step 4: Recalculate from the absolute end time locally so the
  // displayed countdown remains correct between main-window refreshes.
  useEffect(() => {
    const intervalId = window.setInterval(() => setNowTick((value) => value + 1), 1_000);
    return () => window.clearInterval(intervalId);
  }, []);

  const remainingSeconds = useMemo(() => remainingFromStatus(status), [status, nowTick]);
  const active = status.active && remainingSeconds > 0;
  const minutes = Math.ceil(remainingSeconds / 60);

  const restoreMain = () => {
    void invoke("show_main_window");
  };

  const startDragging = (event: React.MouseEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    void getCurrentWindow().startDragging();
  };

  return (
    <main className="h-screen w-screen overflow-hidden bg-transparent p-1 font-sans select-none">
      <div
        role="button"
        tabIndex={0}
        aria-label="Open Kairos-Pomodoro"
        title={`Hold Ctrl to interact · ${active ? status.label : "No active schedule"}`}
        onMouseDown={(event) => {
          if (event.button === 0) restoreMain();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") restoreMain();
        }}
        className="flex h-full w-full cursor-pointer items-center gap-3 rounded-[22px] border border-white/15 bg-neutral-800/50 px-4 shadow-2xl backdrop-blur-xl outline-none transition-transform hover:scale-[0.99] focus-visible:ring-2 focus-visible:ring-white/50"
      >
        <span
          onMouseDown={startDragging}
          title="Drag window"
          style={{ backgroundColor: status.color }}
          className="flex size-10 shrink-0 cursor-grab items-center justify-center rounded-full text-white active:cursor-grabbing"
        >
          <Clock3 className="size-[18px]" />
        </span>

        <span className="flex min-w-0 flex-1 flex-col justify-center text-left">
          <span className="truncate whitespace-nowrap text-[13px] font-semibold leading-none tracking-[0.03em] text-white/75">
            {formatMiniDateTime(new Date())}
          </span>
          <span className="mt-2 truncate whitespace-nowrap text-sm font-bold leading-none tracking-[0.06em] text-white">
            {formatMiniScheduleLabel(active, minutes, status.label)}
          </span>
        </span>

        <GripVertical className="size-4 shrink-0 text-white/45" aria-hidden="true" />
      </div>
    </main>
  );
}
