import { getDb, withSerializedWrite } from "./schema";
import type { QuickBlock, SequenceTemplate, SequenceTemplateItem } from "./types";
import { DEFAULT_CATEGORY_COLOR } from "@/lib/constants";

export interface QuickBlockInput {
  name: string;
  duration_minutes: number;
  /** Retained only for backward-compatible storage; the selected tag owns display color. */
  color?: string;
  category_id?: number | null;
  notification_enabled?: boolean | number;
  sort_order?: number;
}

export interface SequenceTemplateInput {
  name: string;
  color: string;
}

function validateName(name: string, label: string): string {
  const value = name.trim();
  if (!value) throw new Error(`${label} name is required`);
  return value;
}

function validateDuration(duration: number): void {
  if (!Number.isInteger(duration) || duration <= 0 || duration > 1440) {
    throw new Error("Block duration must be an integer between 1 and 1440 minutes");
  }
}

/** Load the persistent palette in its user-defined display order. */
export async function getQuickBlocks(): Promise<QuickBlock[]> {
  const database = await getDb();
  return database.select<QuickBlock[]>(
    `SELECT qb.*, c.name AS category_name, c.color AS category_color
     FROM quick_blocks qb
     LEFT JOIN categories c ON c.id = qb.category_id
     ORDER BY qb.sort_order ASC, qb.id ASC`,
  );
}

