import { create } from "zustand";

export interface CalendarToolbarControls {
  rangeStartMs: number;
  rangeEndMs: number;
  openTemplates: () => void;
  showPreviousDay: () => void;
  showNextDay: () => void;
  showToday: () => void;
}

interface CalendarToolbarStore extends CalendarToolbarControls {
  active: boolean;
  register: (controls: CalendarToolbarControls) => void;
  clear: () => void;
}

const EMPTY_CONTROLS: CalendarToolbarControls = {
  rangeStartMs: 0,
  rangeEndMs: 0,
  openTemplates: () => undefined,
  showPreviousDay: () => undefined,
  showNextDay: () => undefined,
  showToday: () => undefined,
};

/** Bridge route-local calendar controls into the persistent app sidebar. */
export const useCalendarToolbarStore = create<CalendarToolbarStore>((set) => ({
  ...EMPTY_CONTROLS,
  active: false,
  register: (controls) => set({ ...controls, active: true }),
  clear: () => set({ ...EMPTY_CONTROLS, active: false }),
}));
