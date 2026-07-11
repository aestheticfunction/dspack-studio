/**
 * Pipeline-view e2e: the stage-flow panel is synchronized to the timeline
 * playhead, closed by default, and highlights ONLY the layers the current
 * event involves (a gate verdict never lights the render stages; the
 * delivery lights them all). Runs against fixture-001 (recorded real run).
 */
import { expect, test, type Page } from "@playwright/test";

const jumpTo = (page: Page, index: number, label: string) =>
  page.getByRole("button", { name: `jump to event ${index}: ${label}` }).click();

const involved = (page: Page) => page.locator('[data-testid="pipeline-view"] [data-involved]');
const stage = (page: Page, id: string) => page.locator(`[data-testid="pipeline-view"] [data-stage="${id}"]`);

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("closed by default, opens on demand, follows the playhead", async ({ page }) => {
  await jumpTo(page, 3, "dspack.gates");
  const details = page.getByTestId("pipeline-view");
  await expect(details).toBeVisible();
  await expect(details.locator("[data-stage]").first()).not.toBeVisible(); // closed

  await details.locator("summary").click();
  // A gate verdict lives in the agent and rides the wire — nothing renders.
  await expect(involved(page)).toHaveCount(2);
  await expect(stage(page, "agent")).toHaveAttribute("data-involved", "true");
  await expect(stage(page, "agui")).toHaveAttribute("data-involved", "true");
  await expect(stage(page, "astryx")).not.toHaveAttribute("data-involved", "true");
  await expect(page.getByTestId("pipeline-what")).toContainText(/S1\/S2\/S3/);

  // Scrub to the delivery: the one event that crosses every layer.
  await jumpTo(page, 17, "TOOL_CALL_RESULT");
  await expect(involved(page)).toHaveCount(6);
  await expect(stage(page, "astryx")).toHaveAttribute("data-involved", "true");
  await expect(stage(page, "you")).not.toHaveAttribute("data-involved", "true");
  await expect(page.getByTestId("pipeline-correlations")).toContainText("surfaceId");
});

test("repair and lifecycle events stay off the render stages", async ({ page }) => {
  await jumpTo(page, 5, "dspack.repair");
  await page.getByTestId("pipeline-view").locator("summary").click();
  await expect(involved(page)).toHaveCount(2);
  await expect(page.getByTestId("pipeline-what")).toContainText(/repair message/);

  await jumpTo(page, 19, "RUN_FINISHED");
  await expect(involved(page)).toHaveCount(2);
  await expect(page.getByTestId("pipeline-what")).toContainText(/lifecycle/);
});
