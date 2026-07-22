/**
 * Hotel reservations: the transactional-review scenario, replay-first,
 * against the static export. Both fixtures are mode:"live" recordings
 * (gpt-oss via Ollama) — nothing here is hand-scripted content.
 *
 * The governance story: a review presents named options as selectable cards
 * in a list, compared on metadata attributes, with one explicit committing
 * action — a platform vocabulary (plan pickers, product comparison) that
 * this hotel scenario validates, not the other way round.
 */
import { expect, test, type Page } from "@playwright/test";

const scrubber = (page: Page) => page.getByTestId("scrubber");

async function scrubToEnd(page: Page) {
  await scrubber(page).focus();
  await page.keyboard.press("End");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("hotel-reservations is a ready, selectable scenario on the shelf", async ({ page }) => {
  const shelf = page.getByTestId("scenario-hotel-reservations");
  await expect(shelf).not.toContainText("(planned)");
  await shelf.click();
  await expect(page.getByTestId("fixture-argues-back")).toBeVisible();
  await expect(page.getByTestId("fixture-clean")).toBeVisible();
});

test("clean replay: three named options, attributes as metadata, one action", async ({ page }) => {
  await page.getByTestId("scenario-hotel-reservations").click();
  await page.getByTestId("fixture-clean").click();
  await expect(page.getByTestId("fixture-meta")).toContainText("live run");
  await scrubToEnd(page);
  await expect(page.getByTestId("audit-outcome")).toContainText("passed");
  const canvas = page.locator("[data-canvas]");
  // SelectableCard labels surface as accessible names (checkbox semantics).
  await expect(canvas.getByRole("checkbox", { name: "Hotel Belém" })).toBeVisible();
  await expect(canvas).toContainText("Best value");
  await expect(canvas).toContainText("Book now");
});

test("repair replay: a bare apology caught by the review rules, options ship", async ({ page }) => {
  await page.getByTestId("scenario-hotel-reservations").click();
  await page.getByTestId("fixture-argues-back").click();
  await scrubToEnd(page);
  const ticker = page.getByTestId("gate-ticker");
  await expect(ticker).toContainText(/attempt 0:\s*S1✓\s*S2✓\s*S3✗\s*→ repair/);
  await expect(ticker).toContainText(/attempt 1:\s*S1✓\s*S2✓\s*S3✓/);
  await expect(ticker).toContainText("outcome passed");
  // The design system won: the apology became a comparison.
  const canvas = page.locator("[data-canvas]");
  await expect(canvas.getByRole("checkbox", { name: "Ritz-Carlton Lisboa" })).toBeVisible();
  await expect(canvas).toContainText("Book Hotel");
});

test("permalink: a hotel-reservations deep link resolves", async ({ page }) => {
  await page.goto("/#s=hotel-reservations&f=clean");
  await page.reload();
  await expect(page.getByTestId("fixture-meta")).toContainText("live run");
  await expect(page.getByTestId("link-error")).toHaveCount(0);
});
