import Database from "@tauri-apps/plugin-sql";
import { DEFAULT_CATEGORY_COLOR } from "@/lib/constants";

const DB_NAME = import.meta.env.DEV
  ? "sqlite:Kairos-Pomodoro-dev.db"
  : "sqlite:Kairos-Pomodoro.db";

let db: Database | null = null;
let dbPromise: Promise<Database> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

/**
 * Serialize multi-statement writes without explicit BEGIN/COMMIT commands.
 * The Tauri SQL plugin autocommits statements on this shared connection, and
 * explicit transaction control can leave COMMIT with no active transaction.
 */
export async function withSerializedWrite<T>(
  work: (database: Database) => Promise<T>,
): Promise<T> {
  const previous = writeQueue;
  let release!: () => void;
  writeQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await work(await getDb());
  } finally {
    release();
  }
}

export async function withTransaction<T>(
  work: (database: Database) => Promise<T>,
): Promise<T> {
  const database = await getDb();
  await database.execute("BEGIN IMMEDIATE");

  try {
    const result = await work(database);
    await database.execute("COMMIT");
    return result;
  } catch (error) {
    try {
      await database.execute("ROLLBACK");
    } catch (rollbackError) {
      console.error("[DB] Failed to roll back transaction:", rollbackError);
    }
    throw error;
  }
}

export function getDbName(): string {
  return DB_NAME;
}

export async function getDb(): Promise<Database> {
  if (db) return db;

  // Several pages load data with Promise.all during startup. Share the
  // in-flight native connection load so those callers cannot open multiple
  // SQLite connections to the same file and contend for the write lock.
  if (!dbPromise) {
    dbPromise = Database.load(DB_NAME)
      .then(async (connection) => {
        await connection.execute("PRAGMA busy_timeout = 10000");
        db = connection;
        return connection;
      })
      .catch((error) => {
        dbPromise = null;
        throw error;
      });
  }

  return dbPromise;
}

