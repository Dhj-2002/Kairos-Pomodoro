import Database from "@tauri-apps/plugin-sql";
import { getDb } from "./schema";
import type { TimeBlock, TimeBlockWithMeta } from "./types";

export interface TimeBlockInput {
  title: string | null;
  /** Local-naive `yyyy-MM-dd HH:mm:ss` datetime string (matches sessions). */
  start_time: string;
  /** Local-naive `yyyy-MM-dd HH:mm:ss` datetime string (matches sessions). */
  end_time: string;
  task_id?: number | null;
  category_id?: number | null;
  color?: string | null;
  /** Focus session created from this block, so it counts toward stats. */
  session_id?: number | null;
  source_template_id?: number | null;
  source_template_block_id?: number | null;
  notification_enabled?: boolean | number;
  reminded_at?: string | null;
}

/** Throw a friendly error if end is not strictly after start. Shared by block
 *  insert/update and the calendar handler so logged-session creation can
 *  validate before inserting an orphan session. */
export function validateRange(start: string, end: string): void {
  if (new Date(end).getTime() <= new Date(start).getTime()) {
    throw new Error("Invalid time range: end_time must be after start_time");
  }
}

export async function addTimeBlock(
  input: TimeBlockInput,
  database?: Database,
): Promise<number> {
  validateRange(input.start_time, input.end_time);
  const connection = database ?? (await getDb());
  const result = await connection.execute(
    `INSERT INTO time_blocks (
       title, start_time, end_time, task_id, category_id, color, session_id,
       source_template_id, source_template_block_id, notification_enabled, reminded_at,
       sync_id, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, lower(hex(randomblob(16))), CURRENT_TIMESTAMP)`,
    [
      input.title,
      input.start_time,
      input.end_time,
      input.task_id ?? null,
      input.category_id ?? null,
      input.color ?? null,
      input.session_id ?? null,
      input.source_template_id ?? null,
      input.source_template_block_id ?? null,
      input.notification_enabled === undefined
        ? 1
        : Number(Boolean(input.notification_enabled)),
      input.reminded_at ?? null,
    ],
  );
  return result.lastInsertId as number;
}

export async function updateTimeBlock(
  id: number,
  input: Partial<TimeBlockInput>,
  database?: Database,
): Promise<void> {
  const connection = database ?? (await getDb());

  // Validate the resulting range. When only one bound changes, compare against
  // the unchanged bound from the current row so a one-sided edit can't produce
  // an inverted range that only the DB CHECK would catch.
  if (input.start_time !== undefined || input.end_time !== undefined) {
    const current = await getTimeBlock(id, connection);
    if (current) {
      const start = input.start_time ?? current.start_time;
      const end = input.end_time ?? current.end_time;
      validateRange(start, end);
    }
  }
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  let paramIndex = 1;

  if (input.title !== undefined) {
    fields.push(`title = $${paramIndex++}`);
    values.push(input.title);
  }
  if (input.start_time !== undefined) {
    fields.push(`start_time = $${paramIndex++}`);
    values.push(input.start_time);
  }
  if (input.end_time !== undefined) {
    fields.push(`end_time = $${paramIndex++}`);
    values.push(input.end_time);
  }
  if (input.task_id !== undefined) {
    fields.push(`task_id = $${paramIndex++}`);
    values.push(input.task_id);
  }
  if (input.category_id !== undefined) {
    fields.push(`category_id = $${paramIndex++}`);
    values.push(input.category_id);
  }
  if (input.color !== undefined) {
    fields.push(`color = $${paramIndex++}`);
    values.push(input.color);
  }
  if (input.session_id !== undefined) {
    fields.push(`session_id = $${paramIndex++}`);
    values.push(input.session_id);
  }
  if (input.source_template_id !== undefined) {
    fields.push(`source_template_id = $${paramIndex++}`);
    values.push(input.source_template_id);
  }
  if (input.source_template_block_id !== undefined) {
    fields.push(`source_template_block_id = $${paramIndex++}`);
    values.push(input.source_template_block_id);
  }
  if (input.notification_enabled !== undefined) {
    fields.push(`notification_enabled = $${paramIndex++}`);
    values.push(Number(Boolean(input.notification_enabled)));
  }
  if (input.reminded_at !== undefined) {
    fields.push(`reminded_at = $${paramIndex++}`);
    values.push(input.reminded_at);
  }

  // A changed start time is a new reminder schedule. Clear the old delivery
  // marker unless the caller explicitly supplied another marker.
  if (input.start_time !== undefined && input.reminded_at === undefined) {
    fields.push("reminded_at = NULL");
  }

  if (fields.length === 0) return;
  values.push(id);
  fields.push("updated_at = CURRENT_TIMESTAMP", "deleted_at = NULL");
  await connection.execute(
    `UPDATE time_blocks SET ${fields.join(", ")} WHERE id = $${paramIndex}`,
    values,
  );
}

