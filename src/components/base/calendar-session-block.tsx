import type { WeekSession } from "@/lib/db";
import { parseDbDateTime } from "@/lib/time";
import { calendarEventStyle } from "@/features/schedule/calendar-appearance";
import { UNTAGGED_BLOCK_COLOR } from "@/lib/constants";

interface CalendarSessionBlockProps { session: WeekSession; topPx: number; heightPx: number }

/** Actual sessions share planned-block typography; all metadata stays in the native record. */
export function CalendarSessionBlock({ session, topPx, heightPx }: CalendarSessionBlockProps) {
  // 1. Derive the actual end without changing the stored duration or accounting.
  const start = parseDbDateTime(session.started_at);
  const end = new Date(start.getTime() + session.duration_sec * 1000);
  const time = (d:Date) => String(d.getHours()).padStart(2,"0") + ":" + String(d.getMinutes()).padStart(2,"0");
  const label = session.task_name || session.intention || (session.phase === "work" ? "Work" : "Break");
  // 2. One visual vocabulary for actual and scheduled time.
  return <div className="calendar-event calendar-session absolute left-1 right-1 rounded-[2px] px-2 py-1 z-10 overflow-hidden"
    title={[label, session.category_name, session.intention, session.notes].filter(Boolean).join(" · ")}
    style={{top:topPx,height:heightPx,...calendarEventStyle(session.category_color || UNTAGGED_BLOCK_COLOR,end.getTime() <= Date.now())}}>
    <p className="calendar-event-title truncate">{label}</p>
    {heightPx >= 40 && <p className="calendar-event-time">{time(start)} – {time(end)}</p>}
  </div>;
}
