import { test, expect } from "@playwright/test";

test("reference layout audit", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-09-17T16:30:00"));
  await page.setViewportSize({ width:1584, height:993 });
  await page.goto("/");
  await page.locator(".calendar-today-column").waitFor();
  await page.evaluate(() => (globalThis as unknown as { __seedDesignReference: () => void }).__seedDesignReference());
  await page.getByRole("button", { name:"Timer", exact:true }).click();
  await page.getByRole("button", { name:"Calendar", exact:true }).click();
  await expect(page.locator('[data-calendar-block-id="10000"]:visible')).toBeVisible();
  await page.getByRole("button", { name:"New block", exact:true }).click();
  const editor = page.getByLabel("Schedule block editor");
  await expect(editor).toBeVisible();
  await editor.locator('input[type="text"]').first().fill("Sleep");
  if (await editor.locator('input[type="datetime-local"]').count()) {
    await editor.locator('input[type="datetime-local"]').first().fill("2026-09-17T22:00");
  } else {
    await editor.getByLabel("Start date", {exact:true}).fill("2026-09-17");
    await editor.getByLabel("Start time", {exact:true}).fill("22:00");
  }
  await editor.getByRole("button", {name:/^Sleep.*8h 30m/}).click();
  if (await editor.getByLabel("Tag", {exact:true}).count()) await editor.getByLabel("Tag", {exact:true}).selectOption("3");
  const scroller = page.locator(".calendar-grid .hidden.md\\:flex > .overflow-y-auto");
  await scroller.evaluate(el => { el.scrollTop = 8 * 50; });
  await page.screenshot({path:`artifacts/design-audit/round-${process.env.AUDIT_ROUND || "1"}-${test.info().project.name}.png`, animations:"disabled"});
  await expect(page.locator(".calendar-brand")).toHaveText("Kairos");
  if (Number(process.env.AUDIT_ROUND || "1") < 5) return;
  const title = page.locator('[data-calendar-block-id="10000"]:visible .calendar-event-title');
  await expect(title).toHaveCSS("font-size","13px");
  await expect(title).toHaveCSS("color","rgb(23, 103, 151)");
  await expect(page.locator('[data-calendar-block-id="10000"]:visible .calendar-event')).toHaveCSS("background-color","rgba(0, 0, 0, 0)");
  await expect(page.locator('[data-calendar-block-id="10014"]:visible .calendar-event')).toHaveCSS("background-color","rgb(241, 248, 237)");
  await expect(page.locator(".calendar-now-label")).toHaveText("16:30");
  await expect(page.locator(".calendar-tag-row")).toHaveCount(5);
  await editor.getByRole("button", {name:"Manage",exact:true}).click();
  await editor.getByRole("button", {name:"Edit Sleep",exact:true}).click();
  await page.screenshot({path:`artifacts/design-audit/round-5-presets-${test.info().project.name}.png`, animations:"disabled"});
  await editor.getByRole("button", {name:"Done",exact:true}).click();
  await editor.getByRole("button", {name:"Manage tags",exact:true}).click();
  await page.getByRole("button", {name:"ADD NEW TAG",exact:true}).click();
  for (const color of ["#55B7FA","#65C65A","#FF69AC","#FFCC49"]) await expect(page.getByRole("button",{name:"Use tag color "+color,exact:true})).toBeVisible();
  await page.screenshot({path:`artifacts/design-audit/round-5-palette-${test.info().project.name}.png`, animations:"disabled"});
});
