import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart2, Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { getCategoryBreakdown, type CategoryBreakdown } from "@/lib/db";
import { formatTotalTime } from "@/lib/session-utils";
import { UNTAGGED_BLOCK_COLOR } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { toLocalISODate } from "@/features/schedule/calendar-view";

export interface TodayTagRow {
  id: number | null;
  name: string;
  color: string;
  seconds: number;
  percentage: number;
}

/** Convert today's canonical analytics rows into compact sidebar progress rows. */
export function buildTodayTagRows(breakdowns: CategoryBreakdown[]): TodayTagRow[] {
  // today tag summary step 1: Keep the same total and ordering as Analytics.
  const totalSeconds = breakdowns.reduce((sum, item) => sum + item.total_seconds, 0);

  // today tag summary step 2: Give untagged time an explicit neutral identity.
  return breakdowns.map((item) => ({
    id: item.category_id,
    name: item.category_name ?? "Uncategorized",
    color: item.category_color ?? UNTAGGED_BLOCK_COLOR,
    seconds: item.total_seconds,
    percentage: totalSeconds > 0 ? (item.total_seconds / totalSeconds) * 100 : 0,
  }));
}

interface TodayTagSummaryProps {
  isCollapsed: boolean;
  selectedDateMs: number;
  onPreviousDay: () => void;
  onNextDay: () => void;
  onToday: () => void;
}

/** One date navigator and completed-time distribution for its selected day. */
export function TodayTagSummary({
  isCollapsed,
  selectedDateMs,
  onPreviousDay,
  onNextDay,
  onToday,
}: TodayTagSummaryProps) {
  const [breakdowns, setBreakdowns] = useState<CategoryBreakdown[]>([]);
  const selectedDate = useMemo(() => new Date(selectedDateMs), [selectedDateMs]);
  const selectedDateKey = toLocalISODate(selectedDate);
  const todayKey = toLocalISODate(new Date());
  const isToday = selectedDateKey === todayKey;
  const dateLabel = isToday
    ? "Today"
    : selectedDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  const refresh = useCallback(async () => {
    setBreakdowns(await getCategoryBreakdown(selectedDateKey, selectedDateKey).catch(() => []));
  }, [selectedDateKey]);

  useEffect(() => {
    // today tag summary step 1: Load immediately when the sidebar mounts.
    void refresh();

    // today tag summary step 2: Keep the sidebar current after calendar/timer writes.
    const interval = window.setInterval(refresh, 10_000);
    const handleFocus = () => void refresh();
    window.addEventListener("focus", handleFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
    };
  }, [refresh]);

  const rows = useMemo(() => buildTodayTagRows(breakdowns), [breakdowns]);
  const totalSeconds = rows.reduce((sum, item) => sum + item.seconds, 0);

  if (isCollapsed) {
    return (
      <div
        className="mx-auto flex size-11 items-center justify-center rounded-2xl border border-sahara-border/25 bg-sahara-surface/70 text-sahara-text-muted"
        title={`${dateLabel} by tag · ${formatTotalTime(totalSeconds)}`}
      >
        <div className="flex flex-col items-center gap-1">
          <Button variant="ghost" size="icon" intent="default" shape="rounded-full" onClick={onPreviousDay} title="Previous day">
            <ChevronLeft className="size-3.5" />
          </Button>
          <BarChart2 className="size-4" />
          <Button variant="ghost" size="icon" intent="default" shape="rounded-full" onClick={onNextDay} title="Next day">
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-sahara-border/25 bg-sahara-surface/70 p-3">
      <div className="mb-3 flex items-center justify-between gap-1 border-b border-sahara-border/20 pb-2">
        <Button variant="ghost" size="icon" intent="default" shape="rounded-full" onClick={onPreviousDay} title="Previous day">
          <ChevronLeft className="size-4" />
        </Button>
        <button
          type="button"
          onClick={onToday}
          className="min-w-0 flex-1 truncate text-center text-[11px] font-bold uppercase tracking-widest text-sahara-text hover:text-sahara-primary"
          title={isToday ? "Today" : "Return to today"}
        >
          {dateLabel}
        </button>
        <Button variant="ghost" size="icon" intent="default" shape="rounded-full" onClick={onNextDay} title="Next day">
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-sahara-text-muted">
          <span className="inline-flex items-center gap-1.5"><Calendar className="size-3" />By Tag</span>
        </span>
        <span className="text-[10px] font-semibold tabular-nums text-sahara-text-secondary">
          {formatTotalTime(totalSeconds)}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="py-2 text-[10px] leading-relaxed text-sahara-text-muted">
          No tagged time today.
        </p>
      ) : (
        <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
          {rows.map((row) => (
            <div key={row.id ?? "uncategorized"}>
              <div className="mb-1 flex items-center gap-1.5 text-[10px]">
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
                <span className="min-w-0 flex-1 truncate font-semibold text-sahara-text" title={row.name}>
                  {row.name}
                </span>
                <span className="shrink-0 tabular-nums text-sahara-text-muted">
                  {formatTotalTime(row.seconds)} · {Math.round(row.percentage)}%
                </span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-sahara-border/25">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${row.percentage}%`, backgroundColor: row.color }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
