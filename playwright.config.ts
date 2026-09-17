import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:1420",
    trace: "retain-on-failure",
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium", channel: process.env.PW_CHANNEL || undefined },
    },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command: "bun --bun vite",
    env: { E2E: "true" },
    url: "http://localhost:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
