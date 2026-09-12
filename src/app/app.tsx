import { Providers } from "@/app/providers";
import { Router } from "@/app/router";
import { ScheduleMiniWindow } from "@/components/schedule/schedule-mini-window";
import { isTauri } from "@/lib/tauri";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function App() {
  if (isTauri() && getCurrentWindow().label === "mini") {
    return <ScheduleMiniWindow />;
  }

  return (
    <Providers>
      <Router />
    </Providers>
  );
}
