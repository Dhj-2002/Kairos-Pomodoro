import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db/settings", () => ({ getSetting: vi.fn(), setSetting: vi.fn() }));
import { getSetting, setSetting } from "@/lib/db/settings";
import { decodeDurationPresets, loadDurationPresets, saveDurationPresets, DURATION_PRESETS_KEY } from "@/features/schedule/duration-presets";
import { addLocalMinutes } from "@/components/base/time-block-form";
import { calendarEventStyle } from "@/features/schedule/calendar-appearance";

describe("duration-only preferences", () => {
  const items = [{ id: "sleep", name: "Sleep", minutes: 510 }];
  it("starts empty and preserves ordered identities", () => {
    expect(decodeDurationPresets(null)).toEqual([]);
    expect(decodeDurationPresets(JSON.stringify({ version: 1, items }))).toEqual(items);
  });
  it("round trips through existing settings without touching Quick Blocks", async () => {
    await saveDurationPresets(items);
    expect(setSetting).toHaveBeenCalledWith(DURATION_PRESETS_KEY, JSON.stringify({ version: 1, items }));
    vi.mocked(getSetting).mockResolvedValue(JSON.stringify({ version: 1, items }));
    expect(await loadDurationPresets()).toEqual(items);
  });
  it("refuses malformed, duplicate, negative and future-version preferences", () => {
    for (const data of [{ version: 2, items }, { version: 1, items: [...items, ...items] },
      { version: 1, items: [{ ...items[0], minutes: -1 }] }]) {
      expect(() => decodeDurationPresets(JSON.stringify(data))).toThrow();
    }
    expect(() => decodeDurationPresets("broken")).toThrow();
  });
  it("retains local wall time across midnight, month and year", () => {
    expect(addLocalMinutes("2026-09-17T22:00", 510)).toBe("2026-09-18T06:30");
    expect(addLocalMinutes("2026-12-31T22:00", 510)).toBe("2027-01-01T06:30");
    expect(addLocalMinutes("2026-09-30T22:00", 510)).toBe("2026-10-01T06:30");
  });
});
describe("calendar appearance", () => {
  it("keeps future fills very pale and past fills transparent in both themes", () => {
    const pending = calendarEventStyle("#0088ff", false) as Record<string, string>;
    expect(pending["--event-fill"]).toBe("rgb(232, 244, 255)");
    expect(pending["--event-ink"]).toBe("rgb(0, 65, 122)");
    const past = calendarEventStyle("#0088ff", true) as Record<string, string>;
    expect(past["--event-fill"]).toBe("transparent");
    expect(past["--event-dark-fill"]).toBe("transparent");
  });
});
