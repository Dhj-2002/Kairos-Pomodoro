import { describe, it, expect } from "vitest";
import { formatTime, formatDuration, formatTotalTime, formatMinutesAsDuration } from "@/lib/session-utils";

describe("formatDuration", () => {
  it("rounds sub-minute durations into the shared hours/minutes form", () => {
    expect(formatDuration(45)).toBe("0 hours 1 minute");
  });

  it("formats exact minutes", () => {
    expect(formatDuration(120)).toBe("0 hours 2 minutes");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(90)).toBe("0 hours 2 minutes");
  });

  it("formats zero", () => {
    expect(formatDuration(0)).toBe("0 hours 0 minutes");
  });

  it("formats large values", () => {
    expect(formatDuration(3661)).toBe("1 hour 1 minute");
  });
});

describe("formatTotalTime", () => {
  it("formats minutes only", () => {
    expect(formatTotalTime(1500)).toBe("0 hours 25 minutes");
  });

  it("formats hours and minutes", () => {
    expect(formatTotalTime(3661)).toBe("1 hour 1 minute");
  });

  it("formats exact hours", () => {
    expect(formatTotalTime(7200)).toBe("2 hours 0 minutes");
  });

  it("formats zero", () => {
    expect(formatTotalTime(0)).toBe("0 hours 0 minutes");
  });

  it("formats under an hour", () => {
    expect(formatTotalTime(1800)).toBe("0 hours 30 minutes");
  });
});

describe("formatTime", () => {
  it("formats a date string", () => {
    const result = formatTime("2026-01-15T14:30:00");
    expect(result).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/i);
  });
});

describe("formatMinutesAsDuration", () => {
  it("keeps both hour and minute units for short templates", () => {
    expect(formatMinutesAsDuration(30)).toBe("0 hours 30 minutes");
  });

  it("formats exact hours with explicit zero minutes", () => {
    expect(formatMinutesAsDuration(840)).toBe("14 hours 0 minutes");
    expect(formatMinutesAsDuration(1440)).toBe("24 hours 0 minutes");
  });

  it("formats mixed hours and minutes", () => {
    expect(formatMinutesAsDuration(975)).toBe("16 hours 15 minutes");
  });
});
