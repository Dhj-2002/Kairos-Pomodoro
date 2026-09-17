import { getSetting, setSetting } from "@/lib/db/settings";

export interface DurationPreset { id: string; name: string; minutes: number }
export const DURATION_PRESETS_KEY = "calendar_duration_presets_v1";

/** Decode ordered duration-only preferences; reject corruption rather than overwrite it. */
export function decodeDurationPresets(raw: string | null): DurationPreset[] {
  // 1. New installations start empty; saved preferences require a known schema.
  if (raw === null) return [];
  const data = JSON.parse(raw);
  if (data.version !== 1 || !Array.isArray(data.items)) throw new Error("Unsupported duration presets.");
  const ids = new Set<string>();
  // 2. Preserve order and forbid duplicate identities or invalid durations.
  return data.items.map((item: DurationPreset) => {
    if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id)
      || typeof item.name !== "string" || !item.name.trim()
      || !Number.isSafeInteger(item.minutes) || item.minutes <= 0) {
      throw new Error("Invalid duration presets. Existing preferences were not changed.");
    }
    ids.add(item.id);
    return { id: item.id, name: item.name.trim(), minutes: item.minutes };
  });
}

export const loadDurationPresets = async () => decodeDurationPresets(await getSetting(DURATION_PRESETS_KEY));
export async function saveDurationPresets(items: DurationPreset[]) {
  const raw = JSON.stringify({ version: 1, items });
  decodeDurationPresets(raw);
  await setSetting(DURATION_PRESETS_KEY, raw);
}
export const formatPresetDuration = (minutes: number) =>
  minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
