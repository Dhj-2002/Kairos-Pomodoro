import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Timer,
  CheckSquare,
  BarChart2,
  Settings,
  Calendar,
  HelpCircle,
  PanelLeftClose,
  PanelLeftOpen,
  BookOpen,
  LayoutTemplate,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useCalendarToolbarStore } from "@/features/schedule/use-calendar-toolbar-store";
import { TodayTagSummary } from "@/components/schedule/today-tag-summary";
import { m } from "framer-motion";

const NAV_ITEMS = [
  { path: "/", label: "Calendar", icon: Calendar },
  { path: "/timer", label: "Timer", icon: Timer },
  { path: "/tasks", label: "Tasks", icon: CheckSquare },
  { path: "/analytics", label: "Analytics", icon: BarChart2 },
  { path: "/journal", label: "Journal", icon: BookOpen },
] as const;

interface SidebarProps {
  isCollapsed: boolean;
  isFullscreenFocus: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({
  isCollapsed,
  isFullscreenFocus,
  onToggleCollapse,
}: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const calendarTools = useCalendarToolbarStore();
  const showCalendarTools = location.pathname === "/" && calendarTools.active;

  const formatDateRange = (startMs: number, endMs: number) => {
    const startDate = new Date(startMs);
    const endDate = new Date(endMs);
    const start = startDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const end = endDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `${start} – ${end}`;
  };

  return (
    <m.aside
      initial={false}
      inert={isFullscreenFocus}
      animate={{
        x: isFullscreenFocus ? -16 : 0,
        opacity: isFullscreenFocus ? 0 : 1,
        width: isFullscreenFocus ? 0 : isCollapsed ? 80 : 256,
      }}
      transition={{
        x: { duration: 0.32, ease: "easeOut" },
        opacity: { duration: 0.2, ease: "easeOut" },
        width: { duration: 0.42, ease: [0.22, 1, 0.36, 1] },
      }}
      className={cn(
        "hidden md:flex shrink-0 overflow-hidden border-r border-sahara-border/30 flex-col py-8 bg-sahara-bg/50 backdrop-blur-sm relative z-10",
      )}
    >
      <Button
        variant="outline"
        size="icon-lg"
        intent="default"
        shape="rounded-full"
        onClick={onToggleCollapse}
        className="absolute -right-3.5 top-5 z-50 size-7 bg-sahara-surface shadow-sm hover:text-sahara-primary hover:border-sahara-primary/40 hover:shadow-md"
      >
        {isCollapsed ? (
          <PanelLeftOpen className="size-3.5" />
        ) : (
          <PanelLeftClose className="size-3.5" />
        )}
      </Button>

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <nav className="px-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Button
                key={item.path}
                variant="nav"
                active={isActive}
                onClick={() => navigate(item.path)}
                title={isCollapsed ? item.label : undefined}
                className={cn(
                  "overflow-hidden justify-start",
                  isCollapsed ? "justify-center p-3" : "gap-4 px-4 py-3",
                  isActive
                    ? ""
                    : "text-sahara-text-secondary hover:bg-sahara-card hover:text-sahara-text",
                )}
              >
                <Icon
                  className={cn(
                    "size-5 shrink-0 transition-colors",
                    isActive
                      ? "text-sahara-primary"
                      : "text-sahara-text-muted group-hover:text-sahara-text-secondary",
                  )}
                />
                {!isCollapsed && (
                  <span className="text-xs tracking-widest font-bold uppercase whitespace-nowrap">
                    {item.label}
                  </span>
                )}
              </Button>
            );
          })}
        </nav>

        {showCalendarTools && (
        <div className={cn(
          "mx-3 mb-5 border-y border-sahara-border/20 py-4",
          isCollapsed ? "space-y-2" : "space-y-3 px-1",
        )}>
          {/* calendar sidebar step 1: Keep the reusable template entry nearby. */}
          <Button
            variant="outline"
            intent="sahara"
            size={isCollapsed ? "icon" : "sm"}
            shape="rounded-full"
            onClick={calendarTools.openTemplates}
            title={isCollapsed ? "Templates" : undefined}
            className={cn("w-full", !isCollapsed && "justify-start gap-3 px-4 text-[10px] font-bold tracking-widest uppercase")}
          >
            <LayoutTemplate className="size-4 shrink-0" />
            {!isCollapsed && <span>Templates</span>}
          </Button>

          {/* calendar sidebar step 2: Slide the visible seven-day range without using
              any vertical space above the calendar grid. */}
          {isCollapsed ? (
            <div className="flex flex-col items-center gap-2">
              <Button variant="ghost" size="icon" intent="default" shape="rounded-full" onClick={calendarTools.showPreviousDay} title="Previous day">
                <ChevronLeft className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" intent="default" shape="rounded-full" onClick={calendarTools.showNextDay} title="Next day">
                <ChevronRight className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" intent="sahara" shape="rounded-full" onClick={calendarTools.showToday} title="Today">
                <Calendar className="size-4" />
              </Button>
            </div>
          ) : (
            <div className="rounded-2xl border border-sahara-border/25 bg-sahara-surface/60 p-2.5">
              <div className="flex items-center justify-between gap-1">
                <Button variant="ghost" size="icon" intent="default" shape="rounded-full" onClick={calendarTools.showPreviousDay} title="Previous day">
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="text-[11px] font-bold tabular-nums text-sahara-text whitespace-nowrap">
                  {formatDateRange(calendarTools.rangeStartMs, calendarTools.rangeEndMs)}
                </span>
                <Button variant="ghost" size="icon" intent="default" shape="rounded-full" onClick={calendarTools.showNextDay} title="Next day">
                  <ChevronRight className="size-4" />
                </Button>
              </div>
              <Button variant="ghost" size="xs" intent="sahara" fullWidth onClick={calendarTools.showToday} className="mt-1 text-[10px] font-bold tracking-widest uppercase">
                Today
              </Button>
            </div>
          )}
        </div>
        )}
      </div>

      <div className="px-3 mb-4 mt-3 shrink-0">
        <TodayTagSummary isCollapsed={isCollapsed} />
      </div>

      <div className="px-3 space-y-1 border-t border-sahara-border/20 pt-3 shrink-0">
        <Button
          variant="nav"
          intent="default"
          onClick={() => navigate("/onboarding")}
          title={isCollapsed ? "HELP" : undefined}
          className={cn(
            "rounded-none justify-start",
            isCollapsed ? "justify-center p-3" : "gap-4 px-4 py-3",
          )}
        >
          <HelpCircle
            className={cn(
              "size-5 shrink-0",
              isCollapsed
                ? "text-sahara-text-muted group-hover:text-sahara-text-secondary"
                : "",
            )}
          />
          {!isCollapsed && (
            <span className="text-xs tracking-widest font-bold">HELP</span>
          )}
        </Button>
        <Button
          variant="nav"
          active={location.pathname === "/settings"}
          onClick={() => navigate("/settings")}
          title={isCollapsed ? "SETTINGS" : undefined}
          className={cn(
            "justify-start",
            isCollapsed ? "justify-center p-3" : "gap-4 px-4 py-3",
            location.pathname === "/settings"
              ? ""
              : "text-sahara-text-muted hover:text-sahara-text-secondary",
          )}
        >
          <Settings
            className={cn(
              "size-5 shrink-0",
              location.pathname === "/settings"
                ? "text-sahara-primary"
                : "text-sahara-text-muted group-hover:text-sahara-text-secondary",
            )}
          />
          {!isCollapsed && (
            <span className="text-xs tracking-widest font-bold">SETTINGS</span>
          )}
        </Button>
      </div>
    </m.aside>
  );
}
