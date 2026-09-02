import { useMemo, useState, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/cn";
import { resolveScheduleBlockColor } from "@/features/schedule/schedule-block-color";
import type { WeekSession, TimeBlockWithMeta } from "@/lib/db";
import { CalendarSessionBlock } from "./calendar-session-block";
import { CalendarTimeBlock } from "./calendar-time-block";
import { CalendarDayPill } from "./calendar-day-pill";
import { selectionRectsIntersect } from "@/features/schedule/calendar-selection";
import { snapCalendarResizeEnd } from "@/features/schedule/calendar-resize";
import { parseDbDateTime } from "@/lib/time";

export type CalendarSelectionMode = "range" | "toggle";

interface CalendarGridProps {
  sessions: WeekSession[];
  timeBlocks: TimeBlockWithMeta[];
  weekDays: Date[];
  startHour: number;
  endHour: number;
  /** Called with the snapped start and viewport anchor selected from an empty slot. */
  onCreateBlock?: (startDate: Date, anchor: CalendarSlotAnchor) => void;
  /** Called when the user clicks edit on a block. */
  onEditBlock?: (block: TimeBlockWithMeta) => void;
  /** Called when the user clicks a block to view its details. */
  onViewBlock?: (block: TimeBlockWithMeta) => void;
  /** Called when the user clicks delete on a block. */
  onDeleteBlock?: (block: TimeBlockWithMeta) => void;
  /** Called after a desktop drag selects a new 15-minute-snapped start. */
  onMoveBlock?: (block: TimeBlockWithMeta, newStart: Date) => void | Promise<void>;
  /** Called after the bottom edge selects a 15-minute-snapped end. */
  onResizeBlock?: (block: TimeBlockWithMeta, newEnd: Date) => void | Promise<void>;
  /** Current desktop multi-selection, owned by the Calendar container. */
  selectedBlockIds?: ReadonlySet<number>;
  /** Called by Shift+click or Ctrl+click on an existing block. */
  onSelectBlock?: (block: TimeBlockWithMeta, mode: CalendarSelectionMode) => void;
  /** Called after a Shift-drag marquee replaces the current selection. */
  onSelectBlocks?: (blockIds: number[]) => void;
  /** Called when an already-selected group is dragged by a shared delta. */
  onMoveBlocks?: (blocks: TimeBlockWithMeta[], deltaMs: number) => void | Promise<void>;
}

export interface CalendarSlotAnchor {
  x: number;
  y: number;
}

const DAY_LABELS_FULL = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

const BASE_HOUR_HEIGHT = 64;
/** One 15-minute grid cell; planned blocks never claim more time than stored. */
export const MIN_BLOCK_HEIGHT = BASE_HOUR_HEIGHT / 4;
export const BLOCK_DRAG_THRESHOLD = 6;

/** Distinguish an intentional drag from a normal click on an existing block. */
export function exceedsBlockDragThreshold(
  originX: number,
  originY: number,
  currentX: number,
  currentY: number,
  threshold = BLOCK_DRAG_THRESHOLD,
): boolean {
  return Math.hypot(currentX - originX, currentY - originY) >= threshold;
}

function isToday(date: Date): boolean {
  const today = new Date();
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  );
}

function toDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface SnappedCalendarSlot {
  startDate: Date;
  topPx: number;
  quarterIndex: number;
}

/** Resolve a pointer position to one canonical 15-minute calendar slot. */
export function resolveSnappedSlot(
  date: Date,
  y: number,
  layout: DayLayout,
  hours: number[],
): SnappedCalendarSlot {
  // calendar slot step 1: Find the uniform hour row under the pointer.
  for (let i = 0; i < hours.length; i++) {
    if (y >= layout.hourTopPx[i] && y < layout.hourTopPx[i + 1]) {
      const rowHeight = layout.hourTopPx[i + 1] - layout.hourTopPx[i];
      const rowProgress = rowHeight > 0 ? (y - layout.hourTopPx[i]) / rowHeight : 0;
      const quarterIndex = Math.min(3, Math.floor(rowProgress * 4));
      const start = new Date(date);
      start.setHours(hours[i], quarterIndex * 15, 0, 0);

      // calendar slot step 2: Return the same snapped time and line position
      // so hover feedback and click creation cannot drift apart.
      return {
        startDate: start,
        topPx: layout.hourTopPx[i] + (rowHeight * quarterIndex) / 4,
        quarterIndex,
      };
    }
  }

  // calendar slot step 3: Clamp positions below the grid to its final slot.
  const lastIndex = Math.max(hours.length - 1, 0);
  const rowHeight = layout.hourTopPx[lastIndex + 1] - layout.hourTopPx[lastIndex];
  const start = new Date(date);
  start.setHours(hours[hours.length - 1] ?? 0, 45, 0, 0);
  return {
    startDate: start,
    topPx: layout.hourTopPx[lastIndex] + (rowHeight * 3) / 4,
    quarterIndex: 3,
  };
}

/** Resolve an empty-grid click to the containing 15-minute start time. */
export function resolveSnappedStart(
  date: Date,
  y: number,
  layout: DayLayout,
  hours: number[],
): Date {
  return resolveSnappedSlot(date, y, layout, hours).startDate;
}

function QuarterHourGuides() {
  return (
    <span className="pointer-events-none absolute inset-0" aria-hidden="true">
      {[25, 50, 75].map((top) => (
        <span
          key={top}
          className="absolute left-0 right-0 border-t border-dashed border-sahara-border/15"
          style={{ top: `${top}%` }}
        />
      ))}
    </span>
  );
}

function buildSessionsByDay(
  sessions: WeekSession[],
  /** Session ids that are already shown as logged time blocks — skip them so
   * the same focus time isn't rendered twice on the calendar. */
  hiddenSessionIds: Set<number>,
): Map<string, WeekSession[]> {
  const map = new Map<string, WeekSession[]>();
  for (const s of sessions) {
    if (hiddenSessionIds.has(s.id)) continue;
    const key = toDateString(parseDbDateTime(s.started_at));
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(s);
  }
  return map;
}

