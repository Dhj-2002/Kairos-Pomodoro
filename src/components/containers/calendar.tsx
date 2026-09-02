import { useState, useEffect, useCallback, useMemo, useRef, useReducer } from "react";
import { Loader2 } from "lucide-react";
import {
  getWeekSessions,
  getWeekTimeBlocks,
  getSequenceTemplates,
  type WeekSession,
  type TimeBlockWithMeta,
  type TimeBlockInput,
  type SequenceTemplate,
} from "@/lib/db";
import {
  applySequenceTemplateAt,
  createCountedTimeBlock,
  deleteCountedTimeBlock,
  deleteCountedTimeBlocks,
  moveCountedTimeBlock,
  moveCountedTimeBlocks,
  resizeCountedTimeBlock,
  updateCountedTimeBlock,
  buildMovedTimeBlockInput,
  buildShiftedTimeBlockInputs,
  buildResizedTimeBlockInput,
} from "@/features/schedule/schedule-block-service";
import { CalendarGrid, type CalendarSelectionMode } from "@/components/base/calendar-grid";
import { TimeBlockForm } from "@/components/base/time-block-form";
import { TimeBlockDetailsModal } from "@/components/base/time-block-details-modal";
import { reconcileAchievements } from "@/features/achievements/achievement-service";
import { useAchievementStore } from "@/features/achievements/use-achievement-store";
import { useCalendarToolbarStore } from "@/features/schedule/use-calendar-toolbar-store";
import { SequenceTemplateManager } from "@/components/schedule/sequence-template-manager";
import { CalendarSlotMenu } from "@/components/schedule/calendar-slot-menu";
import { CalendarBatchDeleteModal } from "@/components/schedule/calendar-batch-delete-modal";
import type { CalendarSlotAnchor } from "@/components/base/calendar-grid";
import { chronologicalBlockRange } from "@/features/schedule/calendar-selection";
import {
  CALENDAR_VIEW_STORAGE_KEY,
  buildCenteredSevenDays,
  parseCalendarViewPreference,
  resolveCalendarCenter,
  shiftCalendarView,
  toLocalISODate,
  type CalendarViewPreference,
} from "@/features/schedule/calendar-view";
import { parseDbDateTime } from "@/lib/time";

// Calendar day step 1: Always expose the complete civil day. `END_HOUR` is
// the final hour row, whose lower boundary is 24:00.
const START_HOUR = 0;
const END_HOUR = 23;

interface CalendarData {
  sessions: WeekSession[];
  timeBlocks: TimeBlockWithMeta[];
}

const CALENDAR_INIT: CalendarData = {
  sessions: [],
  timeBlocks: [],
};

type CalendarAction =
  | { type: "LOADED"; sessions: WeekSession[]; timeBlocks: TimeBlockWithMeta[] }
  | { type: "PATCH_BLOCKS"; patches: Array<{ id: number; changes: Partial<TimeBlockWithMeta> }> }
  | { type: "ERROR" };

function calendarReducer(state: CalendarData, action: CalendarAction): CalendarData {
  switch (action.type) {
    case "LOADED":
      return { sessions: action.sessions, timeBlocks: action.timeBlocks };
    case "PATCH_BLOCKS": {
      const patches = new Map(action.patches.map((patch) => [patch.id, patch.changes]));
      return {
        ...state,
        timeBlocks: state.timeBlocks.map((block) => {
          const changes = patches.get(block.id);
          return changes ? { ...block, ...changes } : block;
        }),
      };
    }
    case "ERROR":
      return { sessions: [], timeBlocks: [] };
  }
}