export async function initDb(): Promise<void> {
  const database = await getDb();

  // Wait up to 10s for locks instead of failing immediately with SQLITE_BUSY.
  await database.execute("PRAGMA busy_timeout = 10000");

  await database.execute(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      estimated_pomos INTEGER NOT NULL DEFAULT 1,
      completed_pomos INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      archived BOOLEAN DEFAULT 0
    )
  `);

  await database.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER,
      phase TEXT NOT NULL,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME,
      duration_sec INTEGER NOT NULL,
      completed BOOLEAN NOT NULL DEFAULT 0,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    )
  `);

  await database.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  await database.execute(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '${DEFAULT_CATEGORY_COLOR}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await database.execute(`
    CREATE TABLE IF NOT EXISTS _schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Versioned migrations
  let currentVersion = 0;
  try {
    const rows = await database.select<{ value: string }[]>(
      "SELECT value FROM _schema_meta WHERE key = 'version'",
    );
    if (rows.length > 0) currentVersion = Number(rows[0].value);
  } catch {
    // Fresh database
  }

  const migrations: Record<number, string[]> = {
    1: [
      "ALTER TABLE tasks ADD COLUMN project TEXT",
      "ALTER TABLE tasks ADD COLUMN priority TEXT",
      "ALTER TABLE tasks ADD COLUMN category_id INTEGER",
      "ALTER TABLE sessions ADD COLUMN category_id INTEGER",
      "ALTER TABLE sessions ADD COLUMN intention TEXT",
      "ALTER TABLE sessions ADD COLUMN mood TEXT",
      "ALTER TABLE sessions ADD COLUMN notes TEXT",
    ],
    2: [
      `CREATE TABLE IF NOT EXISTS presets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        work_duration INTEGER NOT NULL,
        short_break_duration INTEGER NOT NULL,
        long_break_duration INTEGER NOT NULL,
        pomos_before_long_break INTEGER NOT NULL DEFAULT 4,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
    ],
    3: [
      // Time-blocking: planned focus blocks shown on the calendar.
      `CREATE TABLE IF NOT EXISTS time_blocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        task_id INTEGER,
        category_id INTEGER,
        color TEXT,
        completed BOOLEAN NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        FOREIGN KEY (category_id) REFERENCES categories(id),
        CHECK (end_time > start_time)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_time_blocks_start_date ON time_blocks(date(start_time))`,
      // Standalone journal entries (free-form daily reflections).
      `CREATE TABLE IF NOT EXISTS journal_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(date)`,
    ],
    4: [
      // Link each time block to the focus session it logs, so logged time
      // counts toward stats (Total Focus, sessions, streaks) just like a
      // completed countdown-timer session.
      "ALTER TABLE time_blocks ADD COLUMN session_id INTEGER REFERENCES sessions(id)",
      // Time blocks were previously stored as UTC ISO (`...Z`) via toISOString(),
      // while every other date in the app is local-naive (`yyyy-MM-dd HH:mm:ss`).
      // Convert existing rows to local-naive. The `LIKE '%Z'` guard makes this
      // idempotent: naive rows have no trailing Z and are left untouched, so
      // re-running the migration or restoring a converted backup is safe.
      "UPDATE time_blocks SET start_time = datetime(start_time, 'localtime'), end_time = datetime(end_time, 'localtime') WHERE start_time LIKE '%Z'",
    ],
    5: [
      `CREATE TABLE IF NOT EXISTS badge_awards (
        badge_id TEXT PRIMARY KEY,
        earned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        trigger_session_id INTEGER,
        announced_at DATETIME,
        FOREIGN KEY (trigger_session_id) REFERENCES sessions(id) ON DELETE SET NULL
      )`,
      "CREATE INDEX IF NOT EXISTS idx_badge_awards_announced ON badge_awards(announced_at)",
    ],
    6: [
      // Reusable whole-day schedules. Template blocks store minutes from
      // midnight so applying one to any local date never introduces UTC drift.
      `CREATE TABLE IF NOT EXISTS schedule_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '${DEFAULT_CATEGORY_COLOR}',
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS template_blocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id INTEGER NOT NULL,
        title TEXT,
        category_id INTEGER,
        start_minute INTEGER NOT NULL,
        duration_minutes INTEGER NOT NULL,
        notification_enabled BOOLEAN NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (template_id) REFERENCES schedule_templates(id) ON DELETE CASCADE,
        FOREIGN KEY (category_id) REFERENCES categories(id),
        CHECK (start_minute >= 0 AND start_minute < 1440),
        CHECK (duration_minutes > 0)
      )`,
      "CREATE INDEX IF NOT EXISTS idx_template_blocks_template ON template_blocks(template_id, sort_order, start_minute)",
      // Generated day blocks are snapshots: these columns retain provenance
      // without making later template edits mutate an already-applied day.
      "ALTER TABLE time_blocks ADD COLUMN source_template_id INTEGER REFERENCES schedule_templates(id) ON DELETE SET NULL",
      "ALTER TABLE time_blocks ADD COLUMN source_template_block_id INTEGER REFERENCES template_blocks(id) ON DELETE SET NULL",
      "ALTER TABLE time_blocks ADD COLUMN notification_enabled BOOLEAN NOT NULL DEFAULT 1",
      "ALTER TABLE time_blocks ADD COLUMN reminded_at DATETIME",
      "CREATE INDEX IF NOT EXISTS idx_time_blocks_due_reminder ON time_blocks(notification_enabled, reminded_at, start_time, end_time)",
    ],
    7: [
      // Lightweight scheduling vocabulary. Quick blocks are reusable colored
      // duration buttons; sequence templates are ordered snapshots of them and
      // intentionally contain no absolute date or start time.
      `CREATE TABLE IF NOT EXISTS quick_blocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL,
        color TEXT NOT NULL DEFAULT '${DEFAULT_CATEGORY_COLOR}',
        notification_enabled BOOLEAN NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        CHECK (duration_minutes > 0)
      )`,
      `CREATE TABLE IF NOT EXISTS sequence_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '${DEFAULT_CATEGORY_COLOR}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS sequence_template_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id INTEGER NOT NULL,
        quick_block_id INTEGER,
        title TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL,
        color TEXT NOT NULL,
        notification_enabled BOOLEAN NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (template_id) REFERENCES sequence_templates(id) ON DELETE CASCADE,
        FOREIGN KEY (quick_block_id) REFERENCES quick_blocks(id) ON DELETE SET NULL,
        CHECK (duration_minutes > 0)
      )`,
      "CREATE INDEX IF NOT EXISTS idx_quick_blocks_order ON quick_blocks(sort_order, id)",
      "CREATE INDEX IF NOT EXISTS idx_sequence_template_items_order ON sequence_template_items(template_id, sort_order, id)",
    ],
    8: [
      // Tag ownership replaces independent block color semantics. Existing
      // palette and sequence rows intentionally remain NULL and render gray.
      "ALTER TABLE quick_blocks ADD COLUMN category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL",
      "ALTER TABLE sequence_template_items ADD COLUMN category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL",
      "CREATE INDEX IF NOT EXISTS idx_quick_blocks_category ON quick_blocks(category_id)",
      "CREATE INDEX IF NOT EXISTS idx_sequence_template_items_category ON sequence_template_items(category_id)",
    ],
    9: [
      // Stable cross-device identity and tombstones for manual file sync.
      "ALTER TABLE time_blocks ADD COLUMN sync_id TEXT",
      "ALTER TABLE time_blocks ADD COLUMN updated_at DATETIME",
      "ALTER TABLE time_blocks ADD COLUMN deleted_at DATETIME",
      "ALTER TABLE time_blocks ADD COLUMN device_id TEXT",
      // Existing databases on Windows/macOS originated from the same migrated
      // snapshot, so derive legacy IDs from their preserved row IDs. If each
      // device generated random IDs here, the first sync would duplicate every
      // historical block.
      "UPDATE time_blocks SET sync_id = printf('legacy-%016x', id) WHERE sync_id IS NULL",
      "UPDATE time_blocks SET updated_at = COALESCE(created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_time_blocks_sync_id ON time_blocks(sync_id)",
      `CREATE TABLE IF NOT EXISTS calendar_sync_state (
        sync_id TEXT PRIMARY KEY,
        last_seen_updated_at DATETIME NOT NULL,
        content_hash TEXT NOT NULL
      )`,
    ],
  };

  const targetVersion = 9;

  for (let v = currentVersion + 1; v <= targetVersion; v++) {
    const statements = migrations[v];
    if (!statements) continue;
    for (const sql of statements) {
      try {
        await database.execute(sql);
      } catch (e) {
        const msg = (e as Error)?.message ?? "";
        if (!msg.includes("duplicate column")) {
          console.warn(`[DB] Migration v${v} warning:`, msg);
        }
      }
    }
    await database.execute(
      "INSERT OR REPLACE INTO _schema_meta (key, value) VALUES ('version', $1)",
      [String(v)],
    );
  }

  // Seed default presets if none exist
  const presetCount = await database.select<{ count: number }[]>(
    "SELECT COUNT(*) as count FROM presets",
  );
  if (presetCount[0].count === 0) {
    await database.execute(`
      INSERT INTO presets (name, work_duration, short_break_duration, long_break_duration, pomos_before_long_break)
      VALUES 
        ('Classic Pomodoro', 1500, 300, 900, 4),
        ('Deep Work', 3600, 600, 1800, 3),
        ('Flow State', 5400, 900, 3600, 2),
        ('Quick Sprints', 900, 180, 600, 4)
    `);
  }

  // Seed three editable day templates once. They are normal database rows:
  // users may rename, modify, duplicate, or delete them from the UI.
  const templateCount = await database.select<{ count: number }[]>(
    "SELECT COUNT(*) as count FROM schedule_templates",
  );
  if (templateCount[0].count === 0) {
    const defaults = [
      {
        name: "Research Day",
        color: "#c2652a",
        description: "Long reading, writing, and experiment blocks.",
        blocks: [["Morning research", 540, 120], ["Paper writing", 840, 120], ["Experiment review", 1170, 90]],
      },
      {
        name: "Meeting Day",
        color: "#6b7f5d",
        description: "Planning, meetings, and one protected focus block.",
        blocks: [["Daily planning", 540, 45], ["Meetings", 630, 90], ["Protected focus", 840, 120]],
      },
      {
        name: "Light Day",
        color: "#64748b",
        description: "A lower-load schedule for recovery days.",
        blocks: [["Light reading", 600, 90], ["Admin", 900, 60], ["Daily review", 1200, 45]],
      },
    ] as const;
    for (const template of defaults) {
      const inserted = await database.execute(
        `INSERT INTO schedule_templates (name, color, description)
         VALUES ($1, $2, $3)`,
        [template.name, template.color, template.description],
      );
      for (let index = 0; index < template.blocks.length; index++) {
        const [title, startMinute, durationMinutes] = template.blocks[index];
        await database.execute(
          `INSERT INTO template_blocks (
             template_id, title, start_minute, duration_minutes,
             notification_enabled, sort_order
           ) VALUES ($1, $2, $3, $4, 1, $5)`,
          [inserted.lastInsertId, title, startMinute, durationMinutes, index],
        );
      }
    }
  }

  // Seed a compact block palette and one editable example sequence. These are
  // normal rows and can be renamed, recolored, reordered, or deleted in-app.
  const quickBlockCount = await database.select<{ count: number }[]>(
    "SELECT COUNT(*) as count FROM quick_blocks",
  );
  if (quickBlockCount[0].count === 0) {
    const defaults = [
      ["15m", 15, "#6f91b7"],
      ["30m", 30, "#6b8f71"],
      ["60m", 60, "#c96a2b"],
      ["120m", 120, "#846a9f"],
    ] as const;
    for (let index = 0; index < defaults.length; index++) {
      const [name, duration, color] = defaults[index];
      await database.execute(
        `INSERT INTO quick_blocks (name, duration_minutes, color, notification_enabled, sort_order)
         VALUES ($1, $2, $3, 1, $4)`,
        [name, duration, color, index],
      );
    }
  }

  const sequenceTemplateCount = await database.select<{ count: number }[]>(
    "SELECT COUNT(*) as count FROM sequence_templates",
  );
  if (sequenceTemplateCount[0].count === 0) {
    const inserted = await database.execute(
      "INSERT INTO sequence_templates (name, color) VALUES ('Focus Flow', $1)",
      [DEFAULT_CATEGORY_COLOR],
    );
    const blocks = await database.select<{
      id: number;
      name: string;
      duration_minutes: number;
      color: string;
      notification_enabled: number;
    }[]>(
      "SELECT id, name, duration_minutes, color, notification_enabled FROM quick_blocks WHERE duration_minutes IN (15, 60, 120) ORDER BY CASE duration_minutes WHEN 60 THEN 0 WHEN 15 THEN 1 ELSE 2 END",
    );
    for (let index = 0; index < blocks.length; index++) {
      const block = blocks[index];
      await database.execute(
        `INSERT INTO sequence_template_items (
           template_id, quick_block_id, title, duration_minutes,
           color, notification_enabled, sort_order
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [inserted.lastInsertId, block.id, block.name, block.duration_minutes, block.color, block.notification_enabled, index],
      );
    }
  }
}
