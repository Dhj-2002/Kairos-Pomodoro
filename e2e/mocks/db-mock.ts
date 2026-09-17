// Mock database that replaces @tauri-apps/plugin-sql for browser E2E tests.
// Stores everything in memory using plain Maps.

interface Row {
  id: number;
  [col: string]: unknown;
}

const tables = new Map<string, Map<number, Row>>();
const autoInc = new Map<string, number>();
const columnDefaults = new Map<string, Map<string, unknown>>();

/** Isolated browser fixture; never used by the native SQL plugin. */
export function seedCalendarAppearance() {
  const rows = getTable("time_blocks");
  const fixtures = [
    [9001, "Completed research", "2026-09-16 09:00:00", "2026-09-16 11:00:00", "#408ac9"],
    [9002, "Upcoming research", "2026-09-17 10:00:00", "2026-09-17 12:00:00", "#408ac9"],
    [9003, "Reading", "2026-09-18 09:00:00", "2026-09-18 11:00:00", "#6d9c45"],
    [9004, "Writing", "2026-09-19 09:00:00", "2026-09-19 11:00:00", "#b95b87"],
    [9005, "Planning", "2026-09-20 09:00:00", "2026-09-20 11:00:00", "#ba8b35"],
  ];
  for (const [id, title, start_time, end_time, color] of fixtures) rows.set(Number(id), {
    id: Number(id), title, start_time, end_time, category_id: 99,
    category_color: color, category_name: "Preview", completed: 0,
    notification_enabled: 0, task_id: null, session_id: null, deleted_at: null,
  });
}
(globalThis as unknown as { __seedCalendarAppearance: () => void }).__seedCalendarAppearance = seedCalendarAppearance;

/** Detailed reference fixture. Browser-only; never touches native user records. */
function seedDesignReference() {
  const cats = getTable("categories");
  const names = ["Study", "Work", "Sleep", "Health", "Other"];
  const colors = ["#55B7FA", "#65C65A", "#FF69AC", "#FFCC49", "#9AA1AE"];
  names.forEach((name, i) => cats.set(i + 1, { id: i + 1, name, color: colors[i], archived: 0 }));
  const events: [number, string, string, string, number][] = [
    [14,"Research","09:00","11:00",1],[14,"Lunch","12:00","13:00",4],[14,"Class","14:00","16:00",3],[14,"Writing","17:00","18:30",2],
    [15,"Team sync","09:30","11:00",2],
    [16,"Gym","08:30","09:30",3],[16,"Lunch","12:00","13:00",4],[16,"Project work","14:00","15:30",1],[16,"Read","17:00","18:00",1],
    [17,"Research","09:00","11:00",1],[17,"Class","14:00","16:00",3],[17,"Writing","17:00","18:30",2],[17,"Plan next week","20:00","21:00",1],[17,"Sleep","22:00","06:30",3],
    [18,"Client call","09:00","10:00",2],[18,"Lunch","12:00","13:00",4],[18,"1:1 with Alex","14:00","15:00",1],[18,"Dinner","17:00","18:00",4],
    [19,"Walk","09:00","10:00",2],[20,"Reading","10:00","11:00",1],
  ];
  const rows = getTable("time_blocks");
  rows.clear();
  events.forEach(([day,title,start,end,cat],i) => rows.set(10000+i, {
    id:10000+i, title, start_time:`2026-09-${day} ${start}:00`,
    end_time:`2026-09-${end < start ? day+1 : day} ${end}:00`,
    category_id:cat, category_color:colors[cat-1], category_name:names[cat-1],
    completed:0, notification_enabled:0, task_id:null, session_id:null, deleted_at:null,
  }));
  autoInc.set("time_blocks", 10100);
  autoInc.set("categories", 10);
  const settings = getTable("settings");
  const id = (autoInc.get("settings") ?? 1) + 1;
  settings.set(id, { id, key:"calendar_duration_presets_v1", value:JSON.stringify({version:1,items:[
    {id:"sleep",name:"Sleep",minutes:510},{id:"focus",name:"Focus",minutes:90},{id:"break",name:"Break",minutes:20}
  ]}) });
  autoInc.set("settings",id);
  const sessions = getTable("sessions");
  sessions.clear();
  [4.5,2,2.5,1.5,3.5].forEach((hours,i) => sessions.set(11000+i, {
    id:11000+i, phase:"work", started_at:"2026-09-17 00:00:00",
    duration_sec:hours*3600, ended_at:null, completed:1,
    category_id:i+1, category_name:names[i], category_color:colors[i], task_id:null,
    intention:"Reference history", notes:null,
  }));
}
(globalThis as unknown as { __seedDesignReference: () => void }).__seedDesignReference = seedDesignReference;

