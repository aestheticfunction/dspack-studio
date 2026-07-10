/**
 * Replay-mode e2e: the full studio experience against the static export with
 * recorded real runs as the backend. Covers playback, scrub forward, scrub
 * backward reconstruction (FM-2), clean-run rendering, repair-run rendering,
 * and the refusal/failure panel.
 *
 * All three fixtures are mode:"live" recordings (gemma4:e4b / gpt-oss via
 * local Ollama) — nothing here is hand-scripted content.
 */
import { expect, test, type Page } from "@playwright/test";

const scrubber = (page: Page) => page.getByTestId("scrubber");
const canvasComponents = (page: Page) => page.locator("[data-canvas] [data-a2ui-id]");

async function scrubToEnd(page: Page) {
  await scrubber(page).focus();
  await page.keyboard.press("End");
}

async function scrubToStart(page: Page) {
  await scrubber(page).focus();
  await page.keyboard.press("Home");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("playback: play streams the recorded run into a rendered surface", async ({ page }) => {
  await page.getByTestId("fixture-clean").click();
  await expect(page.getByTestId("fixture-meta")).toContainText("live run");
  await page.getByTestId("play").click();
  // Recorded gaps are capped at 2.5s; the 12-event clean run finishes well inside the timeout.
  await expect(canvasComponents(page).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("audit-outcome")).toContainText("passed", { timeout: 20_000 });
});

test("scrub forward: jumping to the end reconstructs the final state instantly", async ({ page }) => {
  await page.getByTestId("fixture-clean").click();
  await scrubToEnd(page);
  await expect(page.getByTestId("audit-outcome")).toContainText("outcome passed (exit 0)");
  await expect(canvasComponents(page).first()).toBeVisible();
});

test("scrub backward: the interface un-builds to the exact earlier state (FM-2)", async ({ page }) => {
  await page.getByTestId("fixture-clean").click();
  await scrubToEnd(page);
  await expect(canvasComponents(page).first()).toBeVisible();

  await scrubToStart(page);
  await expect(canvasComponents(page)).toHaveCount(0);
  await expect(page.getByTestId("audit-outcome")).toHaveCount(0);
  await expect(page.getByTestId("gate-ticker")).not.toContainText("attempt");
});

test("clean run: one attempt, every gate green, no repair", async ({ page }) => {
  await page.getByTestId("fixture-clean").click();
  await scrubToEnd(page);
  const ticker = page.getByTestId("gate-ticker");
  await expect(ticker).toContainText(/attempt 0:\s*S1✓\s*S2✓\s*S3✓/);
  await expect(ticker).not.toContainText("attempt 1");
  await expect(ticker).not.toContainText("repair");
  await expect(page.getByTestId("failure-panel")).toHaveCount(0);
});

test("repair run: two governed repairs, then the repaired dialog renders", async ({ page }) => {
  await page.getByTestId("fixture-argues-back").click();
  await scrubToEnd(page);
  const ticker = page.getByTestId("gate-ticker");
  await expect(ticker).toContainText(/attempt 0:\s*S1✓\s*S2✓\s*S3✗\s*→ repair/);
  await expect(ticker).toContainText(/attempt 1:\s*S1✓\s*S2✓\s*S3✗\s*→ repair/);
  await expect(ticker).toContainText(/attempt 2:\s*S1✓\s*S2✓\s*S3✓/);
  await expect(ticker).toContainText("outcome passed");
  // The design system won: the confirm action is specific, not the adversarial "OK".
  const canvas = page.locator("[data-canvas]");
  await expect(canvas).toContainText("Delete Account");
  await expect(canvas.locator('[data-a2ui-component="AlertDialog"]')).toBeVisible();
});

test("refusal run: the failure panel carries the emitter's verbatim refusal", async ({ page }) => {
  await page.getByTestId("fixture-refusal").click();
  await scrubToEnd(page);
  await expect(page.getByTestId("audit-outcome")).toContainText("failed-gate (exit 3)");
  const panel = page.getByTestId("failure-panel");
  await expect(panel).toContainText("The pipeline refused to ship this surface.");
  await expect(panel).toContainText("unknown component 'dropdown-menu'");
  // No surface shipped: the canvas stays empty, with the honest ending message.
  await expect(canvasComponents(page)).toHaveCount(0);
  await expect(page.getByTestId("canvas-empty")).toContainText("No surface shipped");
});
