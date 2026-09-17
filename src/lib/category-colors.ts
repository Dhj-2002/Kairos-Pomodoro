/** Shared bright calendar palette; legacy swatches remain selectable. */
export const CATEGORY_PRESET_COLORS = [
  "#55B7FA", "#65C65A", "#FF69AC", "#FFCC49", "#AA8AE8", "#FF9560", "#9AA1AE",
  "#C17767", "#8B9E6B", "#4A7C59", "#5B8FA3", "#9B7EBD", "#D4A574",
  "#E07A5F", "#81B29A", "#F2CC8F", "#E76F51",
] as const;
/** New tags choose from the bright palette; no data migration. */
export function generateCategoryColor(): string {
  return CATEGORY_PRESET_COLORS[Math.floor(Math.random() * 7)].toLowerCase();
}
/** Display aliases brighten the old bundled palette, never arbitrary custom colors. */
export function calendarTagColor(color: string): string {
  const legacy: Record<string, string> = {
    "#c17767": "#FF69AC", "#8b9e6b": "#65C65A", "#4a7c59": "#65C65A",
    "#5b8fa3": "#55B7FA", "#9b7ebd": "#FF69AC", "#d4a574": "#FFCC49",
    "#e07a5f": "#FF9560", "#81b29a": "#65C65A", "#f2cc8f": "#FFCC49",
    "#e76f51": "#FF9560",
  };
  return legacy[color.toLowerCase()] ?? color;
}
