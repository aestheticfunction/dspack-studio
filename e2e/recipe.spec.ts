/**
 * Recipe-creator e2e: co-editing on shared infrastructure — servings rescale
 * the delivered table, constraints validate with recoverable rejections and
 * swap ingredients, regenerate cycles variants, and the whole session scrubs.
 * Deterministic (local responder, zero model calls).
 */
import { expect, test, type Page } from "@playwright/test";

const canvas = (page: Page) => page.locator("[data-canvas]");
const byLabel = (page: Page, t: string | RegExp) => page.locator("[data-canvas] button", { hasText: t }).first();

async function startRecipe(page: Page) {
  await page.goto("/");
  await page.getByTestId("scenario-recipe-creator").click();
  await page.getByTestId("view-live").click();
  await page.getByTestId("live-run").click();
  await expect(canvas(page)).toContainText("Edit servings or add a constraint.", { timeout: 15_000 });
  await expect(canvas(page)).toContainText("Spaghetti");
}

test("servings co-editing rescales the ingredients table", async ({ page }) => {
  await startRecipe(page);
  await expect(canvas(page)).toContainText("180 g"); // 90g x 2
  await byLabel(page, "More servings").click();
  await expect(canvas(page)).toContainText("Scaled to 3 servings.");
  await expect(canvas(page)).toContainText("270 g");
  await expect(canvas(page)).toContainText("Servings: 3");
});

test("constraint validation rejects unknowns recoverably, then applies a valid one", async ({ page }) => {
  await startRecipe(page);
  await page.locator("[data-canvas] input").first().fill("keto");
  await byLabel(page, "Apply constraint").click();
  await expect(canvas(page)).toContainText("Unknown constraint. Try: vegetarian, vegan, gluten-free.");
  await expect(canvas(page)).toContainText("Pancetta"); // unchanged

  await page.locator("[data-canvas] input").first().fill("vegetarian");
  await byLabel(page, "Apply constraint").click();
  await expect(canvas(page)).toContainText("Applied vegetarian");
  await expect(canvas(page)).toContainText("Smoked tofu");
  await expect(canvas(page)).not.toContainText("Pancetta");
});

test("regenerate cycles variants and the session scrubs back to the start", async ({ page }) => {
  await startRecipe(page);
  await byLabel(page, "Regenerate recipe").click();
  await expect(canvas(page)).toContainText("Lemon herb risotto");
  await expect(canvas(page)).toContainText("Arborio rice");

  await page.getByTestId("scrubber").focus();
  await page.keyboard.press("Home");
  await expect(page.locator("[data-canvas] [data-a2ui-id]")).toHaveCount(0);
  await page.keyboard.press("End");
  await expect(canvas(page)).toContainText("Lemon herb risotto");

  // Session export: the co-edited run downloads as a fixture.
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("live-download").click();
  expect((await downloadPromise).suggestedFilename()).toBe("session.fixture.json");
});
