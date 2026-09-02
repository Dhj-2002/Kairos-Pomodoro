export const CALENDAR_RESIZE_STEP_MINUTES = 15;
export const CALENDAR_RESIZE_STEP_MS = CALENDAR_RESIZE_STEP_MINUTES * 60_000;
export type CalendarResizeEdge = "start" | "end";

/** Snap a proposed calendar start to quarter-hours and preserve one cell. */
export function snapCalendarResizeStart(end: Date, proposedStart: Date): Date {
  const snappedMs = Math.round(proposedStart.getTime() / CALENDAR_RESIZE_STEP_MS)
    * CALENDAR_RESIZE_STEP_MS;
  return new Date(Math.min(snappedMs, end.getTime() - CALENDAR_RESIZE_STEP_MS));
}

/** Snap a proposed calendar end to quarter-hours and enforce one-cell minimum. */
export function snapCalendarResizeEnd(start: Date, proposedEnd: Date): Date {
  // resize time step 1: Snap the moving edge to the nearest 15-minute boundary.
  const snappedMs = Math.round(proposedEnd.getTime() / CALENDAR_RESIZE_STEP_MS)
    * CALENDAR_RESIZE_STEP_MS;

  // resize time step 2: A block always occupies at least one calendar cell.
  return new Date(Math.max(snappedMs, start.getTime() + CALENDAR_RESIZE_STEP_MS));
}