export function CalendarDashboard() {
  const [viewPreference, setViewPreference] = useState<CalendarViewPreference>(() => (
    parseCalendarViewPreference(typeof window === "undefined" ? null : window.localStorage.getItem(CALENDAR_VIEW_STORAGE_KEY))
  ));
  const [data, dispatch] = useReducer(calendarReducer, CALENDAR_INIT);
  const loadingRef = useRef(true);
  const loadedRef = useRef<string | null>(null);
  // Bump to force the data-load effect to re-run (after a block CRUD op).
  const [reloadNonce, setReloadNonce] = useState(0);

  // calendar range step 1: Keep Today in column four; a manual move persists
  // an exact center date until the user explicitly restores Today mode.
  const centerDate = resolveCalendarCenter(viewPreference);
  const rangeDays = buildCenteredSevenDays(centerDate);
  const rangeStart = rangeDays[0];
  const rangeEnd = rangeDays[6];
  const rangeKey = `${toLocalISODate(rangeStart)}_${toLocalISODate(rangeEnd)}`;

  useEffect(() => {
    window.localStorage.setItem(CALENDAR_VIEW_STORAGE_KEY, JSON.stringify(viewPreference));
  }, [viewPreference]);

  useEffect(() => {
    if (loadedRef.current === rangeKey) return;
    loadedRef.current = rangeKey;

    let cancelled = false;
    loadingRef.current = true;

    const startStr = toLocalISODate(rangeStart);
    const endStr = toLocalISODate(rangeEnd);

    let timeoutId: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("timeout")), 5000);
    });

    Promise.race([
      Promise.all([
        getWeekSessions(startStr, endStr).catch(() => [] as WeekSession[]),
        getWeekTimeBlocks(startStr, endStr).catch(() => [] as TimeBlockWithMeta[]),
      ]),
      timeout,
    ])
      .then(([sessData, blockData]) => {
        if (!cancelled) dispatch({ type: "LOADED", sessions: sessData, timeBlocks: blockData });
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: "ERROR" });
      })
      .finally(() => {
        if (!cancelled) { loadingRef.current = false; }
      });

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [rangeKey, reloadNonce]);

  const handlePrev = useCallback(() => {
    loadedRef.current = null;
    setViewPreference((current) => shiftCalendarView(current, -1));
  }, []);
  const handleNext = useCallback(() => {
    loadedRef.current = null;
    setViewPreference((current) => shiftCalendarView(current, 1));
  }, []);
  const handleToday = useCallback(() => {
    loadedRef.current = null;
    setViewPreference({ mode: "today" });
  }, []);

  // --- Time-blocking state & handlers ---
  const [formOpen, setFormOpen] = useState(false);
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false);
  const [viewingBlock, setViewingBlock] = useState<TimeBlockWithMeta | null>(null);
  const [editingBlock, setEditingBlock] = useState<TimeBlockWithMeta | null>(null);
  const [defaultDate, setDefaultDate] = useState<Date | null>(null);
  const [slotSelection, setSlotSelection] = useState<{
    startDate: Date;
    anchor: CalendarSlotAnchor;
  } | null>(null);
  const [sequenceTemplates, setSequenceTemplates] = useState<SequenceTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [applyingTemplateId, setApplyingTemplateId] = useState<number | null>(null);
  const [slotMenuError, setSlotMenuError] = useState<string | null>(null);
  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<number>>(() => new Set());
  const [selectionAnchorId, setSelectionAnchorId] = useState<number | null>(null);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [batchDeleteBusy, setBatchDeleteBusy] = useState(false);
  const [batchDeleteError, setBatchDeleteError] = useState<string | null>(null);

  const selectedBlocks = useMemo(
    () => data.timeBlocks.filter((block) => selectedBlockIds.has(block.id)),
    [data.timeBlocks, selectedBlockIds],
  );
  const selectedDurationMinutes = useMemo(
    () => selectedBlocks.reduce((total, block) => total + Math.max(
      0,
      Math.round((parseDbDateTime(block.end_time).getTime() - parseDbDateTime(block.start_time).getTime()) / 60000),
    ), 0),
    [selectedBlocks],
  );

  const openTemplates = useCallback(() => setTemplateManagerOpen(true), []);

  useEffect(() => {
    // sidebar controls step 1: Publish only the controls retained for Calendar.
    useCalendarToolbarStore.getState().register({
      rangeStartMs: rangeStart.getTime(),
      rangeEndMs: rangeEnd.getTime(),
      openTemplates,
      showPreviousDay: handlePrev,
      showNextDay: handleNext,
      showToday: handleToday,
    });

    // sidebar controls step 2: Remove route-local callbacks when Calendar exits.
    return () => useCalendarToolbarStore.getState().clear();
  }, [rangeStart.getTime(), rangeEnd.getTime(), openTemplates, handlePrev, handleNext, handleToday]);

  const reload = useCallback(() => {
    loadedRef.current = null;
    setReloadNonce((n) => n + 1);
  }, []);

  // calendar selection step 1: A visible-range change owns a fresh selection;
  // deleted or otherwise missing ids are also removed after each reload.
  useEffect(() => {
    setSelectedBlockIds(new Set());
    setSelectionAnchorId(null);
    setBatchDeleteOpen(false);
  }, [rangeKey]);

  useEffect(() => {
    const visibleIds = new Set(data.timeBlocks.map((block) => block.id));
    setSelectedBlockIds((current) => {
      const next = new Set([...current].filter((id) => visibleIds.has(id)));
      if (next.size === current.size && [...next].every((id) => current.has(id))) return current;
      return next;
    });
  }, [data.timeBlocks]);

  const clearSelection = useCallback(() => {
    setSelectedBlockIds(new Set());
    setSelectionAnchorId(null);
  }, []);

  /** Apply file-manager selection semantics without changing block data. */
  const handleSelectBlock = useCallback((block: TimeBlockWithMeta, mode: CalendarSelectionMode) => {
    // calendar selection step 2: Ctrl+click toggles exactly one block and makes
    // it the next Shift range anchor.
    if (mode === "toggle") {
      setSelectedBlockIds((current) => {
        const next = new Set(current);
        if (next.has(block.id)) next.delete(block.id);
        else next.add(block.id);
        return next;
      });
      setSelectionAnchorId(block.id);
      return;
    }

    // calendar selection step 3: Shift+click replaces the selection with one
    // inclusive chronological interval from the stable anchor.
    const anchorId = selectionAnchorId ?? block.id;
    setSelectedBlockIds(new Set(chronologicalBlockRange(data.timeBlocks, anchorId, block.id)));
    if (selectionAnchorId === null) setSelectionAnchorId(block.id);
  }, [data.timeBlocks, selectionAnchorId]);

  const handleSelectBlocks = useCallback((blockIds: number[]) => {
    // calendar selection step 4: Shift-drag replaces the current selection
    // with every card whose rendered rectangle intersects the marquee.
    setSelectedBlockIds(new Set(blockIds));
    setSelectionAnchorId(blockIds[0] ?? null);
  }, []);

  const openCreate = useCallback((startDate: Date) => {
    setEditingBlock(null);
    setDefaultDate(startDate);
    setFormOpen(true);
  }, []);

  /** Open one insertion chooser at the exact snapped calendar slot. The
   * chooser reads the latest lightweight templates without touching the
   * currently running desktop application or starting a timer. */
  const openSlotMenu = useCallback(
    (startDate: Date, anchor: CalendarSlotAnchor) => {
      // calendar insertion step 1: Record the selected slot immediately so
      // the menu appears after a single click.
      clearSelection();
      setSlotSelection({ startDate, anchor });
      setSlotMenuError(null);
      setTemplatesLoading(true);

      // calendar insertion step 2: Refresh editable templates on every open.
      void getSequenceTemplates()
        .then(setSequenceTemplates)
        .catch((error) => {
          console.error("[Calendar] Failed to load sequence templates:", error);
          setSequenceTemplates([]);
          setSlotMenuError("Templates could not be loaded.");
        })
        .finally(() => setTemplatesLoading(false));
    },
    [clearSelection],
  );

  const createBlockFromSlot = useCallback(() => {
    if (!slotSelection) return;
    const startDate = slotSelection.startDate;
    setSlotSelection(null);
    openCreate(startDate);
  }, [slotSelection, openCreate]);

  const applyTemplateFromSlot = useCallback(
    async (templateId: number) => {
      if (!slotSelection || applyingTemplateId !== null) return;
      setApplyingTemplateId(templateId);
      setSlotMenuError(null);
      try {
        // calendar insertion step 3: Reuse the canonical counted-block service
        // for every item, then reconcile the resulting analytics sessions.
        const result = await applySequenceTemplateAt(
          templateId,
          slotSelection.startDate,
        );
        const unlockedGroups = await Promise.all(
          result.sessionIds.map((sessionId) =>
            reconcileAchievements(sessionId, true).catch((error) => {
              console.error(
                "[Calendar] Failed to reconcile achievements after template insertion:",
                error,
              );
              return [];
            }),
          ),
        );
        useAchievementStore.getState().enqueue(unlockedGroups.flat());
        setSlotSelection(null);
        reload();
      } catch (error) {
        console.error("[Calendar] Failed to insert sequence template:", error);
        setSlotMenuError(
          error instanceof Error ? error.message : "Template insertion failed.",
        );
      } finally {
        setApplyingTemplateId(null);
      }
    },
    [slotSelection, applyingTemplateId, reload],
  );

  const openEdit = useCallback((block: TimeBlockWithMeta) => {
    clearSelection();
    setViewingBlock(null);
    setEditingBlock(block);
    setDefaultDate(null);
    setFormOpen(true);
  }, [clearSelection]);

  const openView = useCallback((block: TimeBlockWithMeta) => {
    clearSelection();
    setViewingBlock(block);
  }, [clearSelection]);

  const handleDelete = useCallback(
    async (block: TimeBlockWithMeta) => {
      await deleteCountedTimeBlock(block);
      setSelectedBlockIds((current) => {
        const next = new Set(current);
        next.delete(block.id);
        return next;
      });
      reload();
    },
    [reload],
  );

  const handleDeleteFromDetails = useCallback(
    async (block: TimeBlockWithMeta) => {
      setViewingBlock(null);
      await handleDelete(block);
    },
    [handleDelete],
  );

  const handleSubmit = useCallback(
    async (input: TimeBlockInput) => {
      // A calendar block is the single source of counted time. It never starts
      // a Pomodoro session; the service keeps its one linked session in sync.
      const committedSessionId = editingBlock
        ? await updateCountedTimeBlock(editingBlock, input)
        : (await createCountedTimeBlock(input)).sessionId;

      const unlocked = await reconcileAchievements(committedSessionId, true).catch((error) => {
        console.error("[Calendar] Failed to reconcile achievements after save:", error);
        return [];
      });
      useAchievementStore.getState().enqueue(unlocked);
      reload();
    },
    [editingBlock, reload],
  );

  const handleMove = useCallback(
    async (block: TimeBlockWithMeta, newStart: Date) => {
      const input = buildMovedTimeBlockInput(block, newStart);
      // Paint the snapped result immediately. The database remains canonical;
      // a failed write rolls back by reloading the week.
      dispatch({ type: "PATCH_BLOCKS", patches: [{
        id: block.id,
        changes: { start_time: input.start_time, end_time: input.end_time },
      }] });
      try {
        await moveCountedTimeBlock(block, newStart);
      } catch (error) {
        reload();
        throw error;
      }
    },
    [reload],
  );

  const handleMoveBlocks = useCallback(
    async (blocks: TimeBlockWithMeta[], deltaMs: number) => {
      const shifted = buildShiftedTimeBlockInputs(blocks, deltaMs);
      dispatch({ type: "PATCH_BLOCKS", patches: shifted.map(({ block, input }) => ({
        id: block.id,
        changes: { start_time: input.start_time, end_time: input.end_time },
      })) });
      try {
        await moveCountedTimeBlocks(blocks, deltaMs);
      } catch (error) {
        reload();
        throw error;
      }
    },
    [reload],
  );

  const handleResize = useCallback(
    async (block: TimeBlockWithMeta, newEnd: Date) => {
      const input = buildResizedTimeBlockInput(block, newEnd);
      dispatch({ type: "PATCH_BLOCKS", patches: [{
        id: block.id,
        changes: { end_time: input.end_time },
      }] });
      try {
        await resizeCountedTimeBlock(block, newEnd);
      } catch (error) {
        reload();
        throw error;
      }
    },
    [reload],
  );

  const confirmBatchDelete = useCallback(async () => {
    if (batchDeleteBusy || selectedBlocks.length === 0) return;
    setBatchDeleteBusy(true);
    setBatchDeleteError(null);
    try {
      // group delete step 1: Delete only the visible selected snapshots and
      // their linked counted sessions through the canonical schedule service.
      await deleteCountedTimeBlocks(selectedBlocks);

      // group delete step 2: Close the confirmation and clear stale ids before
      // reloading the visible week.
      setBatchDeleteOpen(false);
      clearSelection();
      reload();
    } catch (error) {
      console.error("[Calendar] Failed to delete selected blocks:", error);
      setBatchDeleteError(error instanceof Error ? error.message : "Selected blocks could not be deleted.");
    } finally {
      setBatchDeleteBusy(false);
    }
  }, [batchDeleteBusy, selectedBlocks, clearSelection, reload]);

  useEffect(() => {
    /** Ctrl+D is calendar-local batch delete; never intercept typing fields. */
    const handleCalendarShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || Boolean(target?.isContentEditable);
      if (isTyping || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "d") return;
      if (selectedBlocks.length === 0 || formOpen || templateManagerOpen || viewingBlock !== null || slotSelection !== null) return;
      event.preventDefault();
      setBatchDeleteError(null);
      setBatchDeleteOpen(true);
    };
    window.addEventListener("keydown", handleCalendarShortcut);
    return () => window.removeEventListener("keydown", handleCalendarShortcut);
  }, [selectedBlocks.length, formOpen, templateManagerOpen, viewingBlock, slotSelection]);

  useEffect(() => {
    /** Plain arrow keys slide one civil day unless a modal or typing field owns them. */
    const handleDayNavigation = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      const isTyping = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || Boolean(target?.isContentEditable);
      const dialogOpen = formOpen || templateManagerOpen || viewingBlock !== null
        || slotSelection !== null || batchDeleteOpen;
      if (isTyping || dialogOpen) return;

      event.preventDefault();
      if (event.key === "ArrowLeft") handlePrev();
      else handleNext();
    };
    window.addEventListener("keydown", handleDayNavigation);
    return () => window.removeEventListener("keydown", handleDayNavigation);
  }, [formOpen, templateManagerOpen, viewingBlock, slotSelection, batchDeleteOpen, handlePrev, handleNext]);

  if (loadingRef.current && data.sessions.length === 0 && data.timeBlocks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <Loader2 className="size-8 text-sahara-primary animate-spin" />
        <p className="text-xs font-semibold text-sahara-text-muted uppercase tracking-wider">
          Loading calendar…
        </p>
      </div>
    );
  }

  return (
    <div className="px-3 sm:px-5 md:px-6 pt-1 pb-4 max-w-7xl mx-auto h-full min-h-0 flex flex-col">
      {/* Calendar grid: one empty-slot click opens the shared insertion menu. */}
      <div className="flex-1 min-h-0 overflow-auto">
        <CalendarGrid
          sessions={data.sessions}
          timeBlocks={data.timeBlocks}
          weekDays={rangeDays}
          startHour={START_HOUR}
          endHour={END_HOUR}
          onCreateBlock={openSlotMenu}
          onViewBlock={openView}
          onEditBlock={openEdit}
          onDeleteBlock={handleDelete}
          onMoveBlock={handleMove}
          onResizeBlock={handleResize}
          selectedBlockIds={selectedBlockIds}
          onSelectBlock={handleSelectBlock}
          onSelectBlocks={handleSelectBlocks}
          onMoveBlocks={handleMoveBlocks}
        />
      </div>

      {/* Time block form (create / edit) */}
      <TimeBlockForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        block={editingBlock}
        defaultDate={defaultDate}
        onSubmit={handleSubmit}
      />

      <TimeBlockDetailsModal
        block={viewingBlock}
        open={viewingBlock !== null}
        onClose={() => setViewingBlock(null)}
        onEdit={openEdit}
        onDelete={handleDeleteFromDetails}
      />

      <SequenceTemplateManager
        open={templateManagerOpen}
        onClose={() => setTemplateManagerOpen(false)}
      />

      <CalendarSlotMenu
        startDate={slotSelection?.startDate ?? null}
        anchor={slotSelection?.anchor ?? null}
        templates={sequenceTemplates}
        loading={templatesLoading}
        applyingTemplateId={applyingTemplateId}
        error={slotMenuError}
        onCreateBlock={createBlockFromSlot}
        onApplyTemplate={(templateId) => void applyTemplateFromSlot(templateId)}
        onClose={() => {
          if (applyingTemplateId !== null) return;
          setSlotSelection(null);
          setSlotMenuError(null);
        }}
      />

      <CalendarBatchDeleteModal
        open={batchDeleteOpen}
        count={selectedBlocks.length}
        durationMinutes={selectedDurationMinutes}
        busy={batchDeleteBusy}
        error={batchDeleteError}
        onCancel={() => {
          if (batchDeleteBusy) return;
          setBatchDeleteOpen(false);
          setBatchDeleteError(null);
        }}
        onConfirm={() => void confirmBatchDelete()}
      />
    </div>
  );
}