function buildBlocksByDay(
  blocks: TimeBlockWithMeta[],
): Map<string, TimeBlockWithMeta[]> {
  const map = new Map<string, TimeBlockWithMeta[]>();
  for (const b of blocks) {
    const key = toDateString(parseDbDateTime(b.start_time));
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(b);
  }
  return map;
}

interface PositionedSession {
  session: WeekSession;
  topPx: number;
  heightPx: number;
}

interface PositionedBlock {
  block: TimeBlockWithMeta;
  topPx: number;
  heightPx: number;
  columnIndex: number;
  columnCount: number;
  stackIndex: number;
}

interface DayLayout {
  positioned: PositionedSession[];
  positionedBlocks: PositionedBlock[];
  hourTopPx: number[];
  totalHeight: number;
}

interface BlockWithRange {
  block: TimeBlockWithMeta;
  index: number;
  startMs: number;
  endMs: number;
}

interface BlockColumn {
  columnIndex: number;
  columnCount: number;
  stackIndex: number;
}

/** Assign real-time overlap groups to horizontal lanes without moving time. */
function assignBlockColumns(blocks: BlockWithRange[]): Map<number, BlockColumn> {
  // `Array.prototype.toSorted` is only available in newer WebKit builds.
  // Intel Macs that are pinned to an older macOS release can still run the
  // Tauri app, so copy before sorting instead of relying on that API.
  const sorted = [...blocks].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const columns = new Map<number, BlockColumn>();
  let group: BlockWithRange[] = [];
  let groupEndMs = Number.NEGATIVE_INFINITY;

  const finishGroup = () => {
    // overlap layout step 1: Greedily reuse the first lane that has ended.
    const laneEnds: number[] = [];
    const assignments = group.map((item) => {
      let columnIndex = laneEnds.findIndex((endMs) => endMs <= item.startMs);
      if (columnIndex < 0) {
        columnIndex = laneEnds.length;
        laneEnds.push(item.endMs);
      } else {
        laneEnds[columnIndex] = item.endMs;
      }
      return { item, columnIndex };
    });

    // overlap layout step 2: Every member uses the component's maximum lane
    // count, so partially overlapping cards remain aligned and readable.
    const columnCount = Math.max(laneEnds.length, 1);
    assignments.forEach(({ item, columnIndex }) => {
      columns.set(item.index, {
        columnIndex,
        columnCount,
        stackIndex: columnIndex,
      });
    });
    group = [];
    groupEndMs = Number.NEGATIVE_INFINITY;
  };

  for (const item of sorted) {
    // overlap layout step 3: Touching boundaries start a new component; a
    // visual gap must never turn them into a false time overlap.
    if (group.length > 0 && item.startMs >= groupEndMs) finishGroup();

    group.push(item);
    groupEndMs = Math.max(groupEndMs, item.endMs);
  }
  if (group.length > 0) finishGroup();

  return columns;
}

/**
 * Compute the visible hour window for the shared time axis. The default range
 * (6–22) expands — in whole-hour steps — to include any session or time block
 * that falls outside it, so a 12:30 AM block no longer clamps to the 6 AM row
 * (the reported bug) and an 11 PM session isn't cut off at the bottom.
 *
 * Expansion is based purely on start/end hours: the axis must cover every row a
 * card touches. Returns the default window unchanged when all content fits.
 */
export function computeVisibleHourRange(
  sessions: WeekSession[],
  timeBlocks: TimeBlockWithMeta[],
  defaultStartHour: number,
  defaultEndHour: number,
): { startHour: number; endHour: number } {
  let startHour = defaultStartHour;
  let endHour = defaultEndHour;

  // The hour index a timestamp falls into: 00:30 → 0, 23:00 → 23. An end time
  // exactly on the hour (e.g. 02:00) ends on that gridline, so its row is the
  // previous hour (01:00) — hence the -1 guard for on-the-hour ends.
  const hourOf = (d: Date, isEnd: boolean): number => {
    let h = d.getHours();
    if (isEnd && d.getMinutes() === 0 && d.getSeconds() === 0) h -= 1;
    return h;
  };

  for (const s of sessions) {
    startHour = Math.min(startHour, hourOf(parseDbDateTime(s.started_at), false));
  }
  for (const b of timeBlocks) {
    startHour = Math.min(startHour, hourOf(parseDbDateTime(b.start_time), false));
    endHour = Math.max(endHour, hourOf(parseDbDateTime(b.end_time), true));
  }
  for (const s of sessions) {
    // Sessions carry a duration rather than an explicit end; derive the end hour.
    const end = parseDbDateTime(s.started_at);
    end.setSeconds(end.getSeconds() + s.duration_sec);
    endHour = Math.max(endHour, hourOf(end, true));
  }

  // Clamp to a valid day range.
  startHour = Math.max(0, Math.min(startHour, defaultStartHour));
  endHour = Math.max(defaultEndHour, Math.min(endHour, 23));
  if (endHour < startHour) endHour = startHour;
  return { startHour, endHour };
}

