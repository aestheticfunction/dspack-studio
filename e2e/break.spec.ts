/**
 * Break-it Mode e2e: curated failure conditions through the ordinary
 * pipeline, deterministic (scripted violating->repaired surfaces; no model
 * calls). Each condition's honest ending is asserted the way a visitor sees
 * it: gate ticker, failure panel, inspector lifecycles, import error.
 */
import { expect, test, type Page } from "@playwright/test";

/** Conditions live under their scenario; everything else is project-deletion's. */
const SCENARIO_FOR: Record<string, string> = {
  "ambiguous-action": "appointment-booking",
  "invalid-state": "recipe-creator",
};

async function openBreak(page: Page, conditionId: string) {
  await page.goto("/");
  await page.getByTestId(`scenario-${SCENARIO_FOR[conditionId] ?? "project-deletion"}`).click();
  await page.getByTestId("view-break").click();
  await page.getByTestId(`break-${conditionId}`).click();
}

test("break conditions are scoped to the active scenario", async ({ page }) => {
  await page.goto("/");
  // The default scenario is recipe-creator: its condition and the
  // scenario-independent import demo are offered; other scenarios' are not.
  await page.getByTestId("view-break").click();
  await expect(page.getByTestId("break-invalid-state")).toBeVisible();
  await expect(page.getByTestId("break-malformed-import")).toBeVisible();
  await expect(page.getByTestId("break-no-alertdialog")).toHaveCount(0);
  await expect(page.getByTestId("break-ambiguous-action")).toHaveCount(0);
  // Switching the scenario preserves the operation and re-scopes the list.
  await page.getByTestId("scenario-appointment-booking").click();
  await expect(page.getByTestId("break-ambiguous-action")).toBeVisible();
  await expect(page.getByTestId("break-invalid-state")).toHaveCount(0);
});

test("break view defaults to the active scenario's own condition", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("scenario-recipe-creator").click();
  await page.getByTestId("view-break").click();
  await expect(page.getByTestId("break-expected")).toContainText("studio.action.rejected");
});

test("no-alertdialog: S3 catches, repair lands, run passes", async ({ page }) => {
  await openBreak(page, "no-alertdialog");
  await expect(page.getByTestId("break-expected")).toContainText("rule.destructive-requires-alertdialog");
  await page.getByTestId("break-run").click();
  await expect(page.getByTestId("break-status")).toContainText("finished", { timeout: 20_000 });
  const ticker = page.getByTestId("gate-ticker");
  await expect(ticker).toContainText(/attempt 0:\s*S1✓\s*S2✓\s*S3✗\s*→ repair/);
  await expect(ticker).toContainText(/attempt 1:\s*S1✓\s*S2✓\s*S3✓/);
  await expect(ticker).toContainText("outcome passed");
  await expect(page.locator("[data-canvas]")).toContainText("Delete this project?");
});

test("malformed generation: repair budget exhausts, complete audit, exit 2", async ({ page }) => {
  await openBreak(page, "malformed-generation");
  await page.getByTestId("break-run").click();
  await expect(page.getByTestId("break-status")).toContainText("finished", { timeout: 20_000 });
  await expect(page.getByTestId("audit-outcome")).toContainText("failed-lint-exhausted (exit 2)");
  await expect(page.getByTestId("failure-panel")).toContainText("refused to ship");
});

test("unsupported component: lint-clean surface, emitter refusal with the verbatim reason", async ({ page }) => {
  await openBreak(page, "unsupported-component");
  await page.getByTestId("break-run").click();
  await expect(page.getByTestId("break-status")).toContainText("finished", { timeout: 20_000 });
  await expect(page.getByTestId("gate-ticker")).toContainText(/attempt 0:\s*S1✓\s*S2✓\s*S3✓/);
  // dspack-emit 0.4.0: a declared casualty refuses with the profile's
  // authored class + reason — the verbatim reason this test always wanted.
  await expect(page.getByTestId("failure-panel")).toContainText("'dropdown-menu' is a declared casualty");
});

test("ungroundable action: resolution rejects client-side, recorded as unresolved", async ({ page }) => {
  await openBreak(page, "ambiguous-action");
  await page.getByTestId("break-run").click();
  await expect(page.getByTestId("break-status")).toContainText("finished", { timeout: 20_000 });
  await page.getByTestId("break-dispatch").click();
  await page.getByTestId("inspector-open").click();
  await page.getByTestId("inspector-tab-actions").click();
  await expect(page.getByTestId("inspector-actions")).toContainText("unresolved");
  await expect(page.getByTestId("inspector-actions")).toContainText("mystery_action");
});

test("invalid shared state: agent rejects recoverably and the session continues", async ({ page }) => {
  await openBreak(page, "invalid-state");
  await page.getByTestId("break-run").click();
  await expect(page.getByTestId("break-status")).toContainText("finished", { timeout: 20_000 });
  await page.getByTestId("break-dispatch").click();
  await expect(page.locator("[data-canvas]")).toContainText("Unknown constraint. Try: vegetarian, vegan, gluten-free.");
  await page.getByTestId("inspector-open").click();
  await page.getByTestId("inspector-tab-actions").click();
  await expect(page.getByTestId("inspector-actions")).toContainText("rejected");
});

test("malformed import: the validator refuses with a clear error", async ({ page }) => {
  await openBreak(page, "malformed-import");
  await page.getByTestId("break-run").click();
  await expect(page.getByTestId("break-import-error")).toContainText("not valid JSON");
});