(function seedDefaults() {
  const settings = getTable("settings");
  autoInc.set("settings", 1);
  settings.set(1, { id: 1, key: "onboarding_complete", value: "true" });
})();

function getTable(name: string): Map<number, Row> {
  if (!tables.has(name)) {
    tables.set(name, new Map());
    autoInc.set(name, 0);
  }
  return tables.get(name)!;
}

function allRows(name: string): Row[] {
  return Array.from(getTable(name).values());
}

function parseTable(sql: string): string {
  const m = sql.match(
    /(?:FROM|INTO|UPDATE|TABLE(?:\s+IF\s+NOT\s+EXISTS)?)\s+["']?(\w+)/i,
  );
  return m ? m[1].toLowerCase() : "";
}

function parseWhereId(sql: string, params: unknown[]): number | null {
  const m = sql.match(/WHERE\s+id\s*=\s*\$(\d+)/i);
  return m ? Number(params[parseInt(m[1]) - 1]) : null;
}

function applyWhereFilters(rows: Row[], sql: string, up: string, params: unknown[]): Row[] {
  if (!up.includes("WHERE")) return rows;

  let result = rows;
  if (/\b(?:\w+\.)?DELETED_AT IS NULL/.test(up)) result = result.filter(r => r.deleted_at == null);
  if (up.includes("ARCHIVED = 0")) result = result.filter((r) => r.archived === 0);
  if (up.includes("COMPLETED = 1")) result = result.filter((r) => r.completed === 1);
  if (up.includes("COMPLETED = 0")) result = result.filter((r) => r.completed === 0);

  // DATE(started_at) range/today filters used by getWeekSessions / getTodaySessions.
  // Extract the date portion (YYYY-MM-DD) from the row's started_at and compare
  // against $N params so logged sessions can be read back in e2e.
  if (up.includes("DATE(STARTED_AT)")) {
    const rowDate = (r: Row) => String(r.started_at ?? "").slice(0, 10);
    if (up.includes("DATE('NOW'")) {
      // today: date(started_at) = date('now', 'localtime'). Production uses the
      // 'localtime' modifier, so compute "today" from local (not UTC) components —
      // toISOString() would shift the day bucket near midnight UTC and mismatch.
      const now = new Date();
      const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      result = result.filter((r) => rowDate(r) === localToday);
    } else {
      // range: date(started_at) >= $1 AND date(started_at) <= $2
      const dates = params.map(String);
      result = result.filter((r) => {
        const d = rowDate(r);
        return dates.length >= 2 ? d >= dates[0] && d <= dates[1] : true;
      });
    }
  }

  const id = parseWhereId(sql, params);
  if (id) result = result.filter((r) => r.id === id);

  const genericEq = sql.match(/WHERE\s+(\w+)\s*=\s*\$(\d+)/i);
  if (genericEq) {
    const col = genericEq[1];
    const pIdx = parseInt(genericEq[2]) - 1;
    if (pIdx < params.length && col !== "id") {
      result = result.filter((r) => r[col] === params[pIdx]);
    }
  }

  return result;
}

function parseCreateDefaults(sql: string): Map<string, unknown> {
  const defaults = new Map<string, unknown>();
  // Match column definitions inside the CREATE TABLE body
  const bodyMatch = sql.match(/\(([^)]+)\)/s);
  if (!bodyMatch) return defaults;

  const lines = bodyMatch[1].split(",").map((l) => l.trim());
  for (const line of lines) {
    // Skip constraints (FOREIGN KEY, PRIMARY KEY, etc.)
    if (/^(FOREIGN|PRIMARY|UNIQUE|CHECK|CONSTRAINT)/i.test(line)) continue;

    const parts = line.split(/\s+/);
    const colName = parts[0].replace(/["']/g, "");
    if (!colName) continue;

    const defaultMatch = line.match(/DEFAULT\s+(\S+)/i);
    if (defaultMatch) {
      let val = defaultMatch[1];
      // Remove trailing comma
      val = val.replace(/,$/, "");
      // Parse the default value
      if (val === "0") defaults.set(colName, 0);
      else if (val === "1") defaults.set(colName, 1);
      else if (/^\d+$/.test(val)) defaults.set(colName, Number(val));
      else if (
        val.startsWith("'") &&
        val.endsWith("'") &&
        val !== "'now'"
      ) {
        defaults.set(colName, val.slice(1, -1));
      }
    }
  }
  return defaults;
}

export class Database {
  static async load(_name: string): Promise<Database> {
    return new Database();
  }

  async execute(sql: string, params: unknown[] = []) {
    const up = sql.trim().toUpperCase();
    const name = parseTable(sql);

    if (up.startsWith("CREATE TABLE")) {
      getTable(name);
      columnDefaults.set(name, parseCreateDefaults(sql));
      return { lastInsertId: 0, rowsAffected: 0 };
    }

    if (up.startsWith("INSERT")) {
      const tbl = getTable(name);
      if (name === "settings" && up.includes("ON CONFLICT")) {
        const existing = [...tbl.values()].find((row) => row.key === params[0]);
        if (existing) { existing.value = params[1]; return { lastInsertId: existing.id, rowsAffected: 1 }; }
      }
      const id = (autoInc.get(name) || 0) + 1;
      autoInc.set(name, id);
      const row: Row = { id };

      // Apply schema defaults first
      const defaults = columnDefaults.get(name);
      if (defaults) {
        for (const [col, val] of defaults) {
          row[col] = val;
        }
      }

      // Parse the VALUES tokens to handle mixed placeholders and literals
      const colsM = sql.match(/\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
      if (colsM) {
        const cols = colsM[1].split(",").map((c) => c.trim());
        const valTokens = colsM[2].split(",").map((v) => v.trim());
        cols.forEach((col, i) => {
          if (col.toLowerCase() === "id") return;
          const token = valTokens[i];
          if (!token) return;

          if (/^\$\d+$/.test(token)) {
            // Placeholder — consume from params
            const pIdx = parseInt(token.slice(1)) - 1;
            row[col] = pIdx < params.length ? params[pIdx] : null;
          }
          // Otherwise it's a literal/function — skip, default was already applied
        });
      }
      tbl.set(id, row);
      return { lastInsertId: id, rowsAffected: 1 };
    }

    if (up.startsWith("UPDATE")) {
      const tbl = getTable(name);
      const id = parseWhereId(sql, params);

      // Upsert for settings table
      if (up.includes("ON CONFLICT")) {
        for (const [, row] of tbl) {
          if (row.key === params[0]) {
            row.value = params[params.length - 1];
            return { lastInsertId: 0, rowsAffected: 1 };
          }
        }
        const newId = (autoInc.get(name) || 0) + 1;
        autoInc.set(name, newId);
        tbl.set(newId, { id: newId, key: params[0], value: params[1] });
        return { lastInsertId: 0, rowsAffected: 1 };
      }

      if (id && tbl.has(id)) {
        const row = tbl.get(id)!;
        const previousSessionId = row.session_id;
        const previouslyDeleted = row.deleted_at;
        // Handle col = col + 1
        const incM = sql.match(/(\w+)\s*=\s*\1\s*\+\s*1/i);
        if (incM) {
          row[incM[1]] = ((row[incM[1]] as number) || 0) + 1;
          return { lastInsertId: 0, rowsAffected: 1 };
        }
        // General SET
        const setM = sql.match(/SET\s+(.+?)(?:\s+WHERE|$)/is);
        if (setM) {
          setM[1]
            .split(",")
            .map((s) => s.trim())
            .forEach((part) => {
              const [col] = part.split("=").map((s) => s.trim());
              const idxM = part.match(/\$(\d+)/);
              if (idxM) row[col] = params[parseInt(idxM[1]) - 1];
              else if (/=\s*NULL$/i.test(part)) row[col] = null;
              else if (/=\s*CURRENT_TIMESTAMP$/i.test(part)) row[col] = new Date().toISOString().replace("T", " ").slice(0,19);
            });
        }
        // Mirror the native time-block tombstone trigger in browser fixtures.
        // Without this, soft-delete succeeds in SQLite but never in this mock.
        if (name === "time_blocks" && previouslyDeleted == null && row.deleted_at != null && previousSessionId != null) {
          getTable("sessions").delete(Number(previousSessionId));
        }
        return { lastInsertId: 0, rowsAffected: 1 };
      }
      return { lastInsertId: 0, rowsAffected: 0 };
    }

    if (up.startsWith("DELETE")) {
      const tbl = getTable(name);
      const id = parseWhereId(sql, params);
      if (id && tbl.has(id)) {
        tbl.delete(id);
        return { lastInsertId: 0, rowsAffected: 1 };
      }
      const tm = sql.match(/task_id\s*=\s*\$(\d+)/i);
      if (tm) {
        const tid = Number(params[parseInt(tm[1]) - 1]);
        for (const [rid, row] of tbl) {
          if (row.task_id === tid) tbl.delete(rid);
        }
      }
      return { lastInsertId: 0, rowsAffected: 0 };
    }

    if (up.startsWith("ALTER TABLE")) {
      const cm = sql.match(/ADD\s+COLUMN\s+(\w+)/i);
      if (cm) {
        for (const row of getTable(name).values()) {
          if (!(cm[1] in row)) row[cm[1]] = null;
        }
      }
      return { lastInsertId: 0, rowsAffected: 0 };
    }

    return { lastInsertId: 0, rowsAffected: 0 };
  }

  async select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const up = sql.trim().toUpperCase();
    const name = parseTable(sql);

    if (name === "_schema_meta") {
      const tbl = getTable(name);
      const vrow = Array.from(tbl.values()).find((r) => r.key === "version");
      return (vrow ? [{ value: vrow.value }] : []) as T[];
    }

    // Grouped aggregates over an empty fixture produce no groups, not a fabricated count row.
    if (name === "sessions" && up.includes("GROUP BY S.CATEGORY_ID") && up.includes("TOTAL_SECONDS")) {
      const grouped = new Map<number, { category_id:number; category_name:unknown; category_color:unknown; total_seconds:number; session_count:number }>();
      const lower = new Date(String(params[0] ?? "2026-09-17") + "T00:00:00").getTime();
      const upperDate = new Date(String(params[1] ?? "2026-09-17") + "T00:00:00");
      upperDate.setDate(upperDate.getDate()+1);
      for (const row of allRows("sessions")) {
        if(row.completed !== 1 || row.phase !== "work") continue;
        const start = new Date(String(row.started_at).replace(" ","T")).getTime();
        const end = row.ended_at ? new Date(String(row.ended_at).replace(" ","T")).getTime() : start + Number(row.duration_sec)*1000;
        const seconds = Math.max(0,Math.min(end,upperDate.getTime())-Math.max(start,lower))/1000;
        if(!seconds) continue;
        const id = Number(row.category_id);
        const category = getTable("categories").get(id);
        const group = grouped.get(id) ?? {category_id:id,category_name:category?.name,category_color:category?.color,total_seconds:0,session_count:0};
        group.total_seconds += seconds; group.session_count++; grouped.set(id,group);
      }
      return [...grouped.values()].sort((a,b)=>b.total_seconds-a.total_seconds) as T[];
    }
    if (up.includes("GROUP BY") && allRows(name).length === 0) return [] as T[];

    if (up.includes("COUNT(*)")) {
      const countCol = (sql.match(/COUNT\(\*\)\s+AS\s+(\w+)/i) || [])[1] ?? "count";
      let rows = allRows(name);

      rows = applyWhereFilters(rows, sql, up, params);

      return [{ [countCol]: rows.length }] as T[];
    }

    if (
      up.includes("SUM(") ||
      up.includes("COUNT(") ||
      up.includes("AVG(") ||
      up.includes("COALESCE")
    ) {
      return [] as T[];
    }

    let rows = allRows(name);

    rows = applyWhereFilters(rows, sql, up, params);

    return rows as T[];
  }
}

export default Database;
