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
  test.setTimeout(900_000);
  // Retry-until-representative: the WHOLE story must play on a real run —
  // generated surface with a table + constraint input, enhancement grounds
  // the apply/regenerate buttons, the constraint round-trip visibly lands,
  // regenerate visibly lands. Runs whose surface can't carry the story
  // (model variance: no apply button, no status caption) are discarded and
  // regenerated — never patched.
  let recorded = false;
  for (let attempt = 0; attempt < 6 && !recorded; attempt++) {
    await page.goto("/");
    await page.getByTestId("scenario-recipe-creator").click();
    await page.getByTestId("view-live").click();
    await page.getByTestId("live-model").selectOption(process.env.RECORD_MODEL ?? "ollama:gpt-oss:latest");
    await page
      .getByTestId("live-prompt")
      .fill("An editable weeknight recipe: a title, a dietary badge, servings controls, an ingredients table whose data rows list ingredient name and amount, a numbered cooking-instructions table whose columns are Step and Instruction, a labeled dietary-constraint input, an apply-constraint button, a status line, and a regenerate button.");
    await page.getByTestId("live-generate").click();
    await expect(page.getByTestId("live-status")).toContainText(/finished|error/, { timeout: 180_000 });

    const failed = await page.getByTestId("failure-panel").count();
    const hasInput = await page.locator("[data-canvas] input").count();
    const hasTable = await page.locator("[data-canvas] table").count();
    const applyBtn = page.locator("[data-canvas] button", { hasText: /constraint|apply/i }).first();
    const regenBtn = page.locator("[data-canvas] button", { hasText: /regenerate|new recipe/i }).first();
    if (failed > 0 || !hasInput || !hasTable || !(await applyBtn.count()) || !(await regenBtn.count())) continue;
    // A full recipe from the first frame: the enhancement seeds ingredients
    // and numbered instructions before any interaction.
    if (!(await page.locator("[data-canvas] table td", { hasText: /al dente/i }).count())) continue;
    if (!(await page.locator("[data-canvas] table td", { hasText: /Spaghetti/i }).count())) continue;

    // User edit: type a dietary constraint into the enhanced bound input,
    // then apply it (the action context carries the bound value).
    await page.locator("[data-canvas] input").first().fill("vegetarian");
    await applyBtn.click();
    try {
      // Visible feedback requires the enhancement to have bound a status
      // caption; surfaces without one aren't representative — regenerate.
      await expect(page.locator("[data-canvas]")).toContainText(/Applied vegetarian/, { timeout: 10_000 });
      // The grounded co-edit lands rows ON THE RENDERED TABLE (the enhancer
      // retargets updates to the generated table's id).
      await expect(page.locator("[data-canvas] table td", { hasText: /Smoked tofu|Vegetable stock|GF /i }).first()).toBeVisible({ timeout: 10_000 });
      // Instructions must be part of the story: numbered steps render (from
      // the model's own table or the labeled enhancement) and the constraint
      // rewrote the matching step text.
      await expect(page.locator("[data-canvas] table td", { hasText: /cook the Smoked tofu/i }).first()).toBeVisible({ timeout: 10_000 });
      // Structured update: regenerate (grounded on the single primary button).
      await regenBtn.click();
      await expect(page.locator("[data-canvas]")).toContainText(/Regenerated:/, { timeout: 10_000 });
      // The regenerated dish carries its own steps (variant 1: risotto).
      await expect(page.locator("[data-canvas] table td", { hasText: /ladle at a time/i }).first()).toBeVisible({ timeout: 10_000 });
    } catch {
      continue;
    }
    recorded = true;
  }
  expect(recorded, "no representative generated recipe run within the retry budget").toBe(true);

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("live-download").click();
  const download = await downloadPromise;
  copyFileSync((await download.path())!, join(process.cwd(), "packages", "replay", "fixtures", "fixture-006.json"));
});
