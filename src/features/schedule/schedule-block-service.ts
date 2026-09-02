import {
  addLoggedSession,
  addScheduleTemplate,
  addTemplateBlock,
  addTimeBlock,
  deleteSession,
  deleteTimeBlock,
  getDayTimeBlocks,
  getSequenceTemplateItems,
  getTemplateBlocks,
  isTemplateAppliedOnDate,
  timeBlockToTemplateInput,
  updateLoggedSession,
  updateTimeBlock,
  validateRange,
  withSerializedWrite,
  type TimeBlockInput,
  type TimeBlockWithMeta,
  type SequenceTemplateItem,
} from "@/lib/db";
import type Database from "@tauri-apps/plugin-sql";
import { UNTAGGED_BLOCK_COLOR } from "@/lib/constants";
import {
  snapCalendarResizeEnd,
  snapCalendarResizeStart,
  type CalendarResizeEdge,
} from "@/features/schedule/calendar-resize";
import { parseDbDateTime } from "@/lib/time";

export type TemplateConflictMode = "keep" | "replace" | "append";

export interface ApplyTemplateResult {
  created: number;
  skipped: number;
  replaced: number;
}

export interface CountedTimeBlockResult {
  blockId: number;
  sessionId: number;
}

export interface ApplySequenceTemplateResult {
  created: number;
  sessionIds: number[];
}

async function updateCountedTimeBlockRow(
  database: Database,
  block: TimeBlockWithMeta,
  input: TimeBlockInput,
): Promise<number> {
  let sessionId = block.session_id;
  if (!sessionId) sessionId = await addLoggedSession(sessionPayload(input), database);
  try {
    await updateTimeBlock(block.id, { ...input, session_id: sessionId }, database);
    await updateLoggedSession(sessionId, sessionPayload(input), database);
    return sessionId;
  } catch (error) {
    if (!block.session_id) await deleteSession(sessionId, database).catch(() => {});
    throw error;
  }
}

function sessionPayload(input: TimeBlockInput) {
  const start = parseDbDateTime(input.start_time);
  const end = parseDbDateTime(input.end_time);
  return {
    taskId: input.task_id ?? null,
    phase: "work",
    startedAt: input.start_time,
    endedAt: input.end_time,
    durationSec: Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000)),
    categoryId: input.category_id ?? null,
    intention: input.title,
  };
}

/** Create the calendar row and its one counted session as one serialized unit. */
export async function createCountedTimeBlock(input: TimeBlockInput): Promise<CountedTimeBlockResult> {
  validateRange(input.start_time, input.end_time);
  return withSerializedWrite(async () => {
    const sessionId = await addLoggedSession(sessionPayload(input));
    try {
      const blockId = await addTimeBlock({ ...input, session_id: sessionId });
      return { blockId, sessionId };
    } catch (error) {
      await deleteSession(sessionId).catch((cleanupError) => {
        console.error("[Schedule] Failed to remove orphaned session:", cleanupError);
      });
      throw error;
    }
  });
}

/** Keep edits synchronized with the single session used by analytics. */
export async function updateCountedTimeBlock(
  block: TimeBlockWithMeta,
  input: TimeBlockInput,
): Promise<number> {
  validateRange(input.start_time, input.end_time);
  return withSerializedWrite((database) => updateCountedTimeBlockRow(database, block, input));
}

