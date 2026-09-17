import { useState, useEffect, useMemo, type ReactNode } from "react";
import { DurationPresets } from "./duration-presets";
import type { DurationPreset } from "@/features/schedule/duration-presets";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { Toast } from "@/components/ui/toast";
import { useCategoriesStore } from "@/features/categories/use-categories-store";
import { useTaskStore } from "@/features/tasks/use-task-store";
import type { TimeBlockWithMeta, TimeBlockInput } from "@/lib/db";
import { DEFAULT_CATEGORY_COLOR, UNTAGGED_BLOCK_COLOR } from "@/lib/constants";
import { CategoryManager } from "@/components/base/category-manager";
import { parseDbDateTime } from "@/lib/time";
import { X, ChevronDown } from "lucide-react";
import { calendarTagColor } from "@/lib/category-colors";
import { calendarEventStyle } from "@/features/schedule/calendar-appearance";
import { formatPresetDuration } from "@/features/schedule/duration-presets";

interface TimeBlockFormProps {
  open: boolean;
  onClose: () => void;
  /** Existing block when editing; null/undefined when creating. */
  block?: TimeBlockWithMeta | null;
  /** Default date for a new block (click-to-create). */
  defaultDate?: Date | null;
  onSubmit: (input: TimeBlockInput) => Promise<void>;
  inspector?: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");
const DEFAULT_FOCUS_MINUTES = 30;

/** Date → `yyyy-MM-ddTHH:mm`, the format `<input type="datetime-local">` uses. */
export function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function addLocalMinutes(value: string, minutes: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  date.setMinutes(date.getMinutes() + minutes);
  return toLocalInput(date);
}

/** One form subtree: dock at wide widths, use the existing modal on narrow screens. */
function FormPresentation({ open, onClose, inspector, children }: {
  open: boolean; onClose: () => void; inspector: boolean; children: ReactNode;
}) {
  // 1. React to resizing without changing the parent form's draft state.
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 1280px)").matches);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1280px)");
    const update = () => setWide(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!open || !inspector || !wide) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [open, inspector, wide, onClose]);
  // 2. Only the presentation changes; save/validation stays in TimeBlockForm.
  if (!open) return null;
  if (inspector && wide) return <aside aria-label="Schedule block editor" className="calendar-inspector w-[320px] shrink-0 min-h-0 flex flex-col border-l border-sahara-border/30 bg-sahara-surface">
    {children}
  </aside>;
  return <ModalOverlay open={open} onClose={onClose} ><div className="calendar-editor">{children}</div></ModalOverlay>;
}

/** Default to a short focus block after a newly selected start time. */
export function getEndAfterStart(start: string): string {
  return addLocalMinutes(start, DEFAULT_FOCUS_MINUTES);
}

/** The native picker should never offer an end equal to the start. */
export function getMinimumEnd(start: string): string {
  return addLocalMinutes(start, 1);
}

/** Validate a schedule range. Future blocks are valid and can trigger alerts. */
export function getTimeRangeError(
  start: string,
  end: string,
  _now = Date.now(),
): string | null {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return "Please enter valid start and end times.";
  }
  if (endDate.getTime() <= startDate.getTime()) {
    return "End time must be after start time.";
  }
  return null;
}

/**
 * Convert a datetime-local value to the **local-naive** `yyyy-MM-dd HH:mm:ss`
 * string the DB stores. This matches how the `sessions` table records time
 * (via `datetime('now','localtime')`): no UTC conversion, no trailing `Z`.
 *
 * Storing local-naive keeps time blocks consistent with every other date in
 * the app (day grouping, the "now" line, SQL `date()` filters). Storing UTC
 * ISO here previously shifted blocks onto the wrong timeline row.
 */
