/**
 * Live-mode e2e: the browser runs the governed pipeline through apps/agent
 * over AG-UI, with the deterministic scripted adapter — the full live loop
 * (stream -> progressive timeline -> render -> scrub -> run again) with zero
 * model calls.
 */
import { expect, test, type Page } from "@playwright/test";

const canvasComponents = (page: Page) => page.locator("[data-canvas] [data-a2ui-id]");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  // The governed live loop (gates + audit outcome) is the non-interactive
  // project-deletion run; it is no longer the default scenario.
  await page.getByTestId("scenario-project-deletion").click();
  await page.getByTestId("view-live").click();
});

test("live run: stream, render, outcome — then scrub the completed run", async ({ page }) => {
  await page.getByTestId("live-run").click();
  await expect(page.getByTestId("live-status")).toContainText("finished", { timeout: 15_000 });
  await expect(canvasComponents(page).first()).toBeVisible();
  await expect(page.getByTestId("gate-ticker")).toContainText("outcome passed");

  // The completed live run is a fixture being written: scrub it backward.
  await page.getByTestId("scrubber").focus();
  await page.keyboard.press("Home");
  await expect(canvasComponents(page)).toHaveCount(0);
  await page.keyboard.press("End");
  await expect(canvasComponents(page).first()).toBeVisible();
});

test("live run: immediately start another run", async ({ page }) => {
  await page.getByTestId("live-run").click();
  await expect(page.getByTestId("live-status")).toContainText("finished", { timeout: 15_000 });
  await page.getByTestId("live-run").click(); // "run again"
  await expect(page.getByTestId("live-status")).toContainText("finished", { timeout: 15_000 });
  await expect(canvasComponents(page).first()).toBeVisible();
});

test("live run: reset clears the timeline and download offers the session fixture", async ({ page }) => {
  await page.getByTestId("live-run").click();
  await expect(page.getByTestId("live-status")).toContainText("finished", { timeout: 15_000 });

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("live-download").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("session.fixture.json");

  await page.getByTestId("live-reset").click();
  await expect(page.getByTestId("live-status")).toContainText("ready");
  await expect(page.getByTestId("scrubber")).toHaveCount(0);
});
