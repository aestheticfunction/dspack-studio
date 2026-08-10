/**
 * FM-10 groundwork e2e. The honesty check generalizes FM-5's claim: replay
 * the SAME fixture under both design systems and the downloaded receipt hash
 * is IDENTICAL — structure, events, gates, and audit are untouched by which
 * design system renders — while the rendered DOM demonstrably differs.
 */
import { expect, test, type Page } from "@playwright/test";

const scrubToEnd = async (page: Page) => {
  await page.getByTestId("scrubber").focus();
  await page.keyboard.press("End");
};

async function receiptHash(page: Page): Promise<string> {
  await scrubToEnd(page);
  await page.getByTestId("receipt-summary").click();
  const hash = (await page.getByTestId("receipt-hash").textContent())!.trim();
  await page.getByTestId("receipt-summary").click();
  return hash;
}

test("honesty: the receipt hash is identical under both design systems; the pixels are not", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("scenario-project-deletion").click();
  const astryxHash = await receiptHash(page);
  // Astryx is the default: the canvas carries no shadcn scope.
  await expect(page.locator("section[data-canvas][data-design-system=shadcn]")).toHaveCount(0);
  const astryxDialogMarkup = await page.locator("[data-a2ui-component=AlertDialog]").innerHTML();

  // Swap the design system in the restyle view (shell-level state).
  await page.getByTestId("view-canvas").click();
  await page.getByTestId("design-system-shadcn").click();
  await expect(page.getByTestId("design-system-note")).toContainText("All 12 catalog components render");

  // Back in replay, the same run renders through shadcn/ui.
  await page.getByTestId("view-replay").click();
  const scoped = page.locator("section[data-canvas][data-design-system=shadcn]");
  await expect(scoped).toHaveCount(1);
  const shadcnDialog = scoped.locator("[data-a2ui-component=AlertDialog]");
  await expect(shadcnDialog.locator("[role=alertdialog]")).toBeVisible();
  const shadcnDialogMarkup = await shadcnDialog.innerHTML();
  expect(shadcnDialogMarkup).not.toBe(astryxDialogMarkup);
  // The governed content is design-system-independent: the repaired label
  // survives the swap (fixture-001's argue-back ends in "Delete Account").
  await expect(shadcnDialog).toContainText("Delete Account");

  // The receipt is untouched by the swap: identical hash, byte for byte.
  const shadcnHash = await receiptHash(page);
  expect(shadcnHash).toBe(astryxHash);
});

test("x-ray provenance works identically under shadcn", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("view-canvas").click();
  await page.getByTestId("design-system-shadcn").click();
  await page.getByTestId("view-replay").click();
  await scrubToEnd(page);
  const tagged = page.locator("section[data-canvas] [data-a2ui-id]");
  // Web-first assertion: poll until the replay finishes painting the tagged
  // nodes. A one-shot `count()` snapshot races the render and flakes on CI.
  await expect(tagged.first()).toBeVisible();
  await page.getByTestId("xray-toggle").click();
  await tagged.first().click();
  await expect(page.getByTestId("xray-card")).toBeVisible();
});

test("the restyle view swaps systems honestly: note, caption, and the theme dial's scope", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("view-canvas").click();
  // Astryx: the theme dial applies (its themes are Astryx's own).
  await expect(page.getByRole("button", { name: "butter" })).toBeVisible();
  await page.getByTestId("design-system-shadcn").click();
  // shadcn: Astryx themes do not pretend to apply to another design system.
  await expect(page.getByRole("button", { name: "butter" })).toHaveCount(0);
  await expect(page.getByTestId("fm5-caption")).toContainText("Only the design system did");
  await expect(page.getByTestId("design-system-note")).toContainText("All 12 catalog components render");
  await page.getByTestId("design-system-astryx").click();
  await expect(page.getByRole("button", { name: "butter" })).toBeVisible();
  await expect(page.getByTestId("fm5-caption")).toContainText("Only the design system's theme did");
});
