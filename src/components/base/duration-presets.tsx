import { useEffect, useState } from "react";
import { loadDurationPresets, saveDurationPresets, formatPresetDuration, type DurationPreset } from "@/features/schedule/duration-presets";

/** User-maintained duration shortcuts. Persist before committing UI state; never edit templates. */
export function DurationPresets({ activeId, onSelect, onChange }: {
  activeId: string | null;
  onSelect: (preset: DurationPreset) => void;
  onChange: () => void;
}) {
  // 1. Load each time the form opens, including after a backup restore.
  const [items, setItems] = useState<DurationPreset[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [managing, setManaging] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [hours, setHours] = useState("0");
  const [minutes, setMinutes] = useState("30");
  useEffect(() => {
    let alive = true;
    loadDurationPresets().then((rows) => { if (alive) { setItems(rows); setReady(true); } })
      .catch(() => { if (alive) setError("Could not load saved durations. Close and reopen to retry."); });
    return () => { alive = false; };
  }, []);
  // 2. A failed write leaves the previous list and the editor intact.
  async function commit(next: DurationPreset[]) {
    if (busy || !ready) return false;
    setBusy(true); setError("");
    try { await saveDurationPresets(next); setItems(next); onChange(); return true; }
    catch { setError("Could not save durations. Please retry."); return false; }
    finally { setBusy(false); }
  }
  async function save() {
    const h = Number(hours), m = Number(minutes), total = h * 60 + m;
    if (!name.trim() || !Number.isSafeInteger(h) || h < 0 || !Number.isInteger(m) || m < 0 || m > 59
      || !Number.isSafeInteger(total) || total <= 0) {
      setError("Enter a name, non-negative hours and 0–59 minutes; duration must be positive."); return;
    }
    const preset = { id: editing ?? crypto.randomUUID(), name: name.trim(), minutes: total };
    if (await commit(editing ? items.map((p) => p.id === editing ? preset : p) : [...items, preset])) {
      setEditing(null); setName("");
    }
  }
  return <section aria-label="Saved durations" className="space-y-2">
    <div className="flex justify-between text-xs font-semibold"><span>Saved durations</span>
      <button type="button" disabled={!ready || busy} onClick={() => setManaging(!managing)} className="text-sahara-primary">
        {managing ? "Done" : "Manage / Add"}
      </button>
    </div>
    <div className="flex flex-wrap gap-2">{items.map((p) => <button key={p.id} type="button" disabled={busy}
      aria-pressed={activeId === p.id} onClick={() => onSelect(p)}
      className={`rounded-md px-2 py-1.5 text-xs ${activeId === p.id ? "bg-sahara-primary-light ring-1 ring-sahara-primary" : "bg-sahara-card hover:bg-sahara-primary-light"}`}>
      {p.name} · {formatPresetDuration(p.minutes)}
    </button>)}</div>
    {ready && !items.length && !managing && <p className="text-xs text-sahara-text-muted">Add a duration to reuse it here.</p>}
    {managing && <fieldset disabled={busy} className="space-y-2 text-xs">
      {items.map((p, index) => <div key={p.id} className="flex items-center gap-2">
        <span className="flex-1 truncate">{p.name}</span>
        <button type="button" aria-label={`Move ${p.name} up`} disabled={index === 0} onClick={() => {
          const next = [...items]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; void commit(next);
        }}>↑</button>
        <button type="button" onClick={() => { setEditing(p.id); setName(p.name); setHours(String(Math.floor(p.minutes / 60))); setMinutes(String(p.minutes % 60)); }}>Edit</button>
        <button type="button" aria-label={`Delete ${p.name}`} onClick={async () => {
          if (await commit(items.filter((item) => item.id !== p.id))) { if (editing === p.id) { setEditing(null); setName(""); } }
        }}>Delete</button>
      </div>)}
      <input aria-label="Duration name" placeholder="e.g. Sleep" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-md p-2 bg-sahara-card" />
      <div className="flex items-center gap-2">
        <input aria-label="Duration hours" type="number" min="0" value={hours} onChange={(e) => setHours(e.target.value)} className="w-16 rounded-md p-2 bg-sahara-card" />h
        <input aria-label="Duration minutes" type="number" min="0" max="59" value={minutes} onChange={(e) => setMinutes(e.target.value)} className="w-16 rounded-md p-2 bg-sahara-card" />m
        <button type="button" onClick={() => void save()} className="text-sahara-primary">{busy ? "Saving…" : editing ? "Update" : "Add"}</button>
        {editing && <button type="button" onClick={() => { setEditing(null); setName(""); }}>Cancel edit</button>}
      </div>
    </fieldset>}
    {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
  </section>;
}
