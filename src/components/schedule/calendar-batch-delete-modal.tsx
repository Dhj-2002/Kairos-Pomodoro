import { Trash2 } from "lucide-react";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { Button } from "@/components/ui/button";
import { formatMinutesAsDuration } from "@/lib/session-utils";

interface CalendarBatchDeleteModalProps {
  open: boolean;
  count: number;
  durationMinutes: number;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Confirm Ctrl+D deletion for the current calendar selection. This dialog
 * never decides which blocks are selected and cannot delete on its own. */
export function CalendarBatchDeleteModal({
  open,
  count,
  durationMinutes,
  busy,
  error,
  onCancel,
  onConfirm,
}: CalendarBatchDeleteModalProps) {
  return (
    <ModalOverlay open={open} onClose={() => { if (!busy) onCancel(); }} maxWidth="max-w-sm">
      <div className="p-6">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-500">
            <Trash2 className="size-4" />
          </span>
          <div>
            <h2 className="font-serif text-xl text-sahara-text">Delete selected blocks?</h2>
            <p className="mt-1 text-sm text-sahara-text-secondary">
              {count} block{count === 1 ? "" : "s"} · {formatMinutesAsDuration(durationMinutes)}
            </p>
          </div>
        </div>

        {error && <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600">{error}</p>}

        <div className="mt-6 flex justify-end gap-2 border-t border-sahara-border/20 pt-4">
          <Button variant="ghost" intent="default" size="sm" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="solid" intent="red" size="sm" disabled={busy || count === 0} onClick={onConfirm}>
            {busy ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </div>
    </ModalOverlay>
  );
}
