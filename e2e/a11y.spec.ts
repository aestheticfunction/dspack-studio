/**
 * Automated accessibility smoke (axe-core) across the MVP views. Automation
 * is a floor, not the audit: the release checklist keeps the manual keyboard
 * and screen-reader passes. Rules relying on page-level context that the
 * static-export shell doesn't control (landmark/region placement) are
 * reviewed manually instead.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const scan = (page: Page) =>
  new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .disableRules(["region"]) // single-app shell; landmarks reviewed manually
    .analyze();

test("replay view (fixture loaded, scrubbed) has no axe violations", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("fixture-argues-back").click();
  await page.getByTestId("scrubber").focus();
  await page.keyboard.press("End");
  const results = await scan(page);
  expect(results.violations).toEqual([]);
});

test("inspector open (all tabs reachable) has no axe violations", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("scrubber").focus();
  await page.keyboard.press("End");
  await page.getByTestId("inspector-open").click();
  await page.getByTestId("inspector-tab-events").click();
  const results = await scan(page);
  expect(results.violations).toEqual([]);
});

test("live view and break-it view have no axe violations", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("view-live").click();
  expect((await scan(page)).violations).toEqual([]);
  await page.getByTestId("view-break").click();
  expect((await scan(page)).violations).toEqual([]);
});

test("timeline is keyboard-operable end to end", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("scrubber").focus();
  await page.keyboard.press("End");
  await expect(page.getByTestId("audit-outcome")).toBeVisible();
  await page.keyboard.press("Home");
  await expect(page.getByTestId("audit-outcome")).toHaveCount(0);
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("inspector-open")).toBeVisible();
});
