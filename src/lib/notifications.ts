import { useSettingsStore } from "@/features/settings/use-settings-store";
import { useNotificationStore } from "@/features/notifications/use-notification-store";
import { isTauri } from "@/lib/tauri";
import type { ScheduleReminderSound } from "@/features/settings/settings-types";

type NotificationType =
  | "session-complete"
  | "break-over"
  | "focus-start"
  | "focus-complete"
  | "schedule-start";

const NOTIFICATION_TITLES: Record<NotificationType, string> = {
  "session-complete": "Focus Session Complete!",
  "break-over": "Break is Over",
  "focus-start": "Time to Focus",
  "focus-complete": "Focus time's up!",
  "schedule-start": "Scheduled Focus Time",
};

function getSettings() {
  return useSettingsStore.getState().settings;
}

let audioCtx: AudioContext | null = null;

export const SCHEDULE_REMINDER_SOUNDS: ReadonlyArray<{
  value: ScheduleReminderSound;
  label: string;
  description: string;
  durationSeconds: number;
}> = [
  {
    value: "attention",
    label: "Attention Bell",
    description: "Bright repeated bell, easiest to notice",
    durationSeconds: 2.3,
  },
  {
    value: "digital",
    label: "Digital Alert",
    description: "Rhythmic electronic pulses",
    durationSeconds: 2.3,
  },
  {
    value: "gentle",
    label: "Gentle Chime",
    description: "Softer layered chime",
    durationSeconds: 2.5,
  },
] as const;

async function getAudioContext(): Promise<AudioContext> {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") await audioCtx.resume();
  return audioCtx;
}

function scheduleTone(
  ctx: AudioContext,
  start: number,
  frequency: number,
  duration: number,
  volume: number,
  type: OscillatorType = "sine",
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

function reminderVolume(base: number, volumePercent: number): number {
  const normalized = Math.min(100, Math.max(0, volumePercent)) / 50;
  return Math.min(0.75, base * normalized);
}

export async function playChime(): Promise<void> {
  try {
    const ctx = await getAudioContext();
    const now = ctx.currentTime;

    const frequencies = [523.25, 659.25, 783.99];
    const durations = [0.15, 0.15, 0.3];

    frequencies.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + durations[i]);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + durations.slice(0, i).reduce((a, b) => a + b, 0));
      osc.stop(now + durations.slice(0, i + 1).reduce((a, b) => a + b, 0));
    });
  } catch (e) {
    console.error("[Notification] Audio chime failed:", e);
  }
}

/** Play a prominent, long-form calendar reminder without starting a timer.
 * Step 1 selects a named sound profile, then step 2 schedules a pattern whose
 * audible span is 2–2.5 seconds. The user-facing volume treats 50% as the
 * normal reference level and scales the generated tones around it. */
export async function playScheduleReminder(
  sound: ScheduleReminderSound,
  volumePercent = 50,
): Promise<void> {
  try {
    const ctx = await getAudioContext();
    const now = ctx.currentTime + 0.03;

    // schedule reminder step 1: Use a repeated high-contrast motif for the
    // default alert so a block transition is difficult to miss.
    if (sound === "attention") {
      [0, 0.75, 1.5].forEach((offset) => {
        scheduleTone(
          ctx,
          now + offset,
          659.25,
          0.34,
          reminderVolume(0.45, volumePercent),
          "triangle",
        );
        scheduleTone(
          ctx,
          now + offset + 0.18,
          880,
          0.62,
          reminderVolume(0.38, volumePercent),
          "sine",
        );
      });
      return;
    }

    // schedule reminder step 2: Keep every alternate profile longer than
    // two seconds while giving it a clearly different rhythm.
    if (sound === "digital") {
      [0, 0.38, 0.76, 1.24, 1.62, 2].forEach((offset, index) => {
        scheduleTone(
          ctx,
          now + offset,
          index % 2 === 0 ? 740 : 988,
          0.32,
          reminderVolume(0.28, volumePercent),
          "square",
        );
      });
      return;
    }

    [0, 0.85, 1.7].forEach((offset) => {
      scheduleTone(
        ctx,
        now + offset,
        523.25,
        0.78,
        reminderVolume(0.24, volumePercent),
        "sine",
      );
      scheduleTone(
        ctx,
        now + offset + 0.1,
        783.99,
        0.7,
        reminderVolume(0.18, volumePercent),
        "sine",
      );
    });
  } catch (e) {
    console.error("[Notification] Schedule reminder failed:", e);
  }
}

export async function sendNotification(
  type: NotificationType,
  body?: string,
): Promise<void> {
  const settings = getSettings();

  if (isTauri()) {
    try {
      const { sendNotification, isPermissionGranted, requestPermission } =
        await import("@tauri-apps/plugin-notification");

      let granted = await isPermissionGranted();
      if (!granted) {
        const permission = await requestPermission();
        granted = permission === "granted";

        useNotificationStore.getState().reset();
        useNotificationStore
          .getState()
          .checkPermission()
          .catch(() => {});
      }

      if (granted) {
        await sendNotification({
          title: NOTIFICATION_TITLES[type],
          body: body || "",
        });
      } else {
        console.warn(
          "[Notification] Permission denied, notification not sent.",
        );
      }
    } catch (e) {
      console.error("[Notification] Failed to send:", e);
    }
  }

  if (settings.soundEnabled) {
    if (type === "schedule-start") {
      await playScheduleReminder(
        settings.scheduleReminderSound,
        settings.scheduleReminderVolume,
      );
    } else {
      await playChime();
    }
  }
}
