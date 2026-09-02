export type ThemeMode = "light" | "dark" | "system";

/** Long-form sounds used only when a scheduled calendar block begins. */
export type ScheduleReminderSound = "attention" | "digital" | "gentle";

/** Named color palette presets. Sahara is the default. */
export type ThemePreset = "sahara" | "forest" | "ocean" | "mono";

export interface Settings {
  workDuration: number;
  shortBreakDuration: number;
  longBreakDuration: number;
  pomosBeforeLongBreak: number;
  autoStartBreaks: boolean;
  hotkey: string;
  soundEnabled: boolean;
  scheduleReminderSound: ScheduleReminderSound;
  scheduleReminderVolume: number;
  theme: ThemeMode;
  themePreset: ThemePreset;
  timerStyle: "solid" | "zigzag";
  /** Optional HTTP/SOCKS proxy used only by the native updater. */
  updateProxy: string;
}
