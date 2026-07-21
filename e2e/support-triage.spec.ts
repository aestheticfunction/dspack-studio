/**
 * Support-ticket triage: the record-collection scenario, replay-first,
 * against the static export. Both fixtures are mode:"live" recordings
 * (gpt-oss via Ollama) — nothing here is hand-scripted content.
 *
 * The governance story this scenario carries: the contract steers structural
 * component choice — collections render as tables (rule.record-collection-
 * requires-table), and a data-driven table must carry its rows
 * (rule.table-carries-data).
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

test("support-triage is a ready, selectable scenario on the shelf", async ({ page }) => {
  const shelf = page.getByTestId("scenario-support-triage");
  await expect(shelf).not.toContainText("(planned)");
  await shelf.click();
  await expect(page.getByTestId("fixture-argues-back")).toBeVisible();
  await expect(page.getByTestId("fixture-clean")).toBeVisible();
});

test("clean replay: a live run straight through the gates to a filled table", async ({ page }) => {
  await page.getByTestId("scenario-support-triage").click();
  await page.getByTestId("fixture-clean").click();
  await expect(page.getByTestId("fixture-meta")).toContainText("live run");
  await scrubToEnd(page);
  await expect(page.getByTestId("audit-outcome")).toContainText("passed");
  // The recorded table renders with its rows — the whole point of the
  // required-props grammar fix; an empty table shell would fail here.
  const canvas = page.locator("[data-canvas]");
  await expect(canvas).toContainText("Status");
  await expect(canvas).toContainText("Priority");
  await expect(canvas).toContainText("2 urgent");
});

test("repair replay: prose list caught by the table rule, repaired surface ships", async ({ page }) => {
  await page.getByTestId("scenario-support-triage").click();
  await page.getByTestId("fixture-argues-back").click();
  await scrubToEnd(page);
  const ticker = page.getByTestId("gate-ticker");
  await expect(ticker).toContainText(/attempt 0:\s*S1✓\s*S2✓\s*S3✗\s*→ repair/);
  await expect(ticker).toContainText(/attempt 1:\s*S1✓\s*S2✓\s*S3✓/);
  await expect(ticker).toContainText("outcome passed");
  // The design system won: the prose list came back as a filled table.
  await expect(page.locator("[data-canvas]")).toContainText("Ticket");
});

test("permalink: a support-triage deep link resolves", async ({ page }) => {
  await page.goto("/#s=support-triage&f=clean");
  await page.reload();
  await expect(page.getByTestId("fixture-meta")).toContainText("live run");
  await expect(page.getByTestId("link-error")).toHaveCount(0);
});
