import { createRoot } from "react-dom/client";
import { App } from "@/app/app";
import { AppErrorBoundary } from "@/app/error-boundary";
import "./styles.css";

// macOS Tauri uses the operating system's WebKit. Some Intel Macs can run the
// app but cannot upgrade to a WebKit version that implements these ES2023
// helpers. Keep third-party code and any overlooked call sites compatible.
if (!(Array.prototype as unknown as { toSorted?: unknown }).toSorted) {
  Object.defineProperty(Array.prototype, "toSorted", {
    value<T>(this: T[], compareFn?: (a: T, b: T) => number): T[] {
      return [...this].sort(compareFn);
    },
    configurable: true,
    writable: true,
  });
}

if (!String.prototype.replaceAll) {
  Object.defineProperty(String.prototype, "replaceAll", {
    value(this: string, search: string | RegExp, replacement: string): string {
      if (search instanceof RegExp) {
        if (!search.global) throw new TypeError("replaceAll RegExp must be global");
        return this.replace(search, replacement);
      }
      return this.split(search).join(replacement);
    },
    configurable: true,
    writable: true,
  });
}

createRoot(document.getElementById("root")!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
