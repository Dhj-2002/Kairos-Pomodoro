export interface Session {
  id: number;
  task_id: number | null;
  task_name?: string | null;
  phase: string;
  started_at: string;
  ended_at: string | null;
  duration_sec: number;
  completed: number;
  category_id: number | null;
  category_name?: string | null;
  category_color?: string | null;
  intention: string | null;
  mood: string | null;
  notes: string | null;
}

export interface Category {
  id: number;
  name: string;
  color: string;
  created_at: string;
}

export interface CategoryBreakdown {
  category_id: number | null;
  intention: string | null;
  category_name: string | null;
  category_color: string | null;
  total_seconds: number;
  session_count: number;
}

export interface CategoryAnalytics {
  category_id: number | null;
  category_name: string;
  category_color: string;
  total_focus_seconds: number;
  session_count: number;
  avg_session_seconds: number;
  active_days: number;
  daily_avg_seconds: number;
  percentage_of_focus: number;
}

export interface DayData {
  date: string;
  day_name: string;
  total_seconds: number;
  session_count: number;
}

export interface WeekSession {
  id: number;
  task_id: number | null;
  task_name: string | null;
  phase: string;
  started_at: string;
  duration_sec: number;
  completed: number;
  category_id: number | null;
  category_name: string | null;
  category_color: string | null;
  intention: string | null;
  mood: string | null;
  notes: string | null;
}

export interface WeekSummary {
  total_seconds: number;
  total_sessions: number;
  work_sessions: number;
  break_sessions: number;
  avg_daily_seconds: number;
  peak_day: string | null;
  peak_day_seconds: number;
}

export interface MoodStat {
  mood: string;
  count: number;
}

export interface SessionNoteEntry {
  id: number;
  started_at: string;
  ended_at: string | null;
  duration_sec: number;
  mood: string | null;
  notes: string | null;
  category_name: string | null;
  category_color: string | null;
  task_name: string | null;
}

export interface CompletedTaskEntry {
  task_id: number;
  task_name: string;
  category_name: string | null;
  category_color: string | null;
  total_seconds: number;
  session_count: number;
  completed_pomos: number;
  estimated_pomos: number;
}

/** A planned focus block on the calendar (time-blocking). */
export interface TimeBlock {
  id: number;
  title: string | null;
  start_time: string;
  end_time: string;
  task_id: number | null;
  category_id: number | null;
  color: string | null;
  completed: number;
  created_at: string;
  /** The focus session logged from this block, so it counts toward stats. */
  session_id: number | null;
  source_template_id: number | null;
  source_template_block_id: number | null;
  notification_enabled: number;
  reminded_at: string | null;
  /** Added by schema v9; optional keeps fixtures and pre-migration rows compatible. */
  sync_id?: string;
  updated_at?: string;
  deleted_at?: string | null;
  device_id?: string | null;
}

/** A reusable schedule. Applying it creates independent TimeBlock snapshots. */
export interface ScheduleTemplate {
  id: number;
  name: string;
  color: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  block_count?: number;
}

export interface TemplateBlock {
  id: number;
  template_id: number;
  title: string | null;
  category_id: number | null;
  category_name?: string | null;
  category_color?: string | null;
  start_minute: number;
  duration_minutes: number;
  notification_enabled: number;
  sort_order: number;
}

/** A reusable duration button whose optional tag owns its visible color. */
export interface QuickBlock {
  id: number;
  name: string;
  duration_minutes: number;
  color: string;
  category_id: number | null;
  category_name?: string | null;
  category_color?: string | null;
  notification_enabled: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/** A reusable ordered block sequence with no absolute date or start time. */
export interface SequenceTemplate {
  id: number;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
  item_count?: number;
  total_minutes?: number;
}

/** A stable sequence snapshot; tag changes may be explicitly synchronized
 * from its linked quick block without changing duration or ordering. */
export interface SequenceTemplateItem {
  id: number;
  template_id: number;
  quick_block_id: number | null;
  title: string;
  duration_minutes: number;
  color: string;
  category_id: number | null;
  category_name?: string | null;
  category_color?: string | null;
  notification_enabled: number;
  sort_order: number;
}

/** A TimeBlock joined with its optional task/category for display. */
export interface TimeBlockWithMeta extends TimeBlock {
  task_name: string | null;
  category_name: string | null;
  category_color: string | null;
}

/** A free-form journal entry tied to a calendar day. */
export interface JournalEntry {
  id: number;
  date: string;
  content: string;
  created_at: string;
  updated_at: string;
}