export function computeDayLayout(
  daySessions: WeekSession[],
  dayBlocks: TimeBlockWithMeta[],
  startHour: number,
  endHour: number,
): DayLayout {
  const sorted = [...daySessions].sort(
    (a, b) =>
      parseDbDateTime(a.started_at).getTime() - parseDbDateTime(b.started_at).getTime(),
  );

  // Every card sits on a single uniform `BASE_HOUR_HEIGHT` scale shared with
  // the time axis, gridlines, and "now" line. Cards are positioned purely from
  // their start time — never shifted to dodge overlaps and never allowed to
  // inflate their hour row — so a card's pixel position always matches the
  // time its label shows. (Previously sessions expanded their hour row and
  // overlapping cards were nudged down, which detached position from time.)
  const positioned: PositionedSession[] = sorted.map((session) => {
    const startTime = parseDbDateTime(session.started_at);
    const durationMin = Math.ceil(session.duration_sec / 60);
    const startMin =
      (startTime.getHours() - startHour) * 60 + startTime.getMinutes();
    const topPx = Math.max((startMin / 60) * BASE_HOUR_HEIGHT, 0);
    const heightPx = Math.max((durationMin / 60) * BASE_HOUR_HEIGHT, 36);
    return { session, topPx, heightPx };
  });

  // Planned blocks use the same vertical scale. Even overlapping cards retain
  // the exact top and height implied by their stored start and end times.
  const blocksWithRange: BlockWithRange[] = dayBlocks.map((block, index) => ({
    block,
    index,
    startMs: parseDbDateTime(block.start_time).getTime(),
    endMs: parseDbDateTime(block.end_time).getTime(),
  }));
  const blockColumns = assignBlockColumns(blocksWithRange);
  const positionedBlocks: PositionedBlock[] = [...blocksWithRange]
    .sort((a, b) => a.startMs - b.startMs)
    .map(({ block, index }) => {
      const startTime = parseDbDateTime(block.start_time);
      const endTime = parseDbDateTime(block.end_time);
      const durationMin = Math.max(
        1,
        Math.round((endTime.getTime() - startTime.getTime()) / 60000),
      );
      const startMin =
        (startTime.getHours() - startHour) * 60 + startTime.getMinutes();
      const topPx = Math.max((startMin / 60) * BASE_HOUR_HEIGHT, 0);
      const heightPx = Math.max((durationMin / 60) * BASE_HOUR_HEIGHT, MIN_BLOCK_HEIGHT);
      const { columnIndex, columnCount, stackIndex } = blockColumns.get(index)!;
      return { block, topPx, heightPx, columnIndex, columnCount, stackIndex };
    });

  // Uniform hour rows: hour h starts at h * BASE_HOUR_HEIGHT, never expanded
  // by content. This is what keeps the shared time axis honest across columns.
  const hourCount = endHour - startHour + 1;
  const hourTopPx = Array.from(
    { length: hourCount + 1 },
    (_, h) => h * BASE_HOUR_HEIGHT,
  );

  const totalContentBottom = Math.max(
    0,
    ...positioned.map((p) => p.topPx + p.heightPx),
    ...positionedBlocks.map((p) => p.topPx + p.heightPx),
  );

  return {
    positioned,
    positionedBlocks,
    hourTopPx,
    totalHeight: Math.max(totalContentBottom, hourTopPx[hourCount]),
  };
}

interface CalendarMobileViewProps {
  weekDays: Date[];
  allDayLayouts: DayLayout[];
  selectedMobileDay: number;
  onSelectMobileDay: (idx: number) => void;
  hours: number[];
  formatHour: (h: number) => string;
  currentTimePos: number | null;
  sessions: WeekSession[];
  onCreateBlock?: (startDate: Date, anchor: CalendarSlotAnchor) => void;
  onViewBlock?: (block: TimeBlockWithMeta) => void;
  onEditBlock?: (block: TimeBlockWithMeta) => void;
  onDeleteBlock?: (block: TimeBlockWithMeta) => void;
  selectedBlockIds: ReadonlySet<number>;
  onSelectBlock?: (block: TimeBlockWithMeta, mode: CalendarSelectionMode) => void;
}

