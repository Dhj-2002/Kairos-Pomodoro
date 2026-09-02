import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTimerStore } from "@/features/timer/use-timer-store";
import { isTauri } from "@/lib/tauri";

export function useNativeUI() {
  const phase = useTimerStore((s) => s.phase);
  const status = useTimerStore((s) => s.status);

  useEffect(() => {
    if (!isTauri()) return;

    // The visible macOS menu-bar title belongs exclusively to the active
    // calendar block. Timer state remains available in the icon tooltip.
    invoke("menubar_show").catch(() => {});
    const phaseLabel = phase === "work" ? "Focus" : "Break";
    const tooltip = status === "idle" ? "Kairos-Pomodoro" : `Kairos-Pomodoro - ${phaseLabel}`;
    invoke("plugin:tray|set_tooltip", { tooltip }).catch(() => {});

    return () => {
      invoke("plugin:tray|set_tooltip", { tooltip: "" }).catch(() => {});
    };
  }, [phase, status]);
}
