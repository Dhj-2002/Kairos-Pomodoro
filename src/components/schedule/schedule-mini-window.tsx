import { useEffect, useState } from "react";
import { Clock3, GripVertical } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalPosition } from "@tauri-apps/api/window";
import { restoreStateCurrent, saveWindowState, StateFlags } from "@tauri-apps/plugin-window-state";
import {
  SCHEDULE_WINDOW_EVENT,
  type ScheduleWindowStatus,
} from "@/features/schedule/use-schedule-runtime";
import { getSetting } from "@/lib/db";

const POSITION_KEY = "kairos-mini-position-saved";
const IDLE: ScheduleWindowStatus = {
  active: false,
  label: "No active schedule",
  color: "#6b8f71",
  endTime: null,
  remainingSeconds: 0,
};

export function formatMiniDateTime(now: Date): string {
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const period = now.getHours() >= 12 ? "pm" : "am";
  const hour = now.getHours() % 12 || 12;
  const minute = String(now.getMinutes()).padStart(2, "0");
  return `${month}/${day} ${hour}:${minute}${period}`;
}

/** Resolve the only startup visibility gate for the Windows mini window. */
export function shouldShowMiniWindow(savedSize: string | null): boolean {
  // visibility gate step 1: Missing legacy settings retain the enabled
  // default, while the explicit persisted Off value always remains hidden.
  return savedSize !== "off";
}

/** Windows schedule surface that may show only after its persisted visibility
 * preference has been read; Off always wins over startup restoration. */
export function ScheduleMiniWindow() {
  // mini startup step 1: Render transparently while the persisted preference
  // is checked, so this webview can never race the main window and re-show Off.
  const [status, setStatus] = useState(IDLE);
  const [, setClockTick] = useState(0);

  useEffect(() => {
    const mini = getCurrentWindow();
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";

    if (!navigator.userAgent.includes("Windows")) {
      void mini.hide();
      return;
    }

    let cleanupMove: (() => void) | undefined;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      const savedSize = await getSetting("miniWindowSize").catch(() => null);
      if (!shouldShowMiniWindow(savedSize)) {
        await mini.hide();
        return;
      }

      // mini startup step 2: Only an enabled size may restore position and
      // make the native window visible.
      await mini.setAlwaysOnTop(true);
      if (localStorage.getItem(POSITION_KEY) === "1") {
        await restoreStateCurrent(StateFlags.POSITION).catch(() => {});
      } else {
        await mini.setPosition(new LogicalPosition(
          Math.max(20, screen.availWidth - 360),
          Math.max(20, screen.availHeight - 48),
        ));
      }
      await mini.show();
      cleanupMove = await mini.onMoved(() => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          void saveWindowState(StateFlags.POSITION).then(() => localStorage.setItem(POSITION_KEY, "1"));
        }, 250);
      });
    })();

    return () => {
      if (saveTimer) clearTimeout(saveTimer);
      cleanupMove?.();
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClockTick((tick) => tick + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void listen<ScheduleWindowStatus>(SCHEDULE_WINDOW_EVENT, ({ payload }) => setStatus(payload))
      .then((unlisten) => { cleanup = unlisten; });
    return () => cleanup?.();
  }, []);

  const drag = (event: React.MouseEvent) => {
    if (event.button === 0) void getCurrentWindow().startDragging();
  };

  return (
    <main className="h-screen w-screen overflow-hidden bg-transparent p-0.5 font-sans select-none">
      <div className="flex h-full w-full items-center gap-2 rounded-[14px] border border-white/20 bg-neutral-800/80 px-2.5 text-white shadow-xl backdrop-blur-xl">
        <span
          onMouseDown={drag}
          className="flex size-7 shrink-0 cursor-grab items-center justify-center rounded-full active:cursor-grabbing"
          style={{ backgroundColor: status.color }}
          title="Drag window"
        >
          <Clock3 className="size-3.5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col justify-center text-left">
          <span className="truncate whitespace-nowrap text-[9px] font-semibold leading-none tracking-[0.02em] text-white/70">
            {formatMiniDateTime(new Date())}
          </span>
          <span className="mt-1 truncate whitespace-nowrap text-[12px] font-bold leading-none tracking-[0.02em] text-white">
            {status.label}
          </span>
        </span>
        <GripVertical className="size-3.5 shrink-0 cursor-grab text-white/45" onMouseDown={drag} />
      </div>
    </main>
  );
}
