import { useEffect } from "react";
import { CalendarPlus, LayoutTemplate, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMinutesAsDuration } from "@/lib/session-utils";
import type { SequenceTemplate } from "@/lib/db";

interface CalendarSlotMenuProps {
  startDate: Date | null;
  anchor: { x: number; y: number } | null;
  templates: SequenceTemplate[];
  loading: boolean;
  applyingTemplateId: number | null;
  error: string | null;
  onCreateBlock: () => void;
  onApplyTemplate: (templateId: number) => void;
  onClose: () => void;
}

function formatSlot(date: Date): string {
  return date.toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Lightweight chooser opened by one empty calendar click. It chooses either
 * the existing 30-minute form or one saved relative sequence; it never edits
 * templates and never starts a Pomodoro timer. */
export function CalendarSlotMenu({
  startDate,
  anchor,
  templates,
  loading,
  applyingTemplateId,
  error,
  onCreateBlock,
  onApplyTemplate,
  onClose,
}: CalendarSlotMenuProps) {
  useEffect(() => {
    if (!startDate) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [startDate, onClose]);

  if (!startDate || !anchor) return null;

  // slot menu step 1: Keep the chooser inside the current viewport even when
  // the clicked slot is close to the right or bottom edge.
  const width = 288;
  const estimatedHeight = Math.min(420, 150 + templates.length * 62);
  const left = Math.max(12, Math.min(anchor.x + 8, window.innerWidth - width - 12));
  const top = Math.max(12, Math.min(anchor.y + 8, window.innerHeight - estimatedHeight - 12));

  return (
    <div className="fixed inset-0 z-[90]" role="presentation">
      <button
        type="button"
        aria-label="Close calendar insertion menu"
        className="absolute inset-0 cursor-default bg-transparent"
        onClick={onClose}
      />

      <section
        role="dialog"
        aria-label="Insert calendar item"
        className="fixed z-[91] w-72 overflow-hidden rounded-2xl border border-sahara-border/30 bg-sahara-surface shadow-2xl"
        style={{ left, top }}
        onClick={(event) => event.stopPropagation()}
      >
        {/* slot menu step 2: Show the snapped insertion point and retain the
            existing single-block creation path as the first action. */}
        <header className="flex items-start justify-between border-b border-sahara-border/20 px-4 py-3">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-sahara-text-muted">
              Insert at
            </p>
            <p className="mt-1 text-xs font-semibold text-sahara-text">
              {formatSlot(startDate)}
            </p>
          </div>
          <Button variant="ghost" size="icon" intent="default" onClick={onClose}>
            <X className="size-3.5" />
          </Button>
        </header>

        <div className="max-h-80 overflow-y-auto p-2">
          <button
            type="button"
            onClick={onCreateBlock}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-sahara-card"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sahara-primary/10 text-sahara-primary">
              <CalendarPlus className="size-4" />
            </span>
            <span>
              <span className="block text-xs font-bold text-sahara-text">New 30-minute block</span>
              <span className="mt-0.5 block text-[10px] text-sahara-text-muted">Open the existing block editor</span>
            </span>
          </button>

          <div className="my-2 border-t border-sahara-border/20" />
          <p className="px-3 pb-1 pt-1 text-[9px] font-bold uppercase tracking-[0.18em] text-sahara-text-muted">
            Templates
          </p>

          {/* slot menu step 3: One selection inserts the complete saved order. */}
          {loading ? (
            <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-sahara-text-muted">
              <Loader2 className="size-4 animate-spin" /> Loading templates…
            </div>
          ) : templates.length === 0 ? (
            <p className="px-3 py-5 text-center text-xs text-sahara-text-muted">No saved templates yet.</p>
          ) : (
            templates.map((template) => {
              const empty = (template.item_count ?? 0) === 0;
              const applying = applyingTemplateId === template.id;
              return (
                <button
                  key={template.id}
                  type="button"
                  disabled={empty || applyingTemplateId !== null}
                  onClick={() => onApplyTemplate(template.id)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-sahara-card disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-xl text-white"
                    style={{ backgroundColor: template.color }}
                  >
                    {applying ? <Loader2 className="size-4 animate-spin" /> : <LayoutTemplate className="size-4" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-bold text-sahara-text">{template.name}</span>
                    <span className="mt-0.5 block text-[10px] text-sahara-text-muted">
                      {template.item_count ?? 0} blocks · {formatMinutesAsDuration(template.total_minutes ?? 0)}
                    </span>
                  </span>
                </button>
              );
            })
          )}

          {error && (
            <p className="mx-3 mt-2 rounded-lg bg-red-50 px-3 py-2 text-[10px] text-red-600">{error}</p>
          )}
        </div>
      </section>
    </div>
  );
}
