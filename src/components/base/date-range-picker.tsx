import { Button } from "@/components/ui/button";
import { type DatePeriod, PERIOD_OPTIONS } from "@/lib/date-range";
import { cn } from "@/lib/cn";

interface DateRangePickerProps {
  value: DatePeriod;
  onChange: (period: DatePeriod) => void;
}

export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  /** Analytics range step 1: Keep all four useful scales visible so changing
   * the primary category view never requires opening a secondary menu. */
  return (
    <div className="flex max-w-full overflow-x-auto rounded-full border border-sahara-border/25 bg-sahara-card/50 p-1">
      {PERIOD_OPTIONS.map((option) => (
        <Button
          key={option.value}
          variant="ghost"
          size="xs"
          shape="rounded-full"
          intent="default"
          active={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "shrink-0 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider",
            option.value === value && "bg-sahara-primary-light text-sahara-primary",
          )}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
