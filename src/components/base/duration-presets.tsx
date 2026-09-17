import { useEffect, useState, type CSSProperties } from "react";
import { Plus, Trash2, Pencil, ArrowUp } from "lucide-react";
import { loadDurationPresets, saveDurationPresets, formatPresetDuration, type DurationPreset } from "@/features/schedule/duration-presets";

/** User-maintained duration shortcuts. Persist before committing UI state; never edit templates. */
export function DurationPresets({ activeId, onSelect, onChange, accentStyle }: {
  activeId: string | null;
  accentStyle?: CSSProperties;
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
  return <section aria-label="Saved durations" className="duration-presets" style={accentStyle}>
    <header><h3>Saved durations</h3><button type="button" disabled={!ready || busy} onClick={() => setManaging(!managing)}>{managing ? "Done" : "Manage"}</button></header>
    <div className="duration-cards">{items.map(p => <button key={p.id} type="button" disabled={busy} aria-label={p.name + " " + formatPresetDuration(p.minutes)} aria-pressed={activeId === p.id} onClick={() => onSelect(p)}>
      <span>{p.name}</span><span>{formatPresetDuration(p.minutes)}</span>
    </button>)}</div>
    <button className="add-duration" type="button" disabled={!ready || busy} onClick={() => { setManaging(true); setEditing(null); setName(""); }}><Plus size={15} />Add duration</button>
    {ready && !items.length && !managing && <p className="duration-empty">Your saved durations stay here until you remove them.</p>}
    {managing && <fieldset disabled={busy} className="duration-manager">
      {items.map((p,index) => <div className="duration-manager-row" key={p.id}><span>{p.name}</span><span>{formatPresetDuration(p.minutes)}</span>
        <button type="button" aria-label={"Move " + p.name + " up"} disabled={index === 0} onClick={() => { const next = [...items]; [next[index-1],next[index]] = [next[index],next[index-1]]; void commit(next); }}><ArrowUp size={14}/></button>
        <button type="button" aria-label={"Edit " + p.name} onClick={() => { setEditing(p.id); setName(p.name); setHours(String(Math.floor(p.minutes/60))); setMinutes(String(p.minutes%60)); }}><Pencil size={14}/></button>
        <button type="button" aria-label={"Delete " + p.name} onClick={async () => { if (await commit(items.filter(item => item.id !== p.id))) { if(editing === p.id) {setEditing(null);setName("");} } }}><Trash2 size={14}/></button>
      </div>)}
      <div className="duration-edit-labels"><span>Name</span><span>Duration</span></div>
      <div className="duration-edit-fields"><input aria-label="Duration name" placeholder="e.g. Sleep" value={name} onChange={e => setName(e.target.value)} />
        <input aria-label="Duration hours" type="number" min="0" value={hours} onChange={e=>setHours(e.target.value)}/><span>h</span>
        <input aria-label="Duration minutes" type="number" min="0" max="59" value={minutes} onChange={e=>setMinutes(e.target.value)}/><span>m</span>
      </div>
      <div className="duration-edit-actions">{editing && <button type="button" onClick={()=>{setEditing(null);setName("");}}>Cancel edit</button>}<button type="button" onClick={()=>void save()}>{busy ? "Saving…" : editing ? "Update" : "Add"}</button></div>
    </fieldset>}
    {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
  </section>;
}
