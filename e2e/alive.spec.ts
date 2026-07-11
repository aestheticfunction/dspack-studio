/**
 * Alive by default: a first visit auto-plays the flagship recording (the
 * canvas builds itself without a click); visitors who prefer reduced motion
 * get the finished surface immediately instead of playback.
 */
import { expect, test } from "@playwright/test";

test.describe("no motion preference", () => {
  test.use({ contextOptions: { reducedMotion: "no-preference" } });
  test("the homepage recording plays itself", async ({ page }) => {
    await page.goto("/");
    // No clicks: the run advances on its own (recorded pacing).
    await expect(page.getByTestId("play")).toContainText("pause");
    await expect(page.locator("[data-canvas] [data-a2ui-id]").first()).toBeVisible({ timeout: 60_000 });
  });
});

test("reduced motion lands on the finished surface, no playback", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-canvas] [data-a2ui-id]").first()).toBeVisible();
  await expect(page.getByTestId("play")).toContainText("replay");
});
