export const CALENDAR_VIEW_STORAGE_KEY = "kairos-calendar-view";

export type CalendarViewPreference =
  | { mode: "today" }
  | { mode: "custom"; centerDate: string };

/** Return a copy pinned to local midnight so calendar days never drift by DST. */
export function startOfLocalDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function toLocalISODate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function fromLocalISODate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (toLocalISODate(date) !== value) return null;
  return date;
}

export function addCalendarDays(date: Date, days: number): Date {
  const result = startOfLocalDay(date);
  result.setDate(result.getDate() + days);
  return result;
}

/** Build the visible previous-three, center, next-three calendar window. */
export function buildCenteredSevenDays(centerDate: Date): Date[] {
  return Array.from({ length: 7 }, (_, index) => addCalendarDays(centerDate, index - 3));
}

export function parseCalendarViewPreference(raw: string | null): CalendarViewPreference {
  if (!raw) return { mode: "today" };
  try {
    const value = JSON.parse(raw) as Partial<CalendarViewPreference>;
    if (value.mode === "custom" && typeof value.centerDate === "string" && fromLocalISODate(value.centerDate)) {
      return { mode: "custom", centerDate: value.centerDate };
    }
  } catch {
    // Invalid local state should never prevent Calendar from opening.
  }
  return { mode: "today" };
}

export function resolveCalendarCenter(preference: CalendarViewPreference, now = new Date()): Date {
  if (preference.mode === "custom") {
    return fromLocalISODate(preference.centerDate) ?? startOfLocalDay(now);
  }
  return startOfLocalDay(now);
}

/** A manual arrow move leaves dynamic Today mode and persists an exact center. */
export function shiftCalendarView(
  preference: CalendarViewPreference,
  days: number,
  now = new Date(),
): CalendarViewPreference {
  const centerDate = addCalendarDays(resolveCalendarCenter(preference, now), days);
  return { mode: "custom", centerDate: toLocalISODate(centerDate) };
}
