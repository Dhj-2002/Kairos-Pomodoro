import { getDb, withSerializedWrite } from "./schema";
import type {
  ScheduleTemplate,
  TemplateBlock,
  TimeBlockWithMeta,
} from "./types";
import { parseDbDateTime } from "@/lib/time";

export interface ScheduleTemplateInput {
  name: string;
  color: string;
  description?: string | null;
}

export interface TemplateBlockInput {
  title?: string | null;
  category_id?: number | null;
  start_minute: number;
  duration_minutes: number;
  notification_enabled?: boolean | number;
  sort_order?: number;
}

function validateTemplateBlock(input: TemplateBlockInput): void {
  if (!Number.isInteger(input.start_minute) || input.start_minute < 0 || input.start_minute >= 1440) {
    throw new Error("Template block start_minute must be between 0 and 1439");
  }
  if (!Number.isInteger(input.duration_minutes) || input.duration_minutes <= 0) {
    throw new Error("Template block duration_minutes must be positive");
  }
}

export async function getScheduleTemplates(): Promise<ScheduleTemplate[]> {
  const database = await getDb();
  return database.select<ScheduleTemplate[]>(
    `SELECT st.*, COUNT(tb.id) AS block_count
     FROM schedule_templates st
     LEFT JOIN template_blocks tb ON tb.template_id = st.id
     GROUP BY st.id
     ORDER BY st.created_at ASC, st.id ASC`,
  );
}

export async function getTemplateBlocks(templateId: number): Promise<TemplateBlock[]> {
  const database = await getDb();
  return database.select<TemplateBlock[]>(
    `SELECT tb.*, c.name AS category_name, c.color AS category_color
     FROM template_blocks tb
     LEFT JOIN categories c ON c.id = tb.category_id
     WHERE tb.template_id = $1
     ORDER BY tb.sort_order ASC, tb.start_minute ASC, tb.id ASC`,
    [templateId],
  );
}

export async function addScheduleTemplate(input: ScheduleTemplateInput): Promise<number> {
  const name = input.name.trim();
  if (!name) throw new Error("Template name is required");
  const database = await getDb();
  const result = await database.execute(
    `INSERT INTO schedule_templates (name, color, description)
     VALUES ($1, $2, $3)`,
    [name, input.color, input.description?.trim() || null],
  );
  return result.lastInsertId as number;
}

export async function updateScheduleTemplate(
  id: number,
  input: Partial<ScheduleTemplateInput>,
): Promise<void> {
  const fields: string[] = [];
  const values: (string | null | number)[] = [];
  let parameter = 1;
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new Error("Template name is required");
    fields.push(`name = $${parameter++}`);
    values.push(name);
  }
  if (input.color !== undefined) {
    fields.push(`color = $${parameter++}`);
    values.push(input.color);
  }
  if (input.description !== undefined) {
    fields.push(`description = $${parameter++}`);
    values.push(input.description?.trim() || null);
  }
  if (fields.length === 0) return;
  fields.push("updated_at = datetime('now', 'localtime')");
  values.push(id);
  const database = await getDb();
  await database.execute(
    `UPDATE schedule_templates SET ${fields.join(", ")} WHERE id = $${parameter}`,
    values,
  );
}

export async function deleteScheduleTemplate(id: number): Promise<void> {
  const database = await getDb();
  // Keep deletion independent of SQLite's connection-level FK setting.
  await withSerializedWrite(async () => {
    await database.execute("DELETE FROM template_blocks WHERE template_id = $1", [id]);
    await database.execute("DELETE FROM schedule_templates WHERE id = $1", [id]);
  });
}

export async function addTemplateBlock(
  templateId: number,
  input: TemplateBlockInput,
): Promise<number> {
  validateTemplateBlock(input);
  const database = await getDb();
  const result = await database.execute(
    `INSERT INTO template_blocks (
       template_id, title, category_id, start_minute, duration_minutes,
       notification_enabled, sort_order
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      templateId,
      input.title?.trim() || null,
      input.category_id ?? null,
      input.start_minute,
      input.duration_minutes,
      input.notification_enabled === undefined ? 1 : Number(Boolean(input.notification_enabled)),
      input.sort_order ?? 0,
    ],
  );
  return result.lastInsertId as number;
}

export async function updateTemplateBlock(
  id: number,
  input: Partial<TemplateBlockInput>,
): Promise<void> {
  const database = await getDb();
  const current = await database.select<TemplateBlock[]>(
    "SELECT * FROM template_blocks WHERE id = $1",
    [id],
  );
  if (!current[0]) return;
  validateTemplateBlock({ ...current[0], ...input });

  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  let parameter = 1;
  for (const [key, value] of Object.entries(input)) {
    if (key === "notification_enabled") {
      fields.push(`notification_enabled = $${parameter++}`);
      values.push(Number(Boolean(value)));
    } else if (["title", "category_id", "start_minute", "duration_minutes", "sort_order"].includes(key)) {
      fields.push(`${key} = $${parameter++}`);
      values.push(key === "title" ? String(value ?? "").trim() || null : (value as number | null));
    }
  }
  if (fields.length === 0) return;
  values.push(id);
  await database.execute(
    `UPDATE template_blocks SET ${fields.join(", ")} WHERE id = $${parameter}`,
    values,
  );
}

export async function deleteTemplateBlock(id: number): Promise<void> {
  const database = await getDb();
  await database.execute("DELETE FROM template_blocks WHERE id = $1", [id]);
}

export async function duplicateScheduleTemplate(id: number): Promise<number> {
  const database = await getDb();
  return withSerializedWrite(async () => {
    const templates = await database.select<ScheduleTemplate[]>(
      "SELECT * FROM schedule_templates WHERE id = $1",
      [id],
    );
    const source = templates[0];
    if (!source) throw new Error("Template not found");
    const result = await database.execute(
      `INSERT INTO schedule_templates (name, color, description)
       VALUES ($1, $2, $3)`,
      [`${source.name} Copy`, source.color, source.description],
    );
    const copyId = result.lastInsertId as number;
    await database.execute(
      `INSERT INTO template_blocks (
         template_id, title, category_id, start_minute, duration_minutes,
         notification_enabled, sort_order
       )
       SELECT $1, title, category_id, start_minute, duration_minutes,
              notification_enabled, sort_order
       FROM template_blocks WHERE template_id = $2`,
      [copyId, id],
    );
    return copyId;
  });
}

export async function isTemplateAppliedOnDate(
  templateId: number,
  date: string,
): Promise<boolean> {
  const database = await getDb();
  const rows = await database.select<{ count: number }[]>(
    `SELECT COUNT(*) AS count FROM time_blocks
     WHERE deleted_at IS NULL AND source_template_id = $1 AND date(start_time) = $2`,
    [templateId, date],
  );
  return (rows[0]?.count ?? 0) > 0;
}

export function timeBlockToTemplateInput(
  block: TimeBlockWithMeta,
  sortOrder: number,
): TemplateBlockInput {
  const start = parseDbDateTime(block.start_time);
  const end = parseDbDateTime(block.end_time);
  return {
    title: block.title,
    category_id: block.category_id,
    start_minute: start.getHours() * 60 + start.getMinutes(),
    duration_minutes: Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000)),
    notification_enabled: block.notification_enabled,
    sort_order: sortOrder,
  };
}
