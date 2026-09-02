import { parseDbDateTime } from "@/lib/time";
export type { Session } from "@/lib/db";

export function formatTime(dateStr: string): string {
  const date = parseDbDateTime(dateStr);
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

export function formatDuration(seconds: number): string {
  return formatMinutesAsDuration(Math.max(0, Math.round(seconds / 60)));
}

export function formatTotalTime(seconds: number): string {
  return formatMinutesAsDuration(Math.max(0, Math.round(seconds / 60)));
}

/** Format long minute-based schedules without forcing users to convert hours. */
export function formatMinutesAsDuration(totalMinutes: number): string {
  const safeMinutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${hours} ${hours === 1 ? "hour" : "hours"} ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}
