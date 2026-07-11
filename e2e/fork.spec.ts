/**
 * FM-3 fork e2e: fork a recorded run at a timeline moment into a NEW run
 * with parent provenance; the original is untouched; pre-surface moments
 * cannot be forked; a downloaded fork reopens through the normal session
 * import with provenance intact.
 */
import { expect, test, type Page } from "@playwright/test";

const scrubToEnd = async (page: Page) => {
  await page.getByTestId("scrubber").focus();
  await page.keyboard.press("End");
};

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  // Forks fixture-001 (project-deletion argue-back), no longer the default.
  await page.getByTestId("scenario-project-deletion").click();
  // Selecting a scenario auto-plays its first recording (under reduced motion,
  // straight to the delivered surface). Wait for that to settle so the tests
  // manipulate the timeline from a known state, not mid-mount.
  await expect(page.getByTestId("fork")).toBeEnabled();
});

test("fork is refused before any surface exists, allowed after the delivery", async ({ page }) => {
  // Rewind to before anything happened: nothing to fork yet.
  await page.getByTestId("scrubber").focus();
  await page.keyboard.press("Home");
  await expect(page.getByTestId("fork")).toBeDisabled();
  // Scrub to a pre-delivery event: still no application state.
  await page.getByRole("button", { name: "jump to event 3: dspack.gates" }).click();
  await expect(page.getByTestId("fork")).toBeDisabled();
  // From the delivery onward, forking opens up.
  await page.getByRole("button", { name: "jump to event 17: TOOL_CALL_RESULT" }).click();
  await expect(page.getByTestId("fork")).toBeEnabled();
});

test("forking creates a labeled new run and never mutates the original", async ({ page }) => {
  await page.getByRole("button", { name: "jump to event 17: TOOL_CALL_RESULT" }).click();
  await page.getByTestId("fork").click();

  // The fork is selected: its own identity, prefix-only events, provenance.
  await expect(page.getByTestId("fork-17")).toBeVisible();
  await expect(page.getByTestId("fixture-meta")).toContainText("⑂");
  await expect(page.getByTestId("fixture-meta")).toContainText("forked at event 17");
  await expect(page.getByTestId("fixture-meta")).toContainText("18 events");
  await expect(page.getByTestId("fork-blurb")).toContainText("The original is untouched");

  // The forked prefix reconstructs the parent's surface at that moment.
  await scrubToEnd(page);
  await expect(page.locator("[data-canvas] [data-a2ui-id]").first()).toBeVisible();

  // Back on the parent: still the full 20-event run.
  await page.getByTestId("fixture-argues-back").click();
  await expect(page.getByTestId("fixture-meta")).toContainText("20 events");
});

test("a downloaded fork reopens through session import with provenance intact", async ({ page }) => {
  await scrubToEnd(page);
  await page.getByTestId("fork").click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("fork-download").click();
  const download = await downloadPromise;
  const path = await download.path();

  await page.getByTestId("import-input").setInputFiles(path!);
  await expect(page.getByTestId("fixture-meta")).toContainText("forked at event 19");
  await expect(page.getByTestId("fixture-meta")).toContainText("(imported)");
});
