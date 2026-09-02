import { UNTAGGED_BLOCK_COLOR } from "@/lib/constants";

interface ScheduleBlockTagColor {
  category_id: number | null;
  category_color?: string | null;
}

/** Tags are the single source of block color. Legacy per-block RGB values are
 * deliberately ignored; missing/deleted tags always resolve to neutral gray. */
export function resolveScheduleBlockColor(block: ScheduleBlockTagColor | null | undefined): string {
  return block?.category_id != null && block.category_color
    ? block.category_color
    : UNTAGGED_BLOCK_COLOR;
}
