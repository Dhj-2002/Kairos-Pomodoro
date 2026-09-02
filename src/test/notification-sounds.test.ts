import { describe, expect, it } from "vitest";
import { SCHEDULE_REMINDER_SOUNDS } from "@/lib/notifications";

describe("schedule reminder sounds", () => {
  it("keeps every selectable reminder between two and 2.5 seconds", () => {
    expect(SCHEDULE_REMINDER_SOUNDS).toHaveLength(3);
    for (const sound of SCHEDULE_REMINDER_SOUNDS) {
      expect(sound.durationSeconds).toBeGreaterThanOrEqual(2);
      expect(sound.durationSeconds).toBeLessThanOrEqual(2.5);
    }
  });
});
