import { useEffect, useState } from "react";
import { Clock3, GripVertical } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalPosition } from "@tauri-apps/api/window";
import { restoreStateCurrent, saveWindowState, StateFlags } from "@tauri-apps/plugin-window-state";
import {
  SCHEDULE_WINDOW_EVENT,
  type ScheduleWindowStatus,
} from "@/features/schedule/use-schedule-runtime";

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

export function ScheduleMiniWindow() {
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
      await mini.setAlwaysOnTop(true);
      if (localStorage.getItem(POSITION_KEY) === "1") {
        await restoreStateCurrent(StateFlags.POSITION).catch(() => {});
      } else {
        await mini.setPosition(new LogicalPosition(
          Math.max(20, screen.availWidth - 440),
          Math.max(20, screen.availHeight - 84),
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
    <main className="h-screen w-screen overflow-hidden bg-transparent p-1 font-sans select-none">
      <div className="flex h-full w-full items-center gap-3 rounded-[20px] border border-white/20 bg-neutral-800/80 px-4 text-white shadow-2xl backdrop-blur-xl">
        <span
          onMouseDown={drag}
          className="flex size-9 shrink-0 cursor-grab items-center justify-center rounded-full active:cursor-grabbing"
          style={{ backgroundColor: status.color }}
          title="Drag window"
        >
          <Clock3 className="size-4" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col justify-center text-left">
          <span className="truncate whitespace-nowrap text-[12px] font-semibold leading-none tracking-[0.03em] text-white/70">
            {formatMiniDateTime(new Date())}
          </span>
          <span className="mt-2 truncate whitespace-nowrap text-sm font-bold leading-none tracking-[0.03em] text-white">
            {status.label}
          </span>
        </span>
        <GripVertical className="size-4 shrink-0 cursor-grab text-white/45" onMouseDown={drag} />
      </div>
    </main>
  );
}
