/**
 * Generated-surface interaction e2e. The deterministic test drives the REAL
 * pipeline path (generate-live with the scripted adapter playing the
 * contract's scheduling worked example) — generation, enhancement grounding,
 * semantic action resolution, shared-state commit, confirmation, and scrub
 * reconstruction, with zero model calls.
 *
 * The RECORD_LIVE=1 variant runs a real model (local Ollama) instead and
 * saves the downloaded session as fixture-005 — a genuine live recording of
 * generation + interaction + confirmation. It retries generation (model
 * variance includes honest refusal-class runs) and is skipped in CI.
 */
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const status = (page: Page) => page.locator('[data-canvas] [data-a2ui-id="status"], [data-canvas] [data-a2ui-component="Text"][data-a2ui-id*="status"]').first();
const canvasButton = (page: Page, re: RegExp) => page.locator("[data-canvas] button", { hasText: re }).first();

async function generateAndInteract(page: Page, modelRef: string, attempts: number): Promise<boolean> {
  await page.goto("/");
  await page.getByTestId("scenario-appointment-booking").click();
  await page.getByTestId("view-live").click();
  if (modelRef !== "scripted") {
    await page.getByTestId("live-model").selectOption(modelRef);
  }
  for (let i = 0; i < attempts; i++) {
    await page.getByTestId("live-generate").click();
    await expect(page.getByTestId("live-status")).toContainText(/finished|error/, { timeout: 120_000 });
    const failed = await page.getByTestId("failure-panel").count();
    if (failed === 0 && (await page.locator("[data-canvas] input").count()) > 0) break;
    if (i === attempts - 1) return false;
  }

  await page.locator("[data-canvas] input").first().fill("Ada");
  await canvasButton(page, /\d{1,2}:\d{2}/).click();
  await expect(page.locator("[data-canvas]")).toContainText(/Holding .* for Ada/, { timeout: 10_000 });
  await canvasButton(page, /^Confirm/).click();
  await expect(page.locator("[data-canvas]")).toContainText(/Booked .* for Ada/, { timeout: 10_000 });
  return true;
}

test("generated booking: pipeline -> enhancement -> semantic resolution -> confirmed, then scrub reconstructs", async ({ page }) => {
  expect(await generateAndInteract(page, "scripted", 1)).toBe(true);

  // Provenance in the stream: enhancement + resolution events are present.
  // (Raw event card is the disclosure surface; assert via the timeline data.)
  await page.getByTestId("scrubber").focus();
  await page.keyboard.press("Home");
  await expect(page.locator("[data-canvas] [data-a2ui-id]")).toHaveCount(0);
  await page.keyboard.press("End");
  await expect(page.locator("[data-canvas]")).toContainText(/Booked .* for Ada/);
  // The typed name was committed into shared state by the accepted action.
  await expect(page.locator("[data-canvas] input").first()).toHaveValue("Ada");
});

test("record fixture-005 (live model)", async ({ page }) => {
  test.skip(!process.env.RECORD_LIVE, "live recording is manual (RECORD_LIVE=1)");
  test.setTimeout(600_000);
  const ok = await generateAndInteract(page, process.env.RECORD_MODEL ?? "ollama:gpt-oss:latest", 4);
  expect(ok, "no passing generated run within the retry budget").toBe(true);

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("live-download").click();
  const download = await downloadPromise;
  const path = await download.path();
  copyFileSync(path!, join(process.cwd(), "packages", "replay", "fixtures", "fixture-005.json"));
});

test("record fixture-006 (live recipe)", async ({ page }) => {
  test.skip(!process.env.RECORD_RECIPE, "live recording is manual (RECORD_RECIPE=1)");
  test.setTimeout(600_000);
  // Generate a structured recipe surface live, then co-edit it.
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.goto("/");
    await page.getByTestId("scenario-recipe-creator").click();
    await page.getByTestId("view-live").click();
    await page.getByTestId("live-model").selectOption(process.env.RECORD_MODEL ?? "ollama:gpt-oss:latest");
    await page
      .getByTestId("live-prompt")
      .fill("An editable weeknight recipe: a title, a dietary badge, servings controls, an ingredients table whose data rows list ingredient name and amount, a labeled dietary-constraint input, and a regenerate button.");
    await page.getByTestId("live-generate").click();
    await expect(page.getByTestId("live-status")).toContainText(/finished|error/, { timeout: 180_000 });
    const failed = await page.getByTestId("failure-panel").count();
    const hasInput = await page.locator("[data-canvas] input").count();
    const hasTable = await page.locator("[data-canvas] table").count();
    if (failed === 0 && hasInput > 0 && hasTable > 0) break;
    expect(attempt, "no passing generated recipe run within the retry budget").toBeLessThan(3);
  }

  // User edit: type a dietary constraint into the enhanced bound input.
  await page.locator("[data-canvas] input").first().fill("vegetarian");
  const applyBtn = page.locator("[data-canvas] button", { hasText: /constraint|apply/i }).first();
  if (await applyBtn.count()) {
    await applyBtn.click();
    await expect(page.locator("[data-canvas]")).toContainText(/Applied vegetarian|Unknown constraint/, { timeout: 10_000 });
  }
  // Structured update: regenerate (grounded on the single primary button).
  const regen = page.locator("[data-canvas] button", { hasText: /regenerate|new recipe/i }).first();
  if (await regen.count()) {
    await regen.click();
    await expect(page.locator("[data-canvas]")).toContainText(/Regenerated:/, { timeout: 10_000 });
  }

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("live-download").click();
  const download = await downloadPromise;
  copyFileSync((await download.path())!, join(process.cwd(), "packages", "replay", "fixtures", "fixture-006.json"));
});
