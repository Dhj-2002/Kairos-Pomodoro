import { useState, useEffect, useMemo } from "react";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { Button } from "@/components/ui/button";
import { Toast } from "@/components/ui/toast";
import { useCategoriesStore } from "@/features/categories/use-categories-store";
import { useTaskStore } from "@/features/tasks/use-task-store";
import type { TimeBlockWithMeta, TimeBlockInput } from "@/lib/db";
import { DEFAULT_CATEGORY_COLOR, UNTAGGED_BLOCK_COLOR } from "@/lib/constants";
import { CategoryManager } from "@/components/base/category-manager";
import { parseDbDateTime } from "@/lib/time";

interface TimeBlockFormProps {
  open: boolean;
  onClose: () => void;
  /** Existing block when editing; null/undefined when creating. */
  block?: TimeBlockWithMeta | null;
  /** Default date for a new block (click-to-create). */
  defaultDate?: Date | null;
  onSubmit: (input: TimeBlockInput) => Promise<void>;
}

const pad = (n: number) => String(n).padStart(2, "0");
const DEFAULT_FOCUS_MINUTES = 30;

/** Date → `yyyy-MM-ddTHH:mm`, the format `<input type="datetime-local">` uses. */
export function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function addLocalMinutes(value: string, minutes: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  date.setMinutes(date.getMinutes() + minutes);
  return toLocalInput(date);
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

  useEffect(() => {
    if (!open) {
      setShowTagManager(false);
      return;
    }
    loadCategories();

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

  return (
    <>
      <ModalOverlay open={open} onClose={onClose} showCloseButton>
      <div className="px-6 py-5 border-b border-sahara-border/20">
        <h2 className="font-serif text-xl text-sahara-text">
          {isEdit ? "Edit Schedule Block" : "Add Schedule Block"}
        </h2>
        <p className="text-xs text-sahara-text-muted mt-1">
          Schedule focus time. Delete it later if it was not completed.
        </p>
      </div>

      <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
        {/* Title */}
        <div>
          <label className="text-[10px] font-bold text-sahara-text-muted uppercase tracking-widest">
            Title (optional)
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Deep work on report"
            className="w-full mt-2 px-4 py-3 bg-sahara-bg/40 border border-sahara-border/20 rounded-xl text-sm text-sahara-text placeholder:text-sahara-text-muted/50 focus:outline-none focus:border-sahara-primary/50 focus:ring-2 focus:ring-sahara-primary/10 transition-all"
          />
        </div>

        {/* Time range */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-bold text-sahara-text-muted uppercase tracking-widest">
              Start
            </label>
            <input
              type="datetime-local"
              value={start}
              onChange={(e) => handleStartChange(e.target.value)}
              className="w-full mt-2 px-4 py-3 rounded-xl border border-sahara-border/30 bg-sahara-bg/40 text-sm font-medium text-sahara-text focus:outline-none focus:border-sahara-primary/50 focus:ring-2 focus:ring-sahara-primary/10 transition-all"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-sahara-text-muted uppercase tracking-widest">
              End
            </label>
            <input
              type="datetime-local"
              value={end}
              min={start ? getMinimumEnd(start) : undefined}
              onChange={(e) => {
                setEnd(e.target.value);
                setError(null);
              }}
              className="w-full mt-2 px-4 py-3 rounded-xl border border-sahara-border/30 bg-sahara-bg/40 text-sm font-medium text-sahara-text focus:outline-none focus:border-sahara-primary/50 focus:ring-2 focus:ring-sahara-primary/10 transition-all"
            />
          </div>
        </div>

        <label className="flex items-center justify-between gap-4 rounded-xl border border-sahara-border/20 bg-sahara-bg/30 px-4 py-3">
          <span>
            <span className="block text-xs font-semibold text-sahara-text">Start reminder</span>
            <span className="block text-[10px] text-sahara-text-muted">Play a sound and show a Windows notification.</span>
          </span>
          <input
            type="checkbox"
            checked={notificationEnabled}
            onChange={(event) => setNotificationEnabled(event.target.checked)}
            className="size-4 accent-sahara-primary"
          />
        </label>

        {/* Task link */}
        {selectableTasks.length > 0 && (
          <div>
            <label className="text-[10px] font-bold text-sahara-text-muted uppercase tracking-widest">
              Task (optional)
            </label>
            <select
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
              className="w-full mt-2 px-4 py-3 bg-sahara-bg/40 border border-sahara-border/20 rounded-xl text-sm text-sahara-text focus:outline-none focus:border-sahara-primary/50 focus:ring-2 focus:ring-sahara-primary/10 transition-all appearance-none cursor-pointer"
            >
              <option value="">None</option>
              {selectableTasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Tag */}
        <div>
          <div className="flex items-center justify-between gap-3">
            <label className="text-[10px] font-bold text-sahara-text-muted uppercase tracking-widest">
              Tag (optional)
            </label>
            <button
              type="button"
              onClick={() => setShowTagManager(true)}
              className="text-[10px] font-bold uppercase tracking-wider text-sahara-primary hover:underline"
            >
              Manage tags
            </button>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            <button
              type="button"
              onClick={() => setCategoryId("")}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-all ${
                categoryId === ""
                  ? "border-sahara-primary bg-sahara-primary-light"
                  : "border-sahara-border/30 text-sahara-text-muted hover:border-sahara-primary/30"
              }`}
            >
              None
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategoryId(String(c.id))}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-all ${
                  categoryId === String(c.id)
                    ? "border-sahara-primary bg-sahara-primary-light"
                    : "border-sahara-border/30 text-sahara-text-muted hover:border-sahara-primary/30"
                }`}
              >
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: c.color || DEFAULT_CATEGORY_COLOR }}
                />
                {c.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <Toast
          title="Unable to log focus time"
          message={error}
          onClose={() => setError(null)}
        />
      )}

      <div className="px-6 py-4 border-t border-sahara-border/20 flex justify-end gap-2">
        <Button
          variant="ghost"
          intent="default"
          size="sm"
          onClick={onClose}
          className="text-[11px]"
        >
          Cancel
        </Button>
        <Button
          variant="solid"
          intent="sahara"
          size="sm"
          onClick={handleSubmit}
          disabled={saving || !start || !end}
          className="text-[11px]"
        >
          {saving ? "Saving…" : isEdit ? "Save Changes" : "Add Block"}
        </Button>
      </div>
      </ModalOverlay>
      <CategoryManager
        open={showTagManager}
        onClose={() => setShowTagManager(false)}
        onSelect={(category) => setCategoryId(String(category.id))}
      />
    </>
  );
}
