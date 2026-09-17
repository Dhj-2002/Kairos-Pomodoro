import { test, expect } from "@playwright/test";

test("past blocks are hollow and future blocks use borderless pale category colors", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-09-17T09:30:00"));
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await page.locator(".calendar-today-column").waitFor();
  await page.evaluate(() => {
    (globalThis as unknown as { __seedCalendarAppearance: () => void }).__seedCalendarAppearance();
  });
  await page.getByRole("button", { name: "Timer", exact: true }).click();
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  const past = page.locator('[data-calendar-block-id="9001"] .calendar-event:visible');
  const future = page.locator('[data-calendar-block-id="9002"] .calendar-event:visible');
  await expect(past).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(future).toHaveCSS("background-color", "rgb(238, 244, 250)");
  await expect(future).toHaveCSS("border-top-width", "0px");
  await expect(future.locator("p").first()).toHaveCSS("color", "rgb(31, 66, 96)");
  await future.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/calendar-colors.png", animations: "disabled" });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await expect(future).toHaveCSS("background-color", "rgb(34, 48, 59)");
  await expect(past).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
});

test("duration inspector persists presets and preserves draft across responsive layouts", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await page.locator(".calendar-today-column").click({ position: { x: 50, y: 400 } });
  await page.getByText("New 30-minute block").click();
  await expect(page.getByLabel("Schedule block editor")).toBeVisible();
  await page.getByText("Manage / Add").click();
  await page.getByLabel("Duration name").fill("Sleep");
  await page.getByLabel("Duration hours").fill("8");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const dates = page.locator('input[type="datetime-local"]');
  await dates.first().fill("2026-09-17T22:00");
  await page.getByText("Sleep · 8h 30m").click();
  await expect(dates.nth(1)).toHaveValue("2026-09-18T06:30");
  await dates.first().fill("2026-09-17T23:00");
  await expect(dates.nth(1)).toHaveValue("2026-09-18T07:30");
  await dates.nth(1).fill("2026-09-18T08:00");
  await expect(page.getByText("Sleep · 8h 30m")).toHaveAttribute("aria-pressed", "false");
  await page.getByText("Done", { exact: true }).click();
  await page.getByPlaceholder(/Deep work on report/).fill("Sleep draft");
  await page.screenshot({ path: "test-results/calendar-inspector.png" });
  await page.setViewportSize({ width: 980, height: 800 });
  await expect(page.locator(".calendar-editor")).toBeVisible();
  await expect(page.getByPlaceholder(/Deep work on report/)).toHaveValue("Sleep draft");
  await expect(dates.nth(1)).toHaveValue("2026-09-18T08:00");
  await page.screenshot({ path: "test-results/calendar-modal.png", animations: "disabled" });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.locator(".calendar-today-column").click({ position: { x: 50, y: 400 } });
  await page.getByText("New 30-minute block").click();
  await expect(page.getByText("Sleep · 8h 30m")).toBeVisible();
  await expect(page.getByText("Sleep · 8h 30m")).toHaveAttribute("aria-pressed", "false");
});