function CalendarMobileView({
  weekDays, allDayLayouts, selectedMobileDay, onSelectMobileDay,
  hours, formatHour, currentTimePos, sessions,
  onCreateBlock, onViewBlock, onEditBlock, onDeleteBlock,
  selectedBlockIds, onSelectBlock,
}: CalendarMobileViewProps) {
  const layout = allDayLayouts[selectedMobileDay];
  const dayDate = weekDays[selectedMobileDay];
  const today = isToday(dayDate);
  const hasBlocks = layout.positionedBlocks.length > 0;

  return (
    <div className="md:hidden flex flex-col">
      <div className="grid grid-cols-7 border-b border-sahara-border/30 px-1">
        {weekDays.map((day, idx) => (
          <CalendarDayPill
            key={day.toDateString()}
            date={day}
            isSelected={idx === selectedMobileDay}
            isToday={isToday(day)}
            onClick={() => onSelectMobileDay(idx)}
          />
        ))}
      </div>

      <div className="flex-1 overflow-y-auto relative pt-8">
        <div className="flex" style={{ minHeight: layout.totalHeight }}>
          <div className="w-12 shrink-0 border-r border-sahara-border/15 bg-sahara-bg/20 relative">
            {hours.map((hour, hIdx) => {
              const rowH = layout.hourTopPx[hIdx + 1] - layout.hourTopPx[hIdx];
              return (
                <div
                  key={hour}
                  className="pr-2 text-right border-b border-sahara-border/10"
                  style={{ height: rowH }}
                >
                  <span className="text-[10px] font-medium text-sahara-text-muted tabular-nums leading-none inline-block mt-2">
                    {formatHour(hour)}
                  </span>
                </div>
              );
            })}
          </div>

          <div
            className={cn("flex-1 relative", today && "bg-sahara-primary-light/10")}
            style={{ minHeight: layout.totalHeight }}
            onClick={(e) => {
              if (!onCreateBlock) return;
              const target = e.currentTarget.getBoundingClientRect();
              const y = e.clientY - target.top;
              onCreateBlock(resolveSnappedStart(dayDate, y, layout, hours), {
                x: e.clientX,
                y: e.clientY,
              });
            }}
          >
            {hours.map((_, hIdx) => (
              <div
                key={hIdx}
                className="relative border-b border-sahara-border/8"
                style={{ height: layout.hourTopPx[hIdx + 1] - layout.hourTopPx[hIdx] }}
              >
                <QuarterHourGuides />
              </div>
            ))}

            {layout.positioned.map(({ session, topPx, heightPx }) => (
              <CalendarSessionBlock key={session.id} session={session} topPx={topPx} heightPx={heightPx} />
            ))}

            {layout.positionedBlocks.map(({ block, topPx, heightPx, columnIndex, columnCount, stackIndex }) => (
              <CalendarTimeBlock
                key={`b-${block.id}`}
                block={block}
                topPx={topPx}
                heightPx={heightPx}
                columnIndex={columnIndex}
                columnCount={columnCount}
                stackIndex={stackIndex}
                onView={onViewBlock}
                onSelect={(selectedBlock, event) => onSelectBlock?.(
                  selectedBlock,
                  event.shiftKey ? "range" : "toggle",
                )}
                onEdit={onEditBlock}
                onDelete={onDeleteBlock}
                isSelected={selectedBlockIds.has(block.id)}
              />
            ))}

            {currentTimePos !== null && today && (
              <div className="absolute left-0 right-0 z-30 pointer-events-none flex items-center" style={{ top: currentTimePos }}>
                <div className="size-1.5 rounded-full bg-sahara-primary -ml-1 shadow-sm" />
                <div className="flex-1 border-t border-sahara-primary/50" />
              </div>
            )}
          </div>
        </div>

        {sessions.length === 0 && !hasBlocks && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center opacity-30">
              <p className="text-xs font-semibold text-sahara-text-muted uppercase tracking-wider">No sessions this day</p>
              <p className="text-[11px] text-sahara-text-muted mt-1">Completed sessions will appear here</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface CalendarDesktopViewProps {
  weekDays: Date[];
  allDayLayouts: DayLayout[];
  hours: number[];
  formatHour: (h: number) => string;
  currentTimePos: number | null;
  todayIdx: number;
  desktopGridTotalHeight: number;
  sessions: WeekSession[];
  onCreateBlock?: (startDate: Date, anchor: CalendarSlotAnchor) => void;
  onViewBlock?: (block: TimeBlockWithMeta) => void;
  onEditBlock?: (block: TimeBlockWithMeta) => void;
  onDeleteBlock?: (block: TimeBlockWithMeta) => void;
  onMoveBlock?: (block: TimeBlockWithMeta, newStart: Date) => void | Promise<void>;
  onResizeBlock?: (block: TimeBlockWithMeta, newEnd: Date) => void | Promise<void>;
  selectedBlockIds: ReadonlySet<number>;
  onSelectBlock?: (block: TimeBlockWithMeta, mode: CalendarSelectionMode) => void;
  onSelectBlocks?: (blockIds: number[]) => void;
  onMoveBlocks?: (blocks: TimeBlockWithMeta[], deltaMs: number) => void | Promise<void>;
}

interface BlockDragGesture {
  block: TimeBlockWithMeta;
  pointerId: number;
  originX: number;
  originY: number;
  active: boolean;
}

interface BlockDragPreview {
  block: TimeBlockWithMeta;
  dayIndex: number;
  startDate: Date;
  topPx: number;
  heightPx: number;
}

interface BlockDragState {
  anchor: BlockDragPreview;
  previews: BlockDragPreview[];
  blocks: TimeBlockWithMeta[];
  deltaMs: number;
}

interface BlockResizeGesture {
  block: TimeBlockWithMeta;
  pointerId: number;
  originY: number;
  active: boolean;
}

interface BlockResizePreview {
  block: TimeBlockWithMeta;
  dayIndex: number;
  newEnd: Date;
  topPx: number;
  heightPx: number;
}

interface MarqueeGesture {
  pointerId: number;
  originX: number;
  originY: number;
  active: boolean;
}

interface MarqueeVisual {
  left: number;
  top: number;
  width: number;
  height: number;
  blockIds: number[];
}

function CalendarDesktopView({
  weekDays, allDayLayouts, hours, formatHour,
  currentTimePos, todayIdx, desktopGridTotalHeight, sessions,
  onCreateBlock, onViewBlock, onEditBlock, onDeleteBlock, onMoveBlock, onResizeBlock,
  selectedBlockIds, onSelectBlock, onSelectBlocks, onMoveBlocks,
}: CalendarDesktopViewProps) {
  const [hoveredSlot, setHoveredSlot] = useState<{
    dayKey: string;
    startDate: Date;
    topPx: number;
  } | null>(null);
  const calendarBodyRef = useRef<HTMLDivElement>(null);
  const dragGestureRef = useRef<BlockDragGesture | null>(null);
  const dragPreviewRef = useRef<BlockDragState | null>(null);
  const resizeGestureRef = useRef<BlockResizeGesture | null>(null);
  const resizePreviewRef = useRef<BlockResizePreview | null>(null);
  const marqueeGestureRef = useRef<MarqueeGesture | null>(null);
  const marqueeRef = useRef<MarqueeVisual | null>(null);
  const suppressClickBlockIdRef = useRef<number | null>(null);
  const suppressMarqueeClickRef = useRef(false);
  const [dragPreview, setDragPreview] = useState<BlockDragState | null>(null);
  const [resizePreview, setResizePreview] = useState<BlockResizePreview | null>(null);
  const [marquee, setMarquee] = useState<MarqueeVisual | null>(null);

  const visibleBlocks = useMemo(
    () => allDayLayouts.flatMap((layout) => layout.positionedBlocks.map(({ block }) => block)),
    [allDayLayouts],
  );

  /** Resolve a captured pointer anywhere over the weekly body to one target slot. */
  const resolveDragPreview = (
    block: TimeBlockWithMeta,
    clientX: number,
    clientY: number,
  ): BlockDragPreview | null => {
    // block drag step 1: Resolve the horizontal coordinate to a visible day.
    const body = calendarBodyRef.current;
    if (!body || weekDays.length === 0) return null;
    const rect = body.getBoundingClientRect();
    const timeAxisWidth = 64;
    const dayWidth = (rect.width - timeAxisWidth) / weekDays.length;
    const relativeX = Math.max(0, clientX - rect.left - timeAxisWidth);
    const dayIndex = Math.max(0, Math.min(weekDays.length - 1, Math.floor(relativeX / dayWidth)));

    // block drag step 2: Resolve the vertical coordinate through the same
    // 15-minute slot function used by empty-grid creation and hover feedback.
    const layout = allDayLayouts[dayIndex];
    const finalGridLine = layout.hourTopPx[hours.length];
    const y = Math.max(0, Math.min(clientY - rect.top, finalGridLine - 1));
    const slot = resolveSnappedSlot(weekDays[dayIndex], y, layout, hours);
    const durationMinutes = (parseDbDateTime(block.end_time).getTime() - parseDbDateTime(block.start_time).getTime()) / 60000;

    return {
      block,
      dayIndex,
      startDate: slot.startDate,
      topPx: slot.topPx,
      heightPx: Math.max((durationMinutes / 60) * BASE_HOUR_HEIGHT, MIN_BLOCK_HEIGHT),
    };
  };

  const handleBlockDragStart = (
    block: TimeBlockWithMeta,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    // block drag step 1: Record the pointer without changing click behavior.
    dragGestureRef.current = {
      block,
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      active: false,
    };
    dragPreviewRef.current = null;
    setDragPreview(null);
  };

  /** Translate every selected block by the anchor block's snapped delta. */
  const buildDragState = (
    anchorPreview: BlockDragPreview,
    anchorBlock: TimeBlockWithMeta,
  ): BlockDragState => {
    // group drag step 1: Dragging an unselected block retains legacy single
    // movement; dragging a selected block moves the complete visible group.
    const blocks = selectedBlockIds.has(anchorBlock.id)
      ? visibleBlocks.filter((block) => selectedBlockIds.has(block.id))
      : [anchorBlock];
    const deltaMs = anchorPreview.startDate.getTime() - parseDbDateTime(anchorBlock.start_time).getTime();

    // group drag step 2: Preserve each block's relative start and duration in
    // the preview. Blocks shifted outside this week still persist correctly.
    const previews = blocks.flatMap((block) => {
      const startDate = new Date(parseDbDateTime(block.start_time).getTime() + deltaMs);
      const dayIndex = weekDays.findIndex((day) => toDateString(day) === toDateString(startDate));
      if (dayIndex < 0) return [];
      const durationMinutes = (parseDbDateTime(block.end_time).getTime() - parseDbDateTime(block.start_time).getTime()) / 60000;
      const topPx = ((startDate.getHours() - hours[0]) + startDate.getMinutes() / 60) * BASE_HOUR_HEIGHT;
      return [{
        block,
        dayIndex,
        startDate,
        topPx,
        heightPx: Math.max((durationMinutes / 60) * BASE_HOUR_HEIGHT, MIN_BLOCK_HEIGHT),
      }];
    });

    return { anchor: anchorPreview, previews, blocks, deltaMs };
  };

  const handleBlockDragMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = dragGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    // block drag step 2: A six-pixel threshold keeps ordinary clicks intact.
    if (!gesture.active && !exceedsBlockDragThreshold(
      gesture.originX,
      gesture.originY,
      event.clientX,
      event.clientY,
    )) return;

    gesture.active = true;
    event.preventDefault();
    setHoveredSlot(null);
    const preview = resolveDragPreview(gesture.block, event.clientX, event.clientY);
    const state = preview ? buildDragState(preview, gesture.block) : null;
    dragPreviewRef.current = state;
    setDragPreview(state);
  };

  const handleBlockDragEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = dragGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const preview = dragPreviewRef.current;
    const shouldCommit = gesture.active && event.type !== "pointercancel" && preview !== null;

    // block drag step 3: Suppress the synthetic post-drag click, then persist
    // only when the snapped start actually changed.
    if (gesture.active) {
      event.preventDefault();
      suppressClickBlockIdRef.current = gesture.block.id;
      window.setTimeout(() => {
        if (suppressClickBlockIdRef.current === gesture.block.id) {
          suppressClickBlockIdRef.current = null;
        }
      }, 0);
    }
    if (shouldCommit && preview.deltaMs !== 0) {
      const operation = preview.blocks.length > 1 && onMoveBlocks
        ? onMoveBlocks(preview.blocks, preview.deltaMs)
        : onMoveBlock?.(gesture.block, preview.anchor.startDate);
      void Promise.resolve(operation).catch((error) => {
        console.error("[Calendar] Failed to move time block:", error);
      });
    }

    dragGestureRef.current = null;
    dragPreviewRef.current = null;
    setDragPreview(null);
  };

  /** Resolve a bottom-edge pointer to a same-day quarter-hour end time. */
  const resolveResizePreview = (
    block: TimeBlockWithMeta,
    clientY: number,
  ): BlockResizePreview | null => {
    // resize preview step 1: Keep resizing in the block's visible day column.
    const body = calendarBodyRef.current;
    if (!body || hours.length === 0) return null;
    const start = parseDbDateTime(block.start_time);
    const dayIndex = weekDays.findIndex((day) => toDateString(day) === toDateString(start));
    if (dayIndex < 0) return null;

    // resize preview step 2: Convert vertical pixels to the nearest quarter-hour.
    const rect = body.getBoundingClientRect();
    const layout = allDayLayouts[dayIndex];
    const y = Math.max(0, Math.min(clientY - rect.top, layout.totalHeight));
    const rawOffsetMinutes = (y / BASE_HOUR_HEIGHT) * 60;
    const proposedEnd = new Date(weekDays[dayIndex]);
    proposedEnd.setHours(hours[0], 0, 0, 0);
    proposedEnd.setMinutes(proposedEnd.getMinutes() + rawOffsetMinutes);
    const newEnd = snapCalendarResizeEnd(start, proposedEnd);

    // resize preview step 3: Preserve the stored start and preview only height.
    const startMinutes = (start.getHours() - hours[0]) * 60 + start.getMinutes();
    const durationMinutes = (newEnd.getTime() - start.getTime()) / 60_000;
    return {
      block,
      dayIndex,
      newEnd,
      topPx: (startMinutes / 60) * BASE_HOUR_HEIGHT,
      heightPx: Math.max((durationMinutes / 60) * BASE_HOUR_HEIGHT, MIN_BLOCK_HEIGHT),
    };
  };

  const handleBlockResizeStart = (
    block: TimeBlockWithMeta,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    // resize gesture step 1: Record the edge gesture without entering move mode.
    resizeGestureRef.current = {
      block,
      pointerId: event.pointerId,
      originY: event.clientY,
      active: false,
    };
    resizePreviewRef.current = null;
    setResizePreview(null);
  };

  const handleBlockResizeMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const gesture = resizeGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (!gesture.active && Math.abs(event.clientY - gesture.originY) < 2) return;

    // resize gesture step 2: Preview the snapped duration without moving start.
    gesture.active = true;
    event.preventDefault();
    setHoveredSlot(null);
    const preview = resolveResizePreview(gesture.block, event.clientY);
    resizePreviewRef.current = preview;
    setResizePreview(preview);
  };

  const handleBlockResizeEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const gesture = resizeGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const preview = resizePreviewRef.current;
    const shouldCommit = gesture.active && event.type !== "pointercancel" && preview !== null
      && preview.newEnd.getTime() !== parseDbDateTime(gesture.block.end_time).getTime();

    // resize gesture step 3: Persist only a changed, valid snapped end.
    if (shouldCommit) {
      void Promise.resolve(onResizeBlock?.(gesture.block, preview.newEnd)).catch((error) => {
        console.error("[Calendar] Failed to resize time block:", error);
      });
    }
    resizeGestureRef.current = null;
    resizePreviewRef.current = null;
    setResizePreview(null);
  };

  const handleBlockView = (block: TimeBlockWithMeta) => {
    if (suppressClickBlockIdRef.current === block.id || suppressMarqueeClickRef.current) return;
    onViewBlock?.(block);
  };

  const handleBlockSelection = (
    block: TimeBlockWithMeta,
    event: React.MouseEvent<HTMLDivElement>,
  ) => {
    if (suppressMarqueeClickRef.current) return;
    onSelectBlock?.(block, event.shiftKey ? "range" : "toggle");
  };

  /** Begin a Shift-owned marquee without interfering with ordinary block drag. */
  const handleMarqueeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.shiftKey || event.button !== 0 || !onSelectBlocks) return;
    marqueeGestureRef.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      active: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleMarqueeMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = marqueeGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return false;
    if (!gesture.active && !exceedsBlockDragThreshold(
      gesture.originX,
      gesture.originY,
      event.clientX,
      event.clientY,
    )) return false;

    gesture.active = true;
    event.preventDefault();
    setHoveredSlot(null);
    const body = calendarBodyRef.current;
    if (!body) return true;
    const bodyRect = body.getBoundingClientRect();
    const selectionRect = {
      left: Math.min(gesture.originX, event.clientX),
      top: Math.min(gesture.originY, event.clientY),
      right: Math.max(gesture.originX, event.clientX),
      bottom: Math.max(gesture.originY, event.clientY),
    };
    const blockIds = [...body.querySelectorAll<HTMLElement>("[data-calendar-block-id]")]
      .filter((element) => selectionRectsIntersect(selectionRect, element.getBoundingClientRect()))
      .map((element) => Number(element.dataset.calendarBlockId))
      .filter(Number.isFinite);
    const visual = {
      left: selectionRect.left - bodyRect.left,
      top: selectionRect.top - bodyRect.top,
      width: selectionRect.right - selectionRect.left,
      height: selectionRect.bottom - selectionRect.top,
      blockIds: [...new Set(blockIds)],
    };
    marqueeRef.current = visual;
    setMarquee(visual);
    return true;
  };

  const handleMarqueeEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = marqueeGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.active) {
      event.preventDefault();
      suppressMarqueeClickRef.current = true;
      onSelectBlocks?.(marqueeRef.current?.blockIds ?? []);
      window.setTimeout(() => { suppressMarqueeClickRef.current = false; }, 0);
    }
    marqueeGestureRef.current = null;
    marqueeRef.current = null;
    setMarquee(null);
  };

  // Week has planned blocks if any day's layout positioned any. Kept in sync
  // with the `positionedBlocks` rendering below so the empty-state only shows
  // when both sessions and blocks are absent.
  const hasBlocks = allDayLayouts.some((l) => l.positionedBlocks.length > 0);

  return (
    <div className="hidden md:flex flex-col flex-1 min-h-0">
      <div className="grid border-b border-sahara-border/30" style={{ gridTemplateColumns: `64px repeat(${weekDays.length}, 1fr)` }}>
        <div className="p-4 border-r border-sahara-border/20" />
        {weekDays.map((day) => {
          const dayIdx = day.getDay() === 0 ? 6 : day.getDay() - 1;
          const today = isToday(day);
          return (
            <div key={day.toDateString()} className={cn("px-2 pt-3 pb-2 text-center border-r last:border-r-0 border-sahara-border/20 relative", today && "bg-sahara-primary-light/20")}>
              <span className={cn("text-[10px] font-medium tracking-[0.15em] block mb-0.5", today ? "text-sahara-primary" : "text-sahara-text-muted")}>{DAY_LABELS_FULL[dayIdx]}</span>
              <p className={cn("font-serif text-2xl leading-none", today ? "text-sahara-primary font-bold" : "text-sahara-text")}>{day.getDate()}</p>
              {today && <div className="absolute bottom-0 left-4 right-4 h-0.5 bg-sahara-primary rounded-full" />}
            </div>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto relative">
        <div ref={calendarBodyRef} className="grid" style={{ gridTemplateColumns: `64px repeat(${weekDays.length}, 1fr)`, minHeight: desktopGridTotalHeight }}>
          <div className="border-r border-sahara-border/20 bg-sahara-bg/30 relative shrink-0 w-16">
            {hours.map((hour, hIdx) => {
              // Rows are uniform across all columns (see computeDayLayout), so
              // the shared axis reads one column's height — no per-column max.
              const rowH = allDayLayouts[0].hourTopPx[hIdx + 1] - allDayLayouts[0].hourTopPx[hIdx];
              return (
                <div key={hour} className="pr-3 text-right border-b border-sahara-border/15" style={{ height: rowH }}>
                  <span className="text-[11px] font-medium text-sahara-text-muted tabular-nums leading-none inline-block mt-2">{formatHour(hour)}</span>
                </div>
              );
            })}
          </div>

          {weekDays.map((day, idx) => {
            const layout = allDayLayouts[idx];
            const today = isToday(day);
            return (
              <div
                key={day.toDateString()}
                className={cn(
                  "relative border-r last:border-r-0 border-sahara-border/15 cursor-pointer",
                  today && "bg-sahara-primary-light/30",
                )}
                style={{ minHeight: layout.totalHeight }}
                onPointerDown={handleMarqueeStart}
                onPointerMove={(e) => {
                  if (handleMarqueeMove(e)) return;
                  if (!onCreateBlock || (e.pointerType && e.pointerType !== "mouse")) return;
                  if (dragGestureRef.current?.active) return;
                  const target = e.currentTarget.getBoundingClientRect();
                  const slot = resolveSnappedSlot(day, e.clientY - target.top, layout, hours);
                  const dayKey = toDateString(day);
                  setHoveredSlot((current) => {
                    if (current?.dayKey === dayKey && current.startDate.getTime() === slot.startDate.getTime()) {
                      return current;
                    }
                    return { dayKey, startDate: slot.startDate, topPx: slot.topPx };
                  });
                }}
                onPointerUp={handleMarqueeEnd}
                onPointerCancel={handleMarqueeEnd}
                onPointerLeave={() => setHoveredSlot(null)}
                onClick={(e) => {
                  if (suppressMarqueeClickRef.current) return;
                  if (!onCreateBlock) return;
                  const target = e.currentTarget.getBoundingClientRect();
                  const y = e.clientY - target.top;
                  onCreateBlock(resolveSnappedSlot(day, y, layout, hours).startDate, {
                    x: e.clientX,
                    y: e.clientY,
                  });
                }}
              >
                {hours.map((_, hIdx) => (
                  <div key={hIdx} className="relative border-b border-sahara-border/10" style={{ height: layout.hourTopPx[hIdx + 1] - layout.hourTopPx[hIdx] }}>
                    <QuarterHourGuides />
                  </div>
                ))}
                {hoveredSlot?.dayKey === toDateString(day) && (
                  <>
                    <div
                      className="absolute left-0 right-0 z-[5] pointer-events-none border-t border-dashed border-sahara-text/55"
                      style={{ top: hoveredSlot.topPx }}
                      aria-hidden="true"
                    />
                    <span
                      className={cn(
                        "absolute z-40 -translate-y-1/2 pointer-events-none rounded-md bg-sahara-text/90 px-1.5 py-1 text-[9px] font-semibold leading-none tabular-nums text-sahara-bg shadow-sm",
                        idx < weekDays.length - 1
                          ? "left-[calc(100%+6px)]"
                          : "right-[calc(100%+6px)]",
                      )}
                      style={{ top: hoveredSlot.topPx }}
                      aria-hidden="true"
                    >
                      {String(hoveredSlot.startDate.getHours()).padStart(2, "0")}:{String(hoveredSlot.startDate.getMinutes()).padStart(2, "0")}
                    </span>
                  </>
                )}
                {layout.positioned.map(({ session, topPx, heightPx }) => (
                  <CalendarSessionBlock key={session.id} session={session} topPx={topPx} heightPx={heightPx} />
                ))}
                {layout.positionedBlocks.map(({ block, topPx, heightPx, columnIndex, columnCount, stackIndex }) => (
                  <CalendarTimeBlock
                    key={`b-${block.id}`}
                    block={block}
                    topPx={topPx}
                    heightPx={heightPx}
                    columnIndex={columnIndex}
                    columnCount={columnCount}
                    stackIndex={stackIndex}
                    onView={handleBlockView}
                    onSelect={handleBlockSelection}
                    onEdit={onEditBlock}
                    onDelete={onDeleteBlock}
                    onDragStart={onMoveBlock ? handleBlockDragStart : undefined}
                    onDragMove={onMoveBlock ? handleBlockDragMove : undefined}
                    onDragEnd={onMoveBlock ? handleBlockDragEnd : undefined}
                    onResizeStart={onResizeBlock ? handleBlockResizeStart : undefined}
                    onResizeMove={onResizeBlock ? handleBlockResizeMove : undefined}
                    onResizeEnd={onResizeBlock ? handleBlockResizeEnd : undefined}
                    isDragging={dragPreview?.blocks.some((dragged) => dragged.id === block.id)}
                    isResizing={resizePreview?.block.id === block.id}
                    isSelected={selectedBlockIds.has(block.id) || Boolean(marquee?.blockIds.includes(block.id))}
                  />
                ))}
                {dragPreview?.previews
                  .filter((preview) => preview.dayIndex === idx)
                  .map((preview) => (
                    <div
                      key={`drag-${preview.block.id}`}
                      className="absolute left-1 right-1 z-50 pointer-events-none rounded-lg border-2 border-dashed bg-sahara-bg/80 px-2 py-1.5 shadow-lg backdrop-blur-sm"
                      style={{
                        top: preview.topPx,
                        height: preview.heightPx,
                        borderColor: resolveScheduleBlockColor(preview.block),
                      }}
                    >
                      <p className="truncate text-[11px] font-bold text-sahara-text">
                        {preview.block.title || preview.block.task_name || preview.block.category_name || "Focus block"}
                      </p>
                      <p className="mt-0.5 text-[9px] tabular-nums text-sahara-text-muted">
                        {String(preview.startDate.getHours()).padStart(2, "0")}:{String(preview.startDate.getMinutes()).padStart(2, "0")}
                      </p>
                    </div>
                  ))}
                {resizePreview?.dayIndex === idx && (
                  <div
                    className="absolute left-1 right-1 z-50 pointer-events-none rounded-lg border-2 border-dashed bg-sahara-bg/80 px-2 py-1.5 shadow-lg backdrop-blur-sm"
                    style={{
                      top: resizePreview.topPx,
                      height: resizePreview.heightPx,
                      borderColor: resolveScheduleBlockColor(resizePreview.block),
                    }}
                  >
                    <p className="truncate text-[11px] font-bold text-sahara-text">
                      {resizePreview.block.title || resizePreview.block.task_name || resizePreview.block.category_name || "Focus block"}
                    </p>
                    <p className="mt-0.5 text-[9px] tabular-nums text-sahara-text-muted">
                      until {String(resizePreview.newEnd.getHours()).padStart(2, "0")}:{String(resizePreview.newEnd.getMinutes()).padStart(2, "0")}
                    </p>
                  </div>
                )}
                {currentTimePos !== null && idx === todayIdx && (
                  <div className="absolute left-0 right-0 z-30 pointer-events-none flex items-center" style={{ top: currentTimePos }}>
                    <div className="size-1.5 rounded-full bg-sahara-primary -ml-1 shadow-sm" />
                    <div className="flex-1 border-t border-sahara-primary/40" />
                  </div>
                )}
              </div>
            );
          })}
          {marquee && (
            <div
              className="pointer-events-none absolute z-[80] rounded-md border border-sahara-primary bg-sahara-primary/15 shadow-sm"
              style={{
                left: marquee.left,
                top: marquee.top,
                width: marquee.width,
                height: marquee.height,
              }}
              aria-hidden="true"
            />
          )}
        </div>

        {sessions.length === 0 && !hasBlocks && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center opacity-30">
              <p className="text-xs font-semibold text-sahara-text-muted uppercase tracking-wider">No sessions this week</p>
              <p className="text-[11px] text-sahara-text-muted mt-1">Completed sessions will appear here</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function CalendarGrid({
  sessions,
  timeBlocks,
  weekDays,
  startHour,
  endHour,
  onCreateBlock,
  onViewBlock,
  onEditBlock,
  onDeleteBlock,
  onMoveBlock,
  onResizeBlock,
  selectedBlockIds = new Set<number>(),
  onSelectBlock,
  onSelectBlocks,
  onMoveBlocks,
}: CalendarGridProps) {
  // The time axis expands beyond the default 6–22 window when any session or
  // block falls outside it, so early/late cards get a real row instead of
  // clamping to the top/bottom of the grid.
  const { startHour: visibleStartHour, endHour: visibleEndHour } = useMemo(
    () => computeVisibleHourRange(sessions, timeBlocks, startHour, endHour),
    [sessions, timeBlocks, startHour, endHour],
  );

  const hours = Array.from(
    { length: visibleEndHour - visibleStartHour + 1 },
    (_, i) => visibleStartHour + i,
  );

  function formatHour(h: number): string {
    return `${String(h).padStart(2, "0")}:00`;
  }

  const nowRef = useRef(new Date());
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      nowRef.current = new Date();
      setTick((t) => t + 1);
    }, 60000);
    return () => clearInterval(id);
  }, []);

  // Session ids logged from a time block — those rows are rendered (and
  // counted in stats) via the time block card, so skip them as plain sessions.
  const loggedSessionIds = useMemo(
    () =>
      new Set(
        timeBlocks
          .map((b) => b.session_id)
          .filter((id): id is number => id != null),
      ),
    [timeBlocks],
  );

  const sessionsByDay = useMemo(
    () => buildSessionsByDay(sessions, loggedSessionIds),
    [sessions, loggedSessionIds],
  );
  const blocksByDay = useMemo(() => buildBlocksByDay(timeBlocks), [timeBlocks]);

  const todayIdx = weekDays.findIndex(isToday);

  const [selectedMobileDay, setSelectedMobileDay] = useState(
    todayIdx >= 0 ? todayIdx : 0,
  );

  useEffect(() => {
    if (todayIdx >= 0) setSelectedMobileDay(todayIdx);
  }, [todayIdx]);

  const allDayLayouts = useMemo(
    () =>
      weekDays.map((day) =>
        computeDayLayout(
          sessionsByDay.get(toDateString(day)) ?? [],
          blocksByDay.get(toDateString(day)) ?? [],
          visibleStartHour,
          visibleEndHour,
        ),
      ),
    [sessionsByDay, blocksByDay, weekDays, visibleStartHour, visibleEndHour],
  );

  function getCurrentTimePosition(): number | null {
    const currentMinutes = nowRef.current.getHours() * 60 + nowRef.current.getMinutes();
    const startMinutes = visibleStartHour * 60;
    if (currentMinutes < startMinutes || currentMinutes > (visibleEndHour + 1) * 60)
      return null;

    const offsetMin = currentMinutes - startMinutes;
    return (offsetMin / 60) * BASE_HOUR_HEIGHT;
  }

  const currentTimePos = getCurrentTimePosition();

  const desktopGridTotalHeight = Math.max(
    ...allDayLayouts.map((l) => l.totalHeight),
  );

  return (
    <div className="bg-sahara-surface rounded-2xl overflow-hidden shadow-sm border border-sahara-border/40 flex flex-col min-h-full">
      <CalendarMobileView
        weekDays={weekDays}
        allDayLayouts={allDayLayouts}
        selectedMobileDay={selectedMobileDay}
        onSelectMobileDay={setSelectedMobileDay}
        hours={hours}
        formatHour={formatHour}
        currentTimePos={currentTimePos}
        sessions={sessions}
        onCreateBlock={onCreateBlock}
        onViewBlock={onViewBlock}
        onEditBlock={onEditBlock}
        onDeleteBlock={onDeleteBlock}
        selectedBlockIds={selectedBlockIds}
        onSelectBlock={onSelectBlock}
      />
      <CalendarDesktopView
        weekDays={weekDays}
        allDayLayouts={allDayLayouts}
        hours={hours}
        formatHour={formatHour}
        currentTimePos={currentTimePos}
        todayIdx={todayIdx}
        desktopGridTotalHeight={desktopGridTotalHeight}
        sessions={sessions}
        onCreateBlock={onCreateBlock}
        onViewBlock={onViewBlock}
        onEditBlock={onEditBlock}
        onDeleteBlock={onDeleteBlock}
        onMoveBlock={onMoveBlock}
        onResizeBlock={onResizeBlock}
        selectedBlockIds={selectedBlockIds}
        onSelectBlock={onSelectBlock}
        onSelectBlocks={onSelectBlocks}
        onMoveBlocks={onMoveBlocks}
      />
    </div>
  );
}
