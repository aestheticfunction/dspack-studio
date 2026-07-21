/**
 * First-visit tour auto-start, against the static artifact.
 *
 * Runs ONLY in the "first-run" Playwright project, which (unlike "studio")
 * seeds no storageState: every test here starts as a genuine first-time
 * visitor. The rest of the suite runs as a returning visitor by construction.
 */
import { expect, test } from "@playwright/test";

test("a first-time visitor lands in the tour, on a real recorded state", async ({ page }) => {
  await page.goto("/");

  // Step 1 of the tour: the failed gate moment of the real repair run —
  // the same state tour-xray-wire.spec.ts asserts after a manual start.
  await expect(page.getByTestId("tour-bar")).toBeVisible();
  await expect(page.getByTestId("tour-title")).toContainText("argues back");
  await expect(page.getByTestId("gate-ticker")).toContainText("S3✗");
});

test("the tour never recurs after dismissal, and stays restartable", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("tour-bar")).toBeVisible();
  await page.getByTestId("tour-skip").click();
  await expect(page.getByTestId("tour-bar")).toHaveCount(0);

  await page.reload();
  // A dismissed tour is remembered: the studio loads directly, with the
  // manual entry point still present.
  await expect(page.getByTestId("scenario-project-deletion")).toBeVisible();
  await expect(page.getByTestId("tour-bar")).toHaveCount(0);
  await expect(page.getByTestId("tour-start")).toBeVisible();
});

test("deep-linked first-time visitors are never hijacked by the tour", async ({ page }) => {
  await page.goto("/#s=project-deletion&f=clean&e=11");
  // The permalink resolves to its own state...
  await expect(page.getByTestId("gate-ticker")).toBeVisible();
  await expect(page.getByTestId("scenario-project-deletion")).toBeVisible();
  // ...and the tour stays out of the way.
  await expect(page.getByTestId("tour-bar")).toHaveCount(0);
});
