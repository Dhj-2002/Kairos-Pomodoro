import { CalendarDays, List, Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

/** Calendar navigation uses the real centered seven-day range, not mock view tabs. */
export function CalendarToolbar({ date, onCreate, onToday, onPrevious, onNext }: {
  date: Date; onCreate: () => void; onToday: () => void; onPrevious: () => void; onNext: () => void;
}) {
  const navigate = useNavigate();
  return <header className="calendar-toolbar">
    <div className="calendar-toolbar-actions"><div>
      <button aria-label="Return to today" onClick={onToday}><CalendarDays /></button>
      <button aria-label="Open tasks" onClick={() => navigate("/tasks")}><List /></button>
      <button aria-label="New block" onClick={onCreate}><Plus /></button>
    </div><span className="calendar-view-label">Week</span><div className="calendar-toolbar-navigation">
      <button aria-label="Previous day" onClick={onPrevious}><ChevronLeft /></button><button aria-label="Next day" onClick={onNext}><ChevronRight /></button>
    </div></div>
    <div className="calendar-month-heading"><h1><strong>{date.toLocaleDateString("en-US", { month: "long" })}</strong> {date.getFullYear()}</h1><button onClick={onToday}>Today</button></div>
  </header>;
}