function toLocalDateTime(value: Date): string {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

/** Convert an ordered lightweight template into consecutive calendar inputs.
 * The first item begins at the clicked 15-minute slot; every later item starts
 * exactly where the previous item ends, including across midnight. */
export function buildSequenceTimeBlockInputs(
  items: SequenceTemplateItem[],
  startDate: Date,
): TimeBlockInput[] {
  // sequence insertion step 1: Advance one cursor through the saved order.
  let cursor = new Date(startDate);
  return items.map((item) => {
    const start = new Date(cursor);
    const end = new Date(start.getTime() + item.duration_minutes * 60_000);
    cursor = end;

    // sequence insertion step 2: The optional tag owns color and analytics;
    // untagged legacy items receive one neutral gray instead of old RGB data.
    return {
      title: item.title,
      start_time: toLocalDateTime(start),
      end_time: toLocalDateTime(end),
      category_id: item.category_id,
      color: item.category_id ? null : UNTAGGED_BLOCK_COLOR,
      notification_enabled: item.notification_enabled,
    };
  });
}

/** Insert one saved sequence at a clicked calendar slot through the canonical
 * counted-block path. No timer starts and no existing block is overwritten. */
export async function applySequenceTemplateAt(
  templateId: number,
  startDate: Date,
): Promise<ApplySequenceTemplateResult> {
  // sequence insertion step 1: Read the latest stable template snapshots.
  const items = await getSequenceTemplateItems(templateId);
  if (items.length === 0) throw new Error("This template has no blocks");

  // sequence insertion step 2: Create consecutive independent calendar rows.
  const result: ApplySequenceTemplateResult = { created: 0, sessionIds: [] };
  for (const input of buildSequenceTimeBlockInputs(items, startDate)) {
    const created = await createCountedTimeBlock(input);
    result.created++;
    result.sessionIds.push(created.sessionId);
  }
  return result;
}

/** Move one counted block to a new start while preserving its duration and metadata. */
export function buildMovedTimeBlockInput(
  block: TimeBlockWithMeta,
  newStart: Date,
): TimeBlockInput {
  // move block step 1: Preserve the exact stored duration across day/time moves.
  const durationMs = parseDbDateTime(block.end_time).getTime() - parseDbDateTime(block.start_time).getTime();
  const newEnd = new Date(newStart.getTime() + durationMs);

  // move block step 2: Reuse the canonical update payload so its linked
  // session, tag, template provenance, and reminder policy remain intact.
  return {
    title: block.title,
    start_time: toLocalDateTime(newStart),
    end_time: toLocalDateTime(newEnd),
    task_id: block.task_id,
    category_id: block.category_id,
    color: block.color,
    source_template_id: block.source_template_id,
    source_template_block_id: block.source_template_block_id,
    notification_enabled: block.notification_enabled,
  };
}

/** Persist a calendar drag through the same counted-block update path as edits. */
export async function moveCountedTimeBlock(
  block: TimeBlockWithMeta,
  newStart: Date,
): Promise<number> {
  // move block step 1: Build the duration-preserving canonical edit.
  const input = buildMovedTimeBlockInput(block, newStart);

  // move block step 2: Synchronize the block and its one analytics session.
  return updateCountedTimeBlock(block, input);
}

/** Resize one counted block from either edge while preserving its metadata. */
export function buildResizedTimeBlockInput(
  block: TimeBlockWithMeta,
  edge: CalendarResizeEdge,
  proposedBoundary: Date,
): TimeBlockInput {
  const start = parseDbDateTime(block.start_time);
  const end = parseDbDateTime(block.end_time);
  const newStart = edge === "start" ? snapCalendarResizeStart(end, proposedBoundary) : start;
  const newEnd = edge === "end" ? snapCalendarResizeEnd(start, proposedBoundary) : end;

  // resize block step 2: Reuse the canonical edit payload so analytics and
  // reminder/template provenance stay synchronized with the visual block.
  return {
    title: block.title,
    start_time: toLocalDateTime(newStart),
    end_time: toLocalDateTime(newEnd),
    task_id: block.task_id,
    category_id: block.category_id,
    color: block.color,
    source_template_id: block.source_template_id,
    source_template_block_id: block.source_template_block_id,
    notification_enabled: block.notification_enabled,
  };
}

/** Persist an edge resize through the canonical counted-block update. */
export async function resizeCountedTimeBlock(
  block: TimeBlockWithMeta,
  edge: CalendarResizeEdge,
  proposedBoundary: Date,
): Promise<number> {
  const input = buildResizedTimeBlockInput(block, edge, proposedBoundary);

  // resize block step 2: Synchronize both the calendar row and analytics row.
  return updateCountedTimeBlock(block, input);
}

/** Build one duration-preserving input per block after applying a shared time
 * delta. This pure conversion is shared by group preview verification/tests. */
export function buildShiftedTimeBlockInputs(
  blocks: TimeBlockWithMeta[],
  deltaMs: number,
): Array<{ block: TimeBlockWithMeta; input: TimeBlockInput }> {
  return blocks.map((block) => ({
    block,
    input: buildMovedTimeBlockInput(
      block,
      new Date(parseDbDateTime(block.start_time).getTime() + deltaMs),
    ),
  }));
}

/** Move one visible selection by a shared time delta while preserving every
 * block's duration, metadata, relative spacing, and linked analytics session. */
export async function moveCountedTimeBlocks(
  blocks: TimeBlockWithMeta[],
  deltaMs: number,
): Promise<number[]> {
  // group move step 1: Build every target before writing so malformed ranges
  // cannot leave a partially prepared selection.
  const moves = buildShiftedTimeBlockInputs(blocks, deltaMs);

  // group move step 2: Serialize the complete group against other calendar
  // writes and keep each block's linked statistics row synchronized.
  return withSerializedWrite(async (database) => {
    const sessionIds: number[] = [];
    for (const move of moves) {
      sessionIds.push(await updateCountedTimeBlockRow(database, move.block, move.input));
    }
    return sessionIds;
  });
}

export async function deleteCountedTimeBlock(block: TimeBlockWithMeta): Promise<void> {
  await withSerializedWrite(async (database) => {
    await deleteTimeBlock(block.id, database);
    if (block.session_id) await deleteSession(block.session_id, database);
  });
}

/** Delete a selected calendar group and all of its counted-session rows in one
 * serialized batch. No unselected block or timer session is touched. */
export async function deleteCountedTimeBlocks(blocks: TimeBlockWithMeta[]): Promise<void> {
  // group delete step 1: Deduplicate ids so one visual overlap cannot trigger
  // repeated deletion of the same calendar/session pair.
  const unique = [...new Map(blocks.map((block) => [block.id, block])).values()];

  // group delete step 2: Remove each block before its optional linked session,
  // matching the established single-block deletion order.
  await withSerializedWrite(async (database) => {
    for (const block of unique) {
      await deleteTimeBlock(block.id, database);
      if (block.session_id) await deleteSession(block.session_id, database);
    }
  });
}

export function templateMinuteToDateTime(date: string, minuteOfDay: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(year, month - 1, day, 0, minuteOfDay, 0, 0);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:00`;
}

export function timeRangesOverlap(a: { start_time: string; end_time: string }, b: { start_time: string; end_time: string }) {
  return parseDbDateTime(a.start_time).getTime() < parseDbDateTime(b.end_time).getTime()
    && parseDbDateTime(a.end_time).getTime() > parseDbDateTime(b.start_time).getTime();
}

/** Apply a template as independent day rows; subsequent template edits cannot
 * mutate the generated blocks. Duplicate application is rejected explicitly. */
export async function applyScheduleTemplate(
  templateId: number,
  date: string,
  mode: TemplateConflictMode,
): Promise<ApplyTemplateResult> {
  if (await isTemplateAppliedOnDate(templateId, date)) {
    throw new Error("This template has already been applied to the selected day");
  }
  const [templateBlocks, existing] = await Promise.all([
    getTemplateBlocks(templateId),
    getDayTimeBlocks(date),
  ]);
  const result: ApplyTemplateResult = { created: 0, skipped: 0, replaced: 0 };

  for (const templateBlock of templateBlocks) {
    const start = templateMinuteToDateTime(date, templateBlock.start_minute);
    const end = templateMinuteToDateTime(
      date,
      templateBlock.start_minute + templateBlock.duration_minutes,
    );
    const candidate: TimeBlockInput = {
      title: templateBlock.title,
      start_time: start,
      end_time: end,
      category_id: templateBlock.category_id,
      color: templateBlock.category_color ?? null,
      source_template_id: templateId,
      source_template_block_id: templateBlock.id,
      notification_enabled: templateBlock.notification_enabled,
    };
    const conflicts = existing.filter((block) => timeRangesOverlap(candidate, block));
    if (conflicts.length > 0 && mode === "keep") {
      result.skipped++;
      continue;
    }
    if (conflicts.length > 0 && mode === "replace") {
      for (const conflict of conflicts) {
        await deleteCountedTimeBlock(conflict);
        const index = existing.findIndex((block) => block.id === conflict.id);
        if (index >= 0) existing.splice(index, 1);
        result.replaced++;
      }
    }
    const created = await createCountedTimeBlock(candidate);
    existing.push({
      id: created.blockId,
      ...candidate,
      task_id: null,
      category_id: candidate.category_id ?? null,
      color: candidate.color ?? null,
      completed: 0,
      created_at: start,
      session_id: created.sessionId,
      source_template_id: templateId,
      source_template_block_id: templateBlock.id,
      notification_enabled: Number(Boolean(candidate.notification_enabled)),
      reminded_at: null,
      task_name: null,
      category_name: templateBlock.category_name ?? null,
      category_color: templateBlock.category_color ?? null,
    });
    result.created++;
  }
  return result;
}

/** Capture an existing day as a new template without linking future instances
 * back to those source rows. */
export async function saveDayAsTemplate(
  date: string,
  name: string,
  color: string,
  description?: string,
): Promise<number> {
  const blocks = await getDayTimeBlocks(date);
  if (blocks.length === 0) throw new Error("The selected day has no schedule blocks");
  const templateId = await addScheduleTemplate({ name, color, description });
  try {
    for (let index = 0; index < blocks.length; index++) {
      await addTemplateBlock(templateId, timeBlockToTemplateInput(blocks[index], index));
    }
    return templateId;
  } catch (error) {
    const { deleteScheduleTemplate } = await import("@/lib/db");
    await deleteScheduleTemplate(templateId).catch(() => {});
    throw error;
  }
}
