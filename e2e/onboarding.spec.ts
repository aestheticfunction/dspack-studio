/**
 * Signup / onboarding: the data-collection scenario, replay-first, against
 * the static export. All three fixtures are mode:"live" recordings (gpt-oss
 * via Ollama) — nothing here is hand-scripted content.
 *
 * The governance story, honestly split: labels were always enforced (the
 * universal rule.input-carries-label); what the new intent adds is
 * structural — an ask needs something to fill in and a way to send it
 * (rule.data-collection-requires-input-and-action).
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

test("onboarding is a ready, selectable scenario on the shelf", async ({ page }) => {
  const shelf = page.getByTestId("scenario-onboarding");
  await expect(shelf).not.toContainText("(planned)");
  await shelf.click();
  await expect(page.getByTestId("fixture-argues-back")).toBeVisible();
  await expect(page.getByTestId("fixture-clean")).toBeVisible();
  await expect(page.getByTestId("fixture-refusal")).toBeVisible();
});

test("clean replay: a live run straight through the gates to a labeled form", async ({ page }) => {
  await page.getByTestId("scenario-onboarding").click();
  await page.getByTestId("fixture-clean").click();
  await expect(page.getByTestId("fixture-meta")).toContainText("live run");
  await scrubToEnd(page);
  await expect(page.getByTestId("audit-outcome")).toContainText("passed");
  const canvas = page.locator("[data-canvas]");
  await expect(canvas).toContainText("Your name");
  await expect(canvas).toContainText("Email address");
  await expect(canvas).toContainText("Create account");
});

test("repair replay: a text-only ask caught by the form rule, repaired surface ships", async ({ page }) => {
  await page.getByTestId("scenario-onboarding").click();
  await page.getByTestId("fixture-argues-back").click();
  await scrubToEnd(page);
  const ticker = page.getByTestId("gate-ticker");
  await expect(ticker).toContainText(/attempt 0:\s*S1✓\s*S2✓\s*S3✗\s*→ repair/);
  await expect(ticker).toContainText(/attempt 1:\s*S1✓\s*S2✓\s*S3✓/);
  await expect(ticker).toContainText("outcome passed");
  // The design system won: the ask got its field and its action.
  const canvas = page.locator("[data-canvas]");
  await expect(canvas).toContainText("Email address");
  await expect(canvas).toContainText("Join now");
});

test("refusal replay: a non-signup ask meets the vocabulary's honest limit", async ({ page }) => {
  await page.getByTestId("scenario-onboarding").click();
  await page.getByTestId("fixture-refusal").click();
  await scrubToEnd(page);
  await expect(page.getByTestId("audit-outcome")).toContainText("failed-gate (exit 3)");
  const panel = page.getByTestId("failure-panel");
  await expect(panel).toContainText("unknown component 'dropdown-menu'");
  await expect(page.getByTestId("canvas-empty")).toContainText("No surface shipped");
});

test("permalink: an onboarding deep link resolves", async ({ page }) => {
  await page.goto("/#s=onboarding&f=clean");
  await page.reload();
  await expect(page.getByTestId("fixture-meta")).toContainText("live run");
  await expect(page.getByTestId("link-error")).toHaveCount(0);
});