export async function deleteTimeBlock(id: number, database?: Database): Promise<void> {
  const connection = database ?? (await getDb());
  await connection.execute(
    `UPDATE time_blocks SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [id],
  );
}

export async function getTimeBlock(id: number, database?: Database): Promise<TimeBlock | null> {
  const connection = database ?? (await getDb());
  const rows = await connection.select<TimeBlock[]>(
    `SELECT * FROM time_blocks WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return rows.length > 0 ? rows[0] : null;
}

export async function getWeekTimeBlocks(
  weekStart: string,
  weekEnd: string,
): Promise<TimeBlockWithMeta[]> {
  const database = await getDb();
  return database.select<TimeBlockWithMeta[]>(
    `SELECT
      tb.*,
      t.name AS task_name,
      c.name AS category_name,
      c.color AS category_color
    FROM time_blocks tb
    LEFT JOIN tasks t ON tb.task_id = t.id
    LEFT JOIN categories c ON tb.category_id = c.id
    WHERE tb.deleted_at IS NULL
      AND date(tb.start_time) >= $1 AND date(tb.start_time) <= $2
    ORDER BY tb.start_time ASC`,
    [weekStart, weekEnd],
  );
}

export async function markTimeBlockCompleted(
  id: number,
  completed: boolean,
): Promise<void> {
  const database = await getDb();
  await database.execute(`UPDATE time_blocks SET completed = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [
    completed ? 1 : 0,
    id,
  ]);
}

/** Return the most recently-started block that is active at `localNow`. */
export async function getActiveTimeBlock(
  localNow: string,
): Promise<TimeBlockWithMeta | null> {
  const database = await getDb();
  const rows = await database.select<TimeBlockWithMeta[]>(
    `SELECT tb.*, t.name AS task_name, c.name AS category_name,
            c.color AS category_color
     FROM time_blocks tb
     LEFT JOIN tasks t ON tb.task_id = t.id
     LEFT JOIN categories c ON tb.category_id = c.id
     WHERE tb.deleted_at IS NULL AND tb.start_time <= $1 AND tb.end_time > $1
     ORDER BY tb.start_time DESC, tb.id DESC
     LIMIT 1`,
    [localNow],
  );
  return rows[0] ?? null;
}

/** Reminders missed while the app was closed are recovered while the block is
 * still active; completed historical blocks never produce a late alert. */
export async function getDueReminderBlocks(
  localNow: string,
): Promise<TimeBlockWithMeta[]> {
  const database = await getDb();
  return database.select<TimeBlockWithMeta[]>(
    `SELECT tb.*, t.name AS task_name, c.name AS category_name,
            c.color AS category_color
     FROM time_blocks tb
     LEFT JOIN tasks t ON tb.task_id = t.id
     LEFT JOIN categories c ON tb.category_id = c.id
     WHERE tb.deleted_at IS NULL
       AND tb.notification_enabled = 1
       AND tb.reminded_at IS NULL
       AND tb.start_time <= $1
       AND tb.end_time > $1
     ORDER BY tb.start_time ASC, tb.id ASC`,
    [localNow],
  );
}

export async function markTimeBlockReminded(
  id: number,
  expectedStartTime: string,
  remindedAt: string,
): Promise<boolean> {
  const database = await getDb();
  const result = await database.execute(
    `UPDATE time_blocks SET reminded_at = $1
     WHERE id = $2 AND start_time = $3 AND reminded_at IS NULL`,
    [remindedAt, id, expectedStartTime],
  );
  return (result.rowsAffected ?? 0) > 0;
}

export async function getDayTimeBlocks(date: string): Promise<TimeBlockWithMeta[]> {
  return getWeekTimeBlocks(date, date);
}
