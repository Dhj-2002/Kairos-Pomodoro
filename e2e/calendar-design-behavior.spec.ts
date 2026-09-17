import { test, expect, type Page } from "@playwright/test";

async function seed(page: Page) {
  await page.clock.setFixedTime(new Date("2026-09-17T16:30:00"));
  await page.setViewportSize({width:1584,height:993});
  await page.goto("/");
  await page.locator(".calendar-today-column").waitFor();
  await page.evaluate(() => (globalThis as unknown as {__seedDesignReference:()=>void}).__seedDesignReference());
  await page.getByRole("button", {name:"Timer",exact:true}).click();
  await page.getByRole("button", {name:"Calendar",exact:true}).click();
  await expect(page.locator('[data-calendar-block-id="10000"]:visible')).toBeVisible();
}

test("month navigation selects days without changing blocks; Today returns", async ({page}) => {
  await seed(page);
  const month = page.getByLabel("Month navigator");
  await month.getByRole("button",{name:"Next month",exact:true}).click();
  await expect(month.locator("header strong")).toHaveText("October 2026");
  await month.getByRole("button",{name:"Previous month",exact:true}).click();
  await month.getByRole("button",{name:"September 18, 2026",exact:true}).click();
  await expect(month.getByRole("button",{name:"September 18, 2026",exact:true})).toHaveAttribute("aria-pressed","true");
  await expect(page.locator(".calendar-tag-summary header")).toContainText("Fri, Sep 18");
  await page.locator(".calendar-month-heading").getByRole("button",{name:"Today",exact:true}).click();
  await expect(month.getByRole("button",{name:"September 17, 2026",exact:true})).toHaveAttribute("aria-pressed","true");
  await expect(page.locator('[data-calendar-block-id="10000"]:visible .calendar-event-time')).toHaveText("09:00 – 11:00");
});

test("50px hour scale retains resize, move, delete and suppresses accidental form opening", async ({page}) => {
  await seed(page);
  const block = page.locator('[data-calendar-block-id="10000"]:visible');
  const end = block.getByRole("button",{name:"Resize Research from end",exact:true});
  const edge = (await end.boundingBox())!;
  await page.mouse.move(edge.x+edge.width/2,edge.y+edge.height/2);
  await page.mouse.down();
  await page.mouse.move(edge.x+edge.width/2,edge.y+edge.height/2+25,{steps:5});
  await page.mouse.up();
  await expect(block.locator(".calendar-event-time")).toHaveText("09:00 – 11:30");
  await expect(page.getByLabel("Schedule block editor")).toHaveCount(0);
  const body = (await block.boundingBox())!;
  await page.mouse.move(body.x+body.width/2,body.y+25);
  await page.mouse.down();
  await page.mouse.move(body.x+body.width/2,body.y+75,{steps:5});
  await page.mouse.up();
  // Preserve Kairos's existing drop contract: the release slot becomes the
  // block's start (not a relative drag offset). 75px below 09:00 is 10:30.
  await expect(block.locator(".calendar-event-time")).toHaveText("10:30 – 13:00");
  await expect(page.getByLabel("Schedule block editor")).toHaveCount(0);
  await block.hover();
  await block.getByRole("button",{name:"Delete",exact:true}).click();
  await expect(page.locator('[data-calendar-block-id="10000"]')).toHaveCount(0);
});

test("saving an overnight draft renders both fragments with one stored identity", async ({page}) => {
  await seed(page);
  await page.getByRole("button",{name:"New block",exact:true}).click();
  const editor = page.getByLabel("Schedule block editor");
  await editor.getByLabel("Block title",{exact:true}).fill("Overnight audit");
  await editor.getByLabel("Start date",{exact:true}).fill("2026-09-17");
  await editor.getByLabel("Start time",{exact:true}).fill("22:00");
  await editor.getByRole("button",{name:"Sleep 8h 30m",exact:true}).click();
  await editor.getByRole("button",{name:"Create block",exact:true}).click();
  await expect(editor).toHaveCount(0);
  const fragments = page.locator('.hidden.md\\:flex [data-calendar-block-id]').filter({has:page.locator(".calendar-event-title",{hasText:"Overnight audit"})});
  await expect(fragments).toHaveCount(2);
  const ids = await fragments.evaluateAll(nodes=>nodes.map(n=>n.getAttribute("data-calendar-block-id")));
  expect(new Set(ids).size).toBe(1);
  await expect(fragments.first().locator(".calendar-event-time")).toHaveText("22:00 – 06:30");
  await expect(fragments.last().locator(".calendar-event-time")).toHaveText("22:00 – 06:30");
});
