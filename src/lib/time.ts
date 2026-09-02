import type { TimerPhase } from "@/features/timer/timer-types";

/**
 * Parse a local SQLite datetime without relying on WebKit's implementation-
 * dependent Date string parser. Chromium accepts `YYYY-MM-DD HH:mm:ss`, while
 * older Safari returns Invalid Date for the same value.
 */
export function parseDbDateTime(value: string): Date {
  const local = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (local) {
    const [, year, month, day, hour, minute, second = "0", fraction = "0"] = local;
    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      Number(fraction.padEnd(3, "0")),
    );
  }

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }

  return new Date(value);
}

/** Format a persisted calendar timestamp without relying on Safari/WebKit's
 * unsupported parsing of SQLite's `YYYY-MM-DD HH:mm:ss` representation. */
export function formatTime24Hour(value: string): string {
  const date = parseDbDateTime(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function formatSeconds(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

const PHASE_CONFIG = {
  work:        { color: "text-sahara-primary",       bg: "bg-sahara-primary", label: "Focus" },
  short_break: { color: "text-sahara-text-secondary", bg: "bg-sahara-card",   label: "Short Break" },
  long_break:  { color: "text-sahara-text-muted",     bg: "bg-sahara-card",   label: "Long Break" },
} as const;

export function getPhaseColor(phase: TimerPhase): string {
  return PHASE_CONFIG[phase].color;
}

export function getPhaseBg(phase: TimerPhase): string {
  return PHASE_CONFIG[phase].bg;
}

export function getPhaseLabel(phase: TimerPhase): string {
  return PHASE_CONFIG[phase].label;
}

export function formatTimeAmPm(date: Date): string {
  let h = date.getHours();
  const m = date.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m.toString().padStart(2, "0")}${ampm}`;
}
