import { Pencil, Trash2 } from "lucide-react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { TimeBlockWithMeta } from "@/lib/db";
import { cn } from "@/lib/cn";
import { MIN_BLOCK_HEIGHT } from "./calendar-grid";
import { resolveScheduleBlockColor } from "@/features/schedule/schedule-block-color";
import { formatTime24Hour } from "@/lib/time";

interface CalendarTimeBlockProps {
  block: TimeBlockWithMeta;
  topPx: number;
  heightPx: number;
  columnIndex?: number;
  columnCount?: number;
  stackIndex?: number;
  onView?: (block: TimeBlockWithMeta) => void;
  onSelect?: (block: TimeBlockWithMeta, event: ReactMouseEvent<HTMLDivElement>) => void;
  onEdit?: (block: TimeBlockWithMeta) => void;
  onDelete?: (block: TimeBlockWithMeta) => void;
  onDragStart?: (block: TimeBlockWithMeta, event: ReactPointerEvent<HTMLDivElement>) => void;
  onDragMove?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onDragEnd?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizeStart?: (block: TimeBlockWithMeta, event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizeMove?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizeEnd?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  isDragging?: boolean;
  isResizing?: boolean;
  isSelected?: boolean;
}

function formatRange(startStr: string, endStr: string): string {
  return `${formatTime24Hour(startStr)} – ${formatTime24Hour(endStr)}`;
}

/** Preserve time geometry while giving the visible card proportional breathing room. */
export function getCalendarBlockVisualInset(heightPx: number): number {
  // visual density step 1: A 15-minute cell keeps nearly all of its hit area.
  if (heightPx <= MIN_BLOCK_HEIGHT) return 0.25;

  // visual density step 2: Adjacent 30-minute cards share a subtle 1.5px gap.
  if (heightPx <= MIN_BLOCK_HEIGHT * 2) return 0.75;

  // visual density step 3: Longer blocks receive a small fixed gutter without
  // increasingly understating their duration.
  return 1;
}

/** Planned block with exact outer time geometry and an inset visual card. */
export function CalendarTimeBlock({
  block,
  topPx,
  heightPx,
  columnIndex = 0,
  columnCount = 1,
  stackIndex = 0,
  onView,
  onSelect,
  onEdit,
  onDelete,
  onDragStart,
  onDragMove,
  onDragEnd,
  onResizeStart,
  onResizeMove,
  onResizeEnd,
  isDragging = false,
  isResizing = false,
  isSelected = false,
}: CalendarTimeBlockProps) {
  const color = resolveScheduleBlockColor(block);
  const label = block.title || block.task_name || block.category_name || "Focus block";
  const isShort = heightPx < 56;
  const isQuarterHour = heightPx <= MIN_BLOCK_HEIGHT;
  const visualInsetY = getCalendarBlockVisualInset(heightPx);
  // A block linked to a session has already been logged as focus time, so it
  // counts toward stats — render it solid (like a completed session) instead
  // of dashed, and drop the "start focus" action.
  const isLogged = block.session_id != null;

  return (
    <div
      data-calendar-block-id={block.id}
      className={cn(
        "absolute left-0 z-20 group select-none",
        onDragStart ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        (isDragging || isResizing) && "opacity-30",
      )}
      style={{
        // calendar block step 1: Never move a card vertically to reveal an
        // overlap; its top and height are the calendar's time contract.
        top: topPx,
        height: Math.max(heightPx, MIN_BLOCK_HEIGHT),
        left: `${(columnIndex / columnCount) * 100}%`,
        width: `${100 / columnCount}%`,
        // calendar block step 2: Preserve the original horizontal width; only
        // the vertical visual footprint is inset.
        paddingLeft: 4,
        paddingRight: 4,
        zIndex: 20 + stackIndex,
        touchAction: onDragStart ? "none" : undefined,
        WebkitUserSelect: "none",
      }}
      onPointerDown={(event) => {
        if (!onDragStart || event.button !== 0) return;
        if ((event.target as HTMLElement).closest("[data-block-action]")) return;
        // Shift owns marquee selection; never start the ordinary block move.
        if (event.shiftKey) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        onDragStart(block, event);
      }}
      onPointerMove={onDragMove}
      onPointerUp={onDragEnd}
      onPointerCancel={onDragEnd}
      onClick={(e) => {
        e.stopPropagation();
        if ((e.shiftKey || e.ctrlKey || e.metaKey) && onSelect) {
          e.preventDefault();
          onSelect(block, e);
          return;
        }
        onView?.(block);
      }}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && onView) {
          e.preventDefault();
          onView(block);
        }
      }}
      role={onView ? "button" : undefined}
      tabIndex={onView ? 0 : undefined}
      aria-label={onView ? `View details for ${label}` : undefined}
    >
      <div
        className={cn(
          "w-full rounded-lg border-2 px-2 flex flex-col justify-center overflow-hidden transition-all hover:shadow-md",
          isQuarterHour ? "py-0" : "py-1",
          isSelected
            ? "shadow-lg"
            : isLogged
            ? "bg-sahara-bg/80 backdrop-blur-sm"
            : "border-dashed bg-sahara-bg/60 backdrop-blur-sm",
        )}
        style={{
          // calendar block step 3: Insets create separation without changing
          // the outer top/height used by drag, resize, and time-grid accuracy.
          height: `calc(100% - ${visualInsetY * 2}px)`,
          marginTop: visualInsetY,
          borderColor: color,
          background: isSelected
            ? `color-mix(in srgb, ${color} 68%, #111827 32%)`
            : undefined,
        }}
      >
        <div className="flex h-full w-full min-h-0 items-center gap-1.5">
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: isSelected ? "white" : color }}
          />
          <div className="min-w-0 flex-1 text-left">
            <p className={cn(
              "truncate text-left text-[11px] font-bold leading-tight",
              isSelected ? "text-white" : "text-sahara-text",
            )}>
              {label}
            </p>
            {!isShort && (
              <p className={cn(
                "mt-0.5 text-left text-[9px] tabular-nums",
                isSelected ? "text-white/75" : "text-sahara-text-muted",
              )}>
                {formatRange(block.start_time, block.end_time)}
              </p>
            )}
          </div>
        </div>

        {/* Hover actions. The buttons stop propagation on both click and
            keydown so Enter/Space stay exclusive to their own action and never
            bubble up to the card-level onView keyboard handler. */}
        <div
          className="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
          onKeyDown={(e) => e.stopPropagation()}
        >
          {onEdit && (
            <button
              data-block-action
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onEdit(block);
              }}
              className={cn(
                "p-1 rounded shadow-sm hover:bg-sahara-surface",
                isSelected
                  ? "bg-black/20 text-white hover:text-sahara-primary"
                  : "bg-sahara-surface/90 text-sahara-text-muted hover:text-sahara-primary",
              )}
              title="Edit"
            >
              <Pencil className="size-3" />
            </button>
          )}
          {onDelete && (
            <button
              data-block-action
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(block);
              }}
              className={cn(
                "p-1 rounded shadow-sm hover:text-red-500 hover:bg-sahara-surface",
                isSelected ? "bg-black/20 text-white" : "bg-sahara-surface/90 text-sahara-text-muted",
              )}
              title="Delete"
            >
              <Trash2 className="size-3" />
            </button>
          )}
        </div>
      </div>

      {onResizeStart && (
        <button
          type="button"
          data-block-action
          aria-label={`Resize ${label}`}
          title="Drag to resize in 15-minute steps"
          className="absolute bottom-0 left-2 right-2 z-40 h-2 cursor-ns-resize touch-none"
          style={{ bottom: visualInsetY }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            // resize handle step 1: Own this gesture so the block body cannot move.
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            onResizeStart(block, event);
          }}
          onPointerMove={(event) => {
            event.stopPropagation();
            onResizeMove?.(event);
          }}
          onPointerUp={(event) => {
            event.stopPropagation();
            onResizeEnd?.(event);
          }}
          onPointerCancel={(event) => {
            event.stopPropagation();
            onResizeEnd?.(event);
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <span className="absolute bottom-0.5 left-1/2 h-0.5 w-7 -translate-x-1/2 rounded-full bg-current opacity-0 transition-opacity group-hover:opacity-45" />
        </button>
      )}
    </div>
  );
}