export async function addQuickBlock(input: QuickBlockInput): Promise<number> {
  const name = validateName(input.name, "Quick block");
  validateDuration(input.duration_minutes);
  const database = await getDb();
  const nextOrder = input.sort_order ?? Number((await database.select<{ value: number }[]>(
    "SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM quick_blocks",
  ))[0]?.value ?? 0);
  const result = await database.execute(
    `INSERT INTO quick_blocks (
       name, duration_minutes, color, category_id, notification_enabled, sort_order
     ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [name, input.duration_minutes, input.color ?? DEFAULT_CATEGORY_COLOR, input.category_id ?? null, Number(input.notification_enabled ?? true), nextOrder],
  );
  return result.lastInsertId as number;
}

export async function updateQuickBlock(id: number, input: QuickBlockInput): Promise<void> {
  const name = validateName(input.name, "Quick block");
  validateDuration(input.duration_minutes);
  const database = await getDb();
  await withSerializedWrite(async () => {
    // tag sync step 1: Update the reusable palette definition.
    await database.execute(
      `UPDATE quick_blocks
       SET name = $1, duration_minutes = $2, color = $3, category_id = $4,
           notification_enabled = $5, updated_at = datetime('now', 'localtime')
       WHERE id = $6`,
      [name, input.duration_minutes, input.color ?? DEFAULT_CATEGORY_COLOR, input.category_id ?? null, Number(input.notification_enabled ?? true), id],
    );

    // template reference sync step 2: Existing template references adopt the
    // reusable block's latest name and tag. Already-created calendar blocks
    // are independent snapshots and are deliberately not touched here.
    await database.execute(
      "UPDATE sequence_template_items SET title = $1, category_id = $2 WHERE quick_block_id = $3",
      [name, input.category_id ?? null, id],
    );
  });
}

/** Delete only the palette entry. Existing sequence snapshots remain intact. */
export async function deleteQuickBlock(id: number): Promise<void> {
  const database = await getDb();
  await withSerializedWrite(async () => {
    await database.execute(
      "UPDATE sequence_template_items SET quick_block_id = NULL WHERE quick_block_id = $1",
      [id],
    );
    await database.execute("DELETE FROM quick_blocks WHERE id = $1", [id]);
  });
}

export async function getSequenceTemplates(): Promise<SequenceTemplate[]> {
  const database = await getDb();
  return database.select<SequenceTemplate[]>(
    `SELECT st.*, COUNT(si.id) AS item_count,
            COALESCE(SUM(si.duration_minutes), 0) AS total_minutes
     FROM sequence_templates st
     LEFT JOIN sequence_template_items si ON si.template_id = st.id
     GROUP BY st.id
     ORDER BY st.created_at ASC, st.id ASC`,
  );
}

export async function getSequenceTemplateItems(templateId: number): Promise<SequenceTemplateItem[]> {
  const database = await getDb();
  return database.select<SequenceTemplateItem[]>(
    `SELECT si.*, c.name AS category_name, c.color AS category_color
     FROM sequence_template_items si
     LEFT JOIN categories c ON c.id = si.category_id
     WHERE si.template_id = $1
     ORDER BY si.sort_order ASC, si.id ASC`,
    [templateId],
  );
}

export async function addSequenceTemplate(input: SequenceTemplateInput): Promise<number> {
  const name = validateName(input.name, "Template");
  const database = await getDb();
  const result = await database.execute(
    "INSERT INTO sequence_templates (name, color) VALUES ($1, $2)",
    [name, input.color],
  );
  return result.lastInsertId as number;
}

export async function updateSequenceTemplate(id: number, input: SequenceTemplateInput): Promise<void> {
  const name = validateName(input.name, "Template");
  const database = await getDb();
  await database.execute(
    `UPDATE sequence_templates
     SET name = $1, color = $2, updated_at = datetime('now', 'localtime')
     WHERE id = $3`,
    [name, input.color, id],
  );
}

export async function deleteSequenceTemplate(id: number): Promise<void> {
  const database = await getDb();
  await withSerializedWrite(async () => {
    await database.execute("DELETE FROM sequence_template_items WHERE template_id = $1", [id]);
    await database.execute("DELETE FROM sequence_templates WHERE id = $1", [id]);
  });
}

export async function duplicateSequenceTemplate(id: number): Promise<number> {
  const database = await getDb();
  return withSerializedWrite(async () => {
    const source = await database.select<SequenceTemplate[]>(
      "SELECT * FROM sequence_templates WHERE id = $1",
      [id],
    );
    if (!source[0]) throw new Error("Template not found");
    const inserted = await database.execute(
      "INSERT INTO sequence_templates (name, color) VALUES ($1, $2)",
      [`${source[0].name} Copy`, source[0].color],
    );
    await database.execute(
      `INSERT INTO sequence_template_items (
         template_id, quick_block_id, title, duration_minutes,
         color, category_id, notification_enabled, sort_order
       )
       SELECT $1, quick_block_id, title, duration_minutes,
              color, category_id, notification_enabled, sort_order
       FROM sequence_template_items WHERE template_id = $2
       ORDER BY sort_order ASC, id ASC`,
      [inserted.lastInsertId, id],
    );
    return inserted.lastInsertId as number;
  });
}

/** Append a stable snapshot so later palette edits do not mutate saved templates. */
export async function appendQuickBlockToSequence(templateId: number, quickBlockId: number): Promise<number> {
  const database = await getDb();
  return withSerializedWrite(async () => {
    const blocks = await database.select<QuickBlock[]>(
      "SELECT * FROM quick_blocks WHERE id = $1",
      [quickBlockId],
    );
    if (!blocks[0]) throw new Error("Quick block not found");
    const orderRows = await database.select<{ value: number }[]>(
      "SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM sequence_template_items WHERE template_id = $1",
      [templateId],
    );
    const block = blocks[0];
    const result = await database.execute(
      `INSERT INTO sequence_template_items (
         template_id, quick_block_id, title, duration_minutes,
         color, category_id, notification_enabled, sort_order
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [templateId, block.id, block.name, block.duration_minutes, block.color, block.category_id ?? null, block.notification_enabled, orderRows[0]?.value ?? 0],
    );
    return result.lastInsertId as number;
  });
}

export async function deleteSequenceTemplateItem(id: number): Promise<void> {
  const database = await getDb();
  await database.execute("DELETE FROM sequence_template_items WHERE id = $1", [id]);
}

export async function clearSequenceTemplateItems(templateId: number): Promise<void> {
  const database = await getDb();
  await database.execute("DELETE FROM sequence_template_items WHERE template_id = $1", [templateId]);
}

/** Persist the exact drag-and-drop order as compact zero-based indices. */
export async function reorderSequenceTemplateItems(templateId: number, orderedIds: number[]): Promise<void> {
  const database = await getDb();
  await withSerializedWrite(async () => {
    for (let index = 0; index < orderedIds.length; index++) {
      await database.execute(
        "UPDATE sequence_template_items SET sort_order = $1 WHERE id = $2 AND template_id = $3",
        [index, orderedIds[index], templateId],
      );
    }
  });
}
