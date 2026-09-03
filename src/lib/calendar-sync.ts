import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeFile } from "@tauri-apps/plugin-fs";
import { getDb, withSerializedWrite } from "@/lib/db/schema";
import { getSetting, setSetting } from "@/lib/db/settings";
import { isTauri } from "@/lib/tauri";

const SYNC_APP = "kairos-calendar";
const SYNC_FORMAT_VERSION = 1;
const DEVICE_ID_KEY = "calendar_sync_device_id";
const LAST_SYNC_PATH_KEY = "calendar_sync_last_path";

export interface CalendarSyncItem {
  syncId: string;
  title: string | null;
  startTime: string;
  endTime: string;
  completed: number;
  color: string | null;
  notificationEnabled: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  deviceId: string | null;
  category: { name: string; color: string } | null;
  taskName: string | null;
}

export interface CalendarSyncFile {
  app: typeof SYNC_APP;
  formatVersion: number;
  exportedAt: string;
  deviceId: string;
  items: CalendarSyncItem[];
}

export interface CalendarSyncResult {
  ok: boolean;
  path?: string;
  error?: string;
  inserted?: number;
  updated?: number;
  deleted?: number;
  unchanged?: number;
  conflicts?: number;
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

async function deviceId(): Promise<string> {
  const existing = await getSetting(DEVICE_ID_KEY);
  if (existing) return existing;
  const created = newId();
  await setSetting(DEVICE_ID_KEY, created);
  return created;
}

function contentOf(item: CalendarSyncItem): string {
  return JSON.stringify({
    title: item.title,
    startTime: item.startTime,
    endTime: item.endTime,
    completed: Number(Boolean(item.completed)),
    color: item.color,
    notificationEnabled: Number(Boolean(item.notificationEnabled)),
    deletedAt: item.deletedAt,
    category: item.category,
    taskName: item.taskName,
  });
}

function validate(payload: unknown): asserts payload is CalendarSyncFile {
  const value = payload as Partial<CalendarSyncFile> | null;
  if (!value || value.app !== SYNC_APP || value.formatVersion !== SYNC_FORMAT_VERSION) {
    throw new Error("This is not a supported Kairos calendar sync file.");
  }
  if (!Array.isArray(value.items)) throw new Error("Calendar sync file has no items.");
  for (const item of value.items) {
    if (!item.syncId || !item.startTime || !item.endTime || !item.updatedAt) {
      throw new Error("Calendar sync file contains an incomplete item.");
    }
  }
}

async function readCalendarItems(): Promise<CalendarSyncItem[]> {
  const db = await getDb();
  return db.select<CalendarSyncItem[]>(`
    SELECT tb.sync_id AS syncId, tb.title, tb.start_time AS startTime,
           tb.end_time AS endTime, tb.completed, tb.color,
           tb.notification_enabled AS notificationEnabled,
           tb.created_at AS createdAt, tb.updated_at AS updatedAt,
           tb.deleted_at AS deletedAt, tb.device_id AS deviceId,
           CASE WHEN c.id IS NULL THEN NULL ELSE json_object('name', c.name, 'color', c.color) END AS category,
           t.name AS taskName
    FROM time_blocks tb
    LEFT JOIN categories c ON c.id = tb.category_id
    LEFT JOIN tasks t ON t.id = tb.task_id
    WHERE tb.sync_id IS NOT NULL
    ORDER BY tb.updated_at, tb.sync_id
  `).then((rows) => rows.map((row) => ({
    ...row,
    category: typeof row.category === "string" ? JSON.parse(row.category) : row.category,
  })));
}

export async function uploadCalendarSync(): Promise<CalendarSyncResult> {
  if (!isTauri()) return { ok: false, error: "Not running in desktop mode." };
  try {
    const ownDeviceId = await deviceId();
    const items = await readCalendarItems();
    const lastPath = await getSetting(LAST_SYNC_PATH_KEY);
    const path = await save({
      defaultPath: lastPath ?? "Kairos-calendar-sync.json",
      filters: [{ name: "Kairos Calendar Sync", extensions: ["json"] }],
      title: "Upload this device calendar",
    });
    if (!path) return { ok: false, error: "Cancelled" };
    const payload: CalendarSyncFile = {
      app: SYNC_APP,
      formatVersion: SYNC_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      deviceId: ownDeviceId,
      items: items.map((item) => ({ ...item, deviceId: item.deviceId ?? ownDeviceId })),
    };
    await writeFile(path, new TextEncoder().encode(JSON.stringify(payload, null, 2)));
    await setSetting(LAST_SYNC_PATH_KEY, path);
    await withSerializedWrite(async (db) => {
      for (const item of payload.items) {
        await db.execute(
          `INSERT INTO calendar_sync_state (sync_id, last_seen_updated_at, content_hash)
           VALUES ($1, $2, $3)
           ON CONFLICT(sync_id) DO UPDATE SET last_seen_updated_at = $2, content_hash = $3`,
          [item.syncId, item.updatedAt, contentOf(item)],
        );
      }
    });
    return { ok: true, path };
  } catch (error) {
    return { ok: false, error: (error as Error)?.message ?? "Calendar upload failed." };
  }
}

async function resolveCategory(
  db: Awaited<ReturnType<typeof getDb>>,
  category: CalendarSyncItem["category"],
): Promise<number | null> {
  if (!category) return null;
  const found = await db.select<{ id: number }[]>("SELECT id FROM categories WHERE name = $1 LIMIT 1", [category.name]);
  if (found[0]) return found[0].id;
  const inserted = await db.execute("INSERT INTO categories (name, color) VALUES ($1, $2)", [category.name, category.color]);
  return inserted.lastInsertId as number;
}

async function resolveTask(
  db: Awaited<ReturnType<typeof getDb>>,
  taskName: string | null,
): Promise<number | null> {
  if (!taskName) return null;
  const found = await db.select<{ id: number }[]>("SELECT id FROM tasks WHERE name = $1 ORDER BY id LIMIT 1", [taskName]);
  if (found[0]) return found[0].id;
  const inserted = await db.execute("INSERT INTO tasks (name, estimated_pomos, completed_pomos, archived) VALUES ($1, 1, 0, 0)", [taskName]);
  return inserted.lastInsertId as number;
}

export async function downloadAndMergeCalendarSync(): Promise<CalendarSyncResult> {
  if (!isTauri()) return { ok: false, error: "Not running in desktop mode." };
  let path: string | null = null;
  try {
    const lastPath = await getSetting(LAST_SYNC_PATH_KEY);
    const picked = await open({
      multiple: false,
      defaultPath: lastPath ?? undefined,
      filters: [{ name: "Kairos Calendar Sync", extensions: ["json"] }],
      title: "Download and merge calendar",
    });
    path = typeof picked === "string" ? picked : null;
    if (!path) return { ok: false, error: "Cancelled" };
    const payload: unknown = JSON.parse(await readTextFile(path));
    validate(payload);
    const ownDeviceId = await deviceId();
    const counts = { inserted: 0, updated: 0, deleted: 0, unchanged: 0, conflicts: 0 };

    await withSerializedWrite(async (db) => {
      for (const remote of payload.items) {
        const rows = await db.select<(CalendarSyncItem & { id: number })[]>(`
          SELECT tb.id, tb.sync_id AS syncId, tb.title, tb.start_time AS startTime,
                 tb.end_time AS endTime, tb.completed, tb.color,
                 tb.notification_enabled AS notificationEnabled,
                 tb.created_at AS createdAt, tb.updated_at AS updatedAt,
                 tb.deleted_at AS deletedAt, tb.device_id AS deviceId,
                 CASE WHEN c.id IS NULL THEN NULL ELSE json_object('name', c.name, 'color', c.color) END AS category,
                 t.name AS taskName
          FROM time_blocks tb
          LEFT JOIN categories c ON c.id = tb.category_id
          LEFT JOIN tasks t ON t.id = tb.task_id
          WHERE tb.sync_id = $1 LIMIT 1`, [remote.syncId]);
        const local = rows[0]
          ? { ...rows[0], category: typeof rows[0].category === "string" ? JSON.parse(rows[0].category) : rows[0].category }
          : null;
        const seen = await db.select<{ last_seen_updated_at: string; content_hash: string }[]>(
          "SELECT last_seen_updated_at, content_hash FROM calendar_sync_state WHERE sync_id = $1",
          [remote.syncId],
        );
        const remoteHash = contentOf(remote);

        if (!local) {
          if (remote.deletedAt) {
            counts.unchanged++;
          } else {
            const categoryId = await resolveCategory(db, remote.category);
            const taskId = await resolveTask(db, remote.taskName);
            await db.execute(`INSERT INTO time_blocks (
              title, start_time, end_time, task_id, category_id, color, completed,
              notification_enabled, created_at, sync_id, updated_at, deleted_at, device_id
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [
              remote.title, remote.startTime, remote.endTime, taskId, categoryId,
              remote.color, remote.completed, remote.notificationEnabled,
              remote.createdAt, remote.syncId, remote.updatedAt, remote.deletedAt,
              remote.deviceId ?? payload.deviceId,
            ]);
            counts.inserted++;
          }
        } else if (contentOf(local) === remoteHash) {
          counts.unchanged++;
        } else {
          const base = seen[0];
          const localChanged = Boolean(base && local.updatedAt !== base.last_seen_updated_at && contentOf(local) !== base.content_hash);
          const remoteChanged = Boolean(base && remote.updatedAt !== base.last_seen_updated_at && remoteHash !== base.content_hash);
          if (localChanged && remoteChanged) {
            if (!remote.deletedAt) {
              const categoryId = await resolveCategory(db, remote.category);
              const taskId = await resolveTask(db, remote.taskName);
              await db.execute(`INSERT INTO time_blocks (
                title, start_time, end_time, task_id, category_id, color, completed,
                notification_enabled, created_at, sync_id, updated_at, device_id
              ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [
                `${remote.title ?? "Untitled"} (sync conflict)`, remote.startTime, remote.endTime,
                taskId, categoryId, remote.color, remote.completed, remote.notificationEnabled,
                remote.createdAt, newId(), remote.updatedAt, remote.deviceId ?? payload.deviceId,
              ]);
            }
            counts.conflicts++;
          } else if (!base || remote.updatedAt > local.updatedAt || remote.deletedAt) {
            const categoryId = await resolveCategory(db, remote.category);
            const taskId = await resolveTask(db, remote.taskName);
            await db.execute(`UPDATE time_blocks SET
              title=$1,start_time=$2,end_time=$3,task_id=$4,category_id=$5,color=$6,
              completed=$7,notification_enabled=$8,updated_at=$9,deleted_at=$10,device_id=$11
              WHERE sync_id=$12`, [
                remote.title, remote.startTime, remote.endTime, taskId, categoryId,
                remote.color, remote.completed, remote.notificationEnabled,
                remote.updatedAt, remote.deletedAt, remote.deviceId ?? payload.deviceId,
                remote.syncId,
              ]);
            if (remote.deletedAt) counts.deleted++; else counts.updated++;
          } else {
            counts.unchanged++;
          }
        }

        await db.execute(`INSERT INTO calendar_sync_state (sync_id, last_seen_updated_at, content_hash)
          VALUES ($1,$2,$3) ON CONFLICT(sync_id) DO UPDATE SET last_seen_updated_at=$2, content_hash=$3`,
          [remote.syncId, remote.updatedAt, remoteHash]);
      }
    });
    await setSetting(LAST_SYNC_PATH_KEY, path);
    await setSetting("calendar_sync_last_merged_at", new Date().toISOString());
    await setSetting("calendar_sync_last_remote_device", payload.deviceId || ownDeviceId);
    return { ok: true, path, ...counts };
  } catch (error) {
    return { ok: false, path: path ?? undefined, error: (error as Error)?.message ?? "Calendar merge failed." };
  }
}