export function fromLocalInput(s: string): string {
  const d = new Date(s);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

export function TimeBlockForm({
  open,
  onClose,
  block,
  defaultDate,
  onSubmit,
  inspector = false,
}: TimeBlockFormProps) {
  const isEdit = !!block;
  const categories = useCategoriesStore((s) => s.categories);
  const loadCategories = useCategoriesStore((s) => s.loadCategories);
  const tasks = useTaskStore((s) => s.tasks);

  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [taskId, setTaskId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [showTagManager, setShowTagManager] = useState(false);
  const [notificationEnabled, setNotificationEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activePreset, setActivePreset] = useState<DurationPreset | null>(null);

  useEffect(() => {
    if (!open) {
      setShowTagManager(false);
      return;
    }
    loadCategories();
    setActivePreset(null);
    setError(null);

    if (block) {
      setTitle(block.title ?? "");
      setStart(toLocalInput(parseDbDateTime(block.start_time)));
      setEnd(toLocalInput(parseDbDateTime(block.end_time)));
      setTaskId(block.task_id ? String(block.task_id) : "");
      setCategoryId(block.category_id ? String(block.category_id) : "");
      setNotificationEnabled(Boolean(block.notification_enabled));
    } else {
      const startD = new Date(defaultDate ?? new Date());
      if (defaultDate) startD.setSeconds(0, 0);
      else startD.setHours(9, 0, 0, 0);
      const endD = new Date(startD);
      endD.setMinutes(endD.getMinutes() + DEFAULT_FOCUS_MINUTES);
      setTitle("");
      setStart(toLocalInput(startD));
      setEnd(toLocalInput(endD));
      setTaskId("");
      setCategoryId("");
      setNotificationEnabled(true);
    }
  }, [open, block, defaultDate, loadCategories]);

  // Active tasks only, but keep the currently-selected task in the list even if
  // it is now completed (so editing an old block doesn't drop its linked task).
  const selectableTasks = useMemo(
    () =>
      tasks.filter(
        (t) => t.completed_pomos < t.estimated_pomos || t.id === Number(taskId),
      ),
    [tasks, taskId],
  );

  const handleSubmit = async () => {
    if (!start || !end) return;
    setError(null);

    const timeRangeError = getTimeRangeError(start, end);
    if (timeRangeError) {
      setError(timeRangeError);
      return;
    }

    setSaving(true);
    try {
      const input: TimeBlockInput = {
        title: title.trim() || null,
        start_time: fromLocalInput(start),
        end_time: fromLocalInput(end),
        task_id: taskId ? Number(taskId) : null,
        category_id: categoryId ? Number(categoryId) : null,
        // A selected tag owns the color. Untagged blocks always discard any
        // legacy per-block RGB value and return to the shared neutral gray.
        color: categoryId ? null : UNTAGGED_BLOCK_COLOR,
        notification_enabled: notificationEnabled,
      };
      await onSubmit(input);
      onClose();
    } catch (submitError) {
      const message = String(
        (submitError as Error)?.message ?? submitError,
      );
      console.error("[TimeBlockForm] Failed to save focus time:", submitError);
      setError(
        /database is locked|SQLITE_BUSY|code:\s*5/i.test(message)
          ? "The database is busy. Please try again in a moment."
          : "Could not save focus time. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleStartChange = (nextStart: string) => {
    setStart(nextStart);
    setError(null);
    if (activePreset && nextStart) {
      setEnd(addLocalMinutes(nextStart, activePreset.minutes));
      return;
    }

    // If the user moves the start past the existing end, keep the form
    // immediately usable by carrying the default focus duration forward.
    if (!nextStart || !end) return;
    const nextStartDate = new Date(nextStart);
    const endDate = new Date(end);
    if (
      !Number.isNaN(nextStartDate.getTime()) &&
      !Number.isNaN(endDate.getTime()) &&
      endDate.getTime() <= nextStartDate.getTime()
    ) {
      setEnd(getEndAfterStart(nextStart));
    }
  };

  const selectedColor = calendarTagColor(categories.find(c => String(c.id) === categoryId)?.color || DEFAULT_CATEGORY_COLOR);
  const durationMinutes = start && end ? Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000) : 0;
  const dayGap = start && end ? Math.round((new Date(end.slice(0,10) + "T12:00").getTime() - new Date(start.slice(0,10) + "T12:00").getTime()) / 86400000) : 0;
  const close = () => { if (!saving && !showTagManager) onClose(); };
  const setDatePart = (value: string, part: "date" | "time", fragment: string) => part === "date" ? fragment + "T" + (value.split("T")[1] || "09:00") : (value.split("T")[0] || toLocalInput(new Date()).slice(0,10)) + "T" + fragment;
  const changeEnd = (value: string) => { setEnd(value); setActivePreset(null); setError(null); };

  return <>
    <FormPresentation open={open} onClose={close} inspector={inspector}>
      <header className="block-editor-header"><h2>{isEdit ? "Edit block" : "New block"}</h2><button type="button" aria-label="Close editor" disabled={saving} onClick={close}><X size={19} /></button></header>
      <div className="block-editor-body">
        <label className="block-field">Title<input aria-label="Block title" type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Deep work on report" /></label>
        <div className="block-tag-field"><label htmlFor="block-tag">Tag</label><div className="tag-select-wrap">
          <i style={{background: categoryId ? selectedColor : UNTAGGED_BLOCK_COLOR}} />
          <select id="block-tag" aria-label="Tag" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
            <option value="">None</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select><ChevronDown size={15} />
        </div></div>
        <button className="manage-tags-link" type="button" onClick={() => setShowTagManager(true)}>Manage tags</button>
        <section className="manual-time" aria-label="Manual time">
          <h3>Manual time</h3>
          {(["Start", "End"] as const).map(label => {
            const value = label === "Start" ? start : end;
            const change = label === "Start" ? handleStartChange : changeEnd;
            return <div className="manual-time-row" key={label}><span>{label === "Start" ? "Starts" : "Ends"}</span>
              <input aria-label={label + " date"} type="date" value={value.slice(0,10)} min={label === "End" ? start.slice(0,10) : undefined} onChange={e => change(setDatePart(value, "date", e.target.value))} />
              <input aria-label={label + " time"} type="time" value={value.split("T")[1] || ""} step="60" onChange={e => change(setDatePart(value, "time", e.target.value))} />
            </div>;
          })}
          <p className="time-duration-summary">{durationMinutes > 0 ? formatPresetDuration(durationMinutes) : "Choose a valid time range"}{dayGap > 0 ? dayGap === 1 ? " · Next day" : " · " + dayGap + " days later" : ""}</p>
        </section>
        {open && <DurationPresets activeId={activePreset?.id ?? null} accentStyle={calendarEventStyle(selectedColor,false)}
          onChange={() => setActivePreset(null)}
          onSelect={preset => { setActivePreset(preset); setEnd(addLocalMinutes(start,preset.minutes)); setError(null); }} />}
        <details className="block-extra-options" open={taskId ? true : undefined}>
          <summary>Task & reminder</summary>
          <label className="reminder-field"><input type="checkbox" checked={notificationEnabled} onChange={e => setNotificationEnabled(e.target.checked)} />Start reminder</label>
          <p>Play a sound and show a desktop notification.</p>
          <label className="block-field">Task<select value={taskId} onChange={e => setTaskId(e.target.value)}>
            <option value="">None</option>{selectableTasks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select></label>
        </details>
      </div>
      {error && <Toast title="Unable to save block" message={error} onClose={() => setError(null)} />}
      <footer className="block-editor-footer"><button type="button" onClick={close} disabled={saving}>Cancel</button><button type="button" onClick={handleSubmit} disabled={saving || !start || !end}>{saving ? "Saving…" : isEdit ? "Save changes" : "Create block"}</button></footer>
    </FormPresentation>
    <CategoryManager open={showTagManager} onClose={() => setShowTagManager(false)} onSelect={category => setCategoryId(String(category.id))} />
  </>;
}
