import { useState } from "react";
import { Button } from "@/components/ui/button";
import { exportBackup, importBackup } from "@/lib/backup";
import { downloadAndMergeCalendarSync, uploadCalendarSync } from "@/lib/calendar-sync";
import { setSetting, getSetting } from "@/lib/db";
import { isTauri } from "@/lib/tauri";
import { CloudDownload, CloudUpload, Download, Upload, AlertTriangle, CheckCircle2 } from "lucide-react";

const LAST_BACKUP_KEY = "last_backup_at";

type Status =
  | { kind: "idle" }
  | { kind: "working"; label: string }
  | { kind: "success"; label: string }
  | { kind: "error"; label: string };

export function SettingsBackupSection() {
  const [exportStatus, setExportStatus] = useState<Status>({ kind: "idle" });
  const [restoreStatus, setRestoreStatus] = useState<Status>({ kind: "idle" });
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [syncStatus, setSyncStatus] = useState<Status>({ kind: "idle" });

  const handleSyncUpload = async () => {
    setSyncStatus({ kind: "working", label: "Preparing calendar sync file…" });
    const res = await uploadCalendarSync();
    if (res.ok) {
      setSyncStatus({ kind: "success", label: `Calendar uploaded to ${res.path}.` });
    } else if (res.error === "Cancelled") {
      setSyncStatus({ kind: "idle" });
    } else {
      setSyncStatus({ kind: "error", label: res.error ?? "Calendar upload failed." });
    }
  };

  const handleSyncDownload = async () => {
    setSyncStatus({ kind: "working", label: "Merging calendar…" });
    const res = await downloadAndMergeCalendarSync();
    if (res.ok) {
      const changed = (res.inserted ?? 0) + (res.updated ?? 0) + (res.deleted ?? 0);
      setSyncStatus({
        kind: "success",
        label: `Merged ${changed} changes · ${res.unchanged ?? 0} unchanged · ${res.conflicts ?? 0} conflicts. Refreshing…`,
      });
      window.setTimeout(() => window.location.reload(), 700);
    } else if (res.error === "Cancelled") {
      setSyncStatus({ kind: "idle" });
    } else {
      setSyncStatus({ kind: "error", label: res.error ?? "Calendar merge failed." });
    }
  };

  // Load last backup timestamp lazily on first interaction.
  const refreshLastBackup = async () => {
    try {
      const v = await getSetting(LAST_BACKUP_KEY);
      setLastBackup(v);
    } catch {
      // ignore
    }
  };

  const handleExport = async () => {
    if (!isTauri()) return;
    setExportStatus({ kind: "working", label: "Preparing backup…" });
    const res = await exportBackup();
    if (res.ok) {
      const now = new Date().toISOString();
      try {
        await setSetting(LAST_BACKUP_KEY, now);
        setLastBackup(now);
      } catch {
        // ignore
      }
      setExportStatus({
        kind: "success",
        label: res.path ? `Saved to ${res.path}` : "Backup saved.",
      });
    } else if (res.error === "Cancelled") {
      setExportStatus({ kind: "idle" });
    } else {
      setExportStatus({ kind: "error", label: res.error ?? "Backup failed." });
    }
  };

  const handleRestoreConfirmed = async () => {
    setConfirming(false);
    if (!isTauri()) return;
    setRestoreStatus({ kind: "working", label: "Restoring…" });
    const res = await importBackup();
    if (res.ok) {
      const total = res.counts
        ? Object.values(res.counts).reduce((a, b) => a + b, 0)
        : 0;
      // Build a brief per-table summary so the user can confirm what landed
      // (e.g. tasks: 12, sessions: 340). Only lists tables with > 0 rows.
      const detail = res.counts
        ? Object.entries(res.counts)
            .filter(([, n]) => n > 0)
            .map(([t, n]) => `${t}: ${n}`)
            .join(" · ")
        : "";
      setRestoreStatus({
        kind: "success",
        label: `Restored ${total} records${detail ? ` (${detail})` : ""}. Restart the app to see all changes.`,
      });
    } else if (res.error === "Cancelled") {
      setRestoreStatus({ kind: "idle" });
    } else {
      setRestoreStatus({ kind: "error", label: res.error ?? "Restore failed." });
    }
  };

  return (
    <section onFocus={refreshLastBackup} onMouseEnter={refreshLastBackup}>
      <h3 className="font-serif text-xl md:text-2xl text-sahara-text mb-6 md:mb-8">
        Backup & Restore
      </h3>

      <div className="bg-sahara-bg/50 border border-sahara-border/15 rounded-xl md:rounded-2xl p-4 md:p-6 space-y-5">
        <p className="text-sm text-sahara-text-secondary leading-relaxed">
          Export all your data (sessions, tasks, categories, presets, settings,
          journal, and time blocks) to a single JSON file. Restore later or move
          your data to another device.
        </p>

        <div className="pt-4 border-t border-sahara-border/20 space-y-3">
          <div>
            <p className="text-sm font-semibold text-sahara-text">Manual calendar sync</p>
            <p className="text-xs text-sahara-text-muted mt-0.5">
              Save the same sync file in iCloud Drive. Upload on the source device, then download and merge on the other device. Existing local calendar data is preserved.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" intent="sahara" size="sm" shape="rounded-xl"
              disabled={syncStatus.kind === "working"} onClick={handleSyncUpload}
              className="gap-2 text-[11px]">
              <CloudUpload className="size-3.5" /> Upload this device
            </Button>
            <Button variant="outline" intent="sahara" size="sm" shape="rounded-xl"
              disabled={syncStatus.kind === "working"} onClick={handleSyncDownload}
              className="gap-2 text-[11px]">
              <CloudDownload className="size-3.5" /> Download & merge
            </Button>
          </div>
          <StatusLine status={syncStatus} />
        </div>

        {/* Export */}
        <div className="pt-4 border-t border-sahara-border/20 space-y-3">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm font-semibold text-sahara-text">
                Export backup
              </p>
              <p className="text-xs text-sahara-text-muted mt-0.5">
                {lastBackup
                  ? `Last backup: ${new Date(lastBackup).toLocaleString()}`
                  : "No backup created yet."}
              </p>
            </div>
            <Button
              variant="outline"
              intent="sahara"
              size="sm"
              shape="rounded-xl"
              disabled={exportStatus.kind === "working"}
              onClick={handleExport}
              className="gap-2 text-[11px]"
            >
              <Download className="size-3.5" />
              {exportStatus.kind === "working"
                ? exportStatus.label
                : "Export Backup"}
            </Button>
          </div>
          <StatusLine status={exportStatus} />
        </div>

        {/* Restore */}
        <div className="pt-4 border-t border-sahara-border/20 space-y-3">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm font-semibold text-sahara-text">
                Restore from file
              </p>
              <p className="text-xs text-sahara-text-muted mt-0.5">
                Replaces all current data. Export a backup first.
              </p>
            </div>
            <Button
              variant="outline"
              intent="sahara"
              size="sm"
              shape="rounded-xl"
              disabled={
                restoreStatus.kind === "working" || confirming
              }
              onClick={() => setConfirming(true)}
              className="gap-2 text-[11px]"
            >
              <Upload className="size-3.5" />
              Restore Backup
            </Button>
          </div>

          {confirming && (
            <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
              <AlertTriangle className="size-4 text-amber-600 shrink-0" />
              <p className="text-xs text-sahara-text-secondary flex-1">
                This will <strong>replace all current data</strong>. Export a
                backup first if you might want it back. Continue?
              </p>
              <div className="flex gap-2 shrink-0">
                <Button
                  variant="ghost"
                  intent="default"
                  size="xs"
                  onClick={() => setConfirming(false)}
                  className="text-[10px]"
                >
                  Cancel
                </Button>
                <Button
                  variant="solid"
                  intent="red"
                  size="xs"
                  onClick={handleRestoreConfirmed}
                  className="text-[10px]"
                >
                  Restore
                </Button>
              </div>
            </div>
          )}

          <StatusLine status={restoreStatus} />
        </div>
      </div>
    </section>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (status.kind === "idle" || status.kind === "working") {
    return status.kind === "working" ? (
      <p className="text-xs text-sahara-text-muted uppercase tracking-wider">
        {status.label}
      </p>
    ) : null;
  }
  if (status.kind === "success") {
    return (
      <p className="flex items-start gap-2 text-xs text-green-600 uppercase tracking-wider">
        <CheckCircle2 className="size-3.5 mt-0.5 shrink-0" />
        <span className="normal-case tracking-normal">{status.label}</span>
      </p>
    );
  }
  return (
    <p className="flex items-start gap-2 text-xs text-red-600 uppercase tracking-wider">
      <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
      <span className="normal-case tracking-normal">{status.label}</span>
    </p>
  );
}
