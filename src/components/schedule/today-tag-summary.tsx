import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart2 } from "lucide-react";
import { getCategoryBreakdown, type CategoryBreakdown } from "@/lib/db";
import { formatTotalTime } from "@/lib/session-utils";
import { UNTAGGED_BLOCK_COLOR } from "@/lib/constants";

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
}

/** Sidebar replacement for Start Session: today's completed time by tag. */
export function TodayTagSummary({ isCollapsed }: TodayTagSummaryProps) {
  const [breakdowns, setBreakdowns] = useState<CategoryBreakdown[]>([]);

  const refresh = useCallback(async () => {
    setBreakdowns(await getCategoryBreakdown().catch(() => []));
  }, []);

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
        title={`Today by tag · ${formatTotalTime(totalSeconds)}`}
      >
        <BarChart2 className="size-4" />
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-sahara-border/25 bg-sahara-surface/70 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-sahara-text-muted">
          Today by Tag
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
