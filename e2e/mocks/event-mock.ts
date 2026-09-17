// Mock for @tauri-apps/api/event — no-op in browser tests
export async function listen(_event: string, _handler: (event: unknown) => void) {
  return () => {};
}
export async function emitTo(_target: string, _event: string, _payload?: unknown) {}
export async function emit(_event: string, _payload?: unknown) {}
export async function once(_event: string, _handler: (event: unknown) => void) { return () => {}; }
