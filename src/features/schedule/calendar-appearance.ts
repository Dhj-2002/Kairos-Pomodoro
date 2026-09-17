import type { CSSProperties } from "react";

/** Display-only colors; preserve tags and support WebKit without color-mix. */
export function calendarEventStyle(color: string, elapsed: boolean): CSSProperties {
  // 1. Normalize persisted tag colors without rewriting them.
  const hex = /^#[\da-f]{6}$/i.test(color) ? color.slice(1) : "808080";
  const rgb = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
  const mix = (target: number, amount: number) => `rgb(${rgb.map((v) => Math.round(v * amount + target * (1 - amount))).join(", ")})`;
  // 2. Separate pale surfaces from readable category-colored text.
  return {
    "--event-accent": `rgb(${rgb.join(", ")})`,
    "--event-fill": elapsed ? "transparent" : mix(255, 0.09),
    "--event-ink": mix(0, 0.48),
    "--event-dark-fill": elapsed ? "transparent" : mix(28, 0.18),
    "--event-dark-ink": mix(255, 0.40),
  } as CSSProperties;
}
