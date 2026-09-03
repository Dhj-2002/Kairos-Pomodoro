import { Clock3 } from "lucide-react";
import { useScheduleRuntimeStore } from "@/features/schedule/use-schedule-runtime";
import { formatMinutesRemaining } from "@/lib/session-utils";

export function ActiveSchedulePill() {
  const activeBlock = useScheduleRuntimeStore((state) => state.activeBlock);
  const remainingSeconds = useScheduleRuntimeStore((state) => state.remainingSeconds);
  if (!activeBlock || remainingSeconds <= 0) return null;

  const label = activeBlock.title || activeBlock.task_name || activeBlock.category_name || "Scheduled focus";
  const minutes = Math.ceil(remainingSeconds / 60);
  return (
    <div className="pointer-events-none fixed bottom-20 right-4 z-60 flex max-w-[min(340px,calc(100vw-2rem))] items-center gap-3 rounded-2xl border border-sahara-border/30 bg-sahara-surface/95 px-4 py-3 shadow-xl backdrop-blur-md md:bottom-5 md:right-5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sahara-primary-light text-sahara-primary">
        <Clock3 className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold text-sahara-text">{label}</span>
        <span className="block text-[10px] font-bold uppercase tracking-widest text-sahara-primary">{formatMinutesRemaining(minutes)} remaining</span>
      </span>
    </div>
  );
}
