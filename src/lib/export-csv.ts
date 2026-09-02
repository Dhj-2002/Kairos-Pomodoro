import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { getCategoryAnalytics } from "@/lib/db";
import { getDateRange, type DatePeriod } from "@/lib/date-range";
import { isTauri } from "@/lib/tauri";

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.split('"').join('""')}"` : text;
}

/** Export the selected month/year/range as a spreadsheet-friendly category
 * summary. Hours are decimal so totals can be graphed without parsing text. */
export async function exportAnalyticsCsv(period: DatePeriod): Promise<boolean> {
  if (!isTauri()) return false;
  const range = getDateRange(period);
  const rows = await getCategoryAnalytics(range.startDate, range.endDate);
  const lines = [
    ["Period", "Start Date", "End Date", "Category", "Total Hours", "Sessions", "Active Days", "Share (%)"],
    ...rows.map((row) => [
      range.label,
      range.startDate,
      range.endDate,
      row.category_name,
      (row.total_focus_seconds / 3600).toFixed(2),
      row.session_count,
      row.active_days,
      row.percentage_of_focus,
    ]),
  ];
  const path = await save({
    defaultPath: `kairos-${period}-${range.endDate}.csv`,
    filters: [{ name: "CSV", extensions: ["csv"] }],
    title: "Export focus statistics",
  });
  if (!path) return false;
  const csv = `\uFEFF${lines.map((line) => line.map(csvCell).join(",")).join("\r\n")}`;
  await writeFile(path, new TextEncoder().encode(csv));
  return true;
}
