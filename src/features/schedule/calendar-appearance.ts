import type { CSSProperties } from "react";
import { calendarTagColor } from "@/lib/category-colors";

/** Display-only colors; preserve tags and support WebKit without color-mix. */
export function calendarEventStyle(color: string, elapsed: boolean): CSSProperties {
  // 1. Normalize persisted tag colors without rewriting them.
  color = calendarTagColor(color);
  const hex = /^#[\da-f]{6}$/i.test(color) ? color.slice(1) : "808080";
  const rgb = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
  const mix = (target: number, amount: number) => `rgb(${rgb.map((v) => Math.round(v * amount + target * (1 - amount))).join(", ")})`;
  // 2. Separate pale surfaces from readable category-colored text.
  const tones: Record<string, [string, string]> = {
    "#55b7fa": ["#EFF8FE", "#176797"], "#65c65a": ["#F1F8ED", "#466F36"],
    "#ff69ac": ["#FDF0F6", "#AA3169"], "#ffcc49": ["#FFF9EC", "#996211"],
    "#aa8ae8": ["#F7F2FC", "#7856A0"], "#ff9560": ["#FFF5ED", "#995A24"],
    "#9aa1ae": ["#F4F5F7", "#596272"],
  };
  const tone = tones[color.toLowerCase()];
  return {
    "--event-accent": `rgb(${rgb.join(", ")})`,
    "--event-fill": elapsed ? "transparent" : tone?.[0] ?? mix(255, 0.09),
    "--event-ink": tone?.[1] ?? mix(0, 0.48),
    "--event-dark-fill": elapsed ? "transparent" : mix(28, 0.18),
    "--event-dark-ink": mix(255, 0.40),
  } as CSSProperties;
}
