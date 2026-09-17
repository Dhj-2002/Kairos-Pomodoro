import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, Timer, CheckSquare, BarChart2, BookOpen, LayoutTemplate, ChevronLeft, ChevronRight, Settings, HelpCircle, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useCalendarToolbarStore } from "@/features/schedule/use-calendar-toolbar-store";
import { TodayTagSummary } from "./today-tag-summary";
import { addCalendarDays, toLocalISODate } from "@/features/schedule/calendar-view";

/** Month browsing does not change the selected calendar day until a day is chosen. */
export function CalendarSidebar({ collapsed, hidden, onToggle }: { collapsed: boolean; hidden: boolean; onToggle: () => void }) {
  // 1. Keep month navigation separate from the selected day.
  const controls = useCalendarToolbarStore();
  const navigate = useNavigate();
  const selected = new Date(controls.selectedDateMs || Date.now());
  const [month, setMonth] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1));
  useEffect(() => {
    const d = new Date(controls.selectedDateMs || Date.now());
    setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
  }, [controls.selectedDateMs]);
  if (hidden) return null;
  const offset = (month.getDay() + 6) % 7;
  const first = addCalendarDays(month, -offset);
  const count = offset + new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate() > 35 ? 42 : 35;
  const days = Array.from({ length: count }, (_, i) => addCalendarDays(first, i));
  const todayKey = toLocalISODate(new Date());
  const selectedKey = toLocalISODate(selected);
  const entries = [["Calendar", "/", CalendarDays], ["Timer", "/timer", Timer], ["Tasks", "/tasks", CheckSquare], ["Analytics", "/analytics", BarChart2], ["Journal", "/journal", BookOpen]] as const;
  // 2. All controls call the existing routes or calendar handlers.
  return <aside className={"calendar-sidebar hidden md:flex " + (collapsed ? "is-collapsed" : "")}>
    <div className="calendar-brand" data-tauri-drag-region><CalendarDays /><strong>{!collapsed && "Kairos"}</strong></div>
    <button className="sidebar-collapse" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={onToggle}>{collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}</button>
    <nav aria-label="Main navigation">{entries.map(([label, path, Icon]) => <button key={path} className={path === "/" ? "active" : ""} onClick={() => navigate(path)} title={label}><Icon />{!collapsed && <span>{label}</span>}</button>)}
      <button onClick={controls.openTemplates} title="Templates"><LayoutTemplate />{!collapsed && <span>Templates</span>}</button>
    </nav>
    {!collapsed && <div className="calendar-sidebar-content">
      <section className="mini-month" aria-label="Month navigator">
        <header><strong>{month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</strong><button aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft /></button><button aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight /></button></header>
        <div className="mini-month-grid">{["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i}>{d}</span>)}{days.map(d => {
          const key = toLocalISODate(d);
          return <button key={key} aria-label={d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} aria-current={key === todayKey ? "date" : undefined} aria-pressed={key === selectedKey} className={(d.getMonth() !== month.getMonth() ? "outside " : "") + (key === todayKey ? "today" : key === selectedKey ? "selected" : "")} onClick={() => controls.selectDate(d)}>{d.getDate()}</button>;
        })}</div>
      </section>
      <TodayTagSummary compact isCollapsed={false} selectedDateMs={controls.selectedDateMs || Date.now()} onPreviousDay={controls.showPreviousDay} onNextDay={controls.showNextDay} onToday={controls.showToday} />
    </div>}
    <div className="calendar-sidebar-footer"><button onClick={() => navigate("/onboarding")} title="Help"><HelpCircle />{!collapsed && "Help"}</button><button onClick={() => navigate("/settings")} title="Settings"><Settings />{!collapsed && "Settings"}</button></div>
  </aside>;
}
