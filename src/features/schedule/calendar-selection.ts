import type { TimeBlockWithMeta } from "@/lib/db";
import { parseDbDateTime } from "@/lib/time";

/** Return the inclusive chronological range used by Shift+click. Blocks with
 * the same start time remain deterministic through end time and database id. */
export function chronologicalBlockRange(
  blocks: TimeBlockWithMeta[],
  anchorId: number,
  targetId: number,
): number[] {
  // selection range step 1: Build one stable time order for the visible week.
  const ordered = [...blocks].sort((left, right) =>
    parseDbDateTime(left.start_time).getTime() - parseDbDateTime(right.start_time).getTime()
    || parseDbDateTime(left.end_time).getTime() - parseDbDateTime(right.end_time).getTime()
    || left.id - right.id,
  );

  // selection range step 2: Return the inclusive interval, or only the target
  // when the previous anchor is no longer visible.
  const anchorIndex = ordered.findIndex((block) => block.id === anchorId);
  const targetIndex = ordered.findIndex((block) => block.id === targetId);
  if (targetIndex < 0) return [];
  if (anchorIndex < 0) return [targetId];
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return ordered.slice(start, end + 1).map((block) => block.id);
}

export interface SelectionRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Treat touching edges as an intersection so very short blocks remain easy
 * to include in a Shift-drag marquee. */
export function selectionRectsIntersect(left: SelectionRect, right: SelectionRect): boolean {
  return left.left <= right.right
    && left.right >= right.left
    && left.top <= right.bottom
    && left.bottom >= right.top;
}
