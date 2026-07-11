/**
 * Permalink e2e: deep links reconstruct scenario, recording, timeline
 * moment, panel, and fork identity from the URL hash alone (static-hosting
 * safe); copy-link round-trips through a reload; malformed and unknown
 * links fail with the reason and fall back to a working default view.
 */
import { expect, test } from "@playwright/test";

test("a fixture deep link reconstructs scenario, moment, and open receipt", async ({ page }) => {
  await page.goto("/#s=recipe-creator&f=generated-cooked&e=19&panel=receipt");
  await expect(page.getByTestId("fixture-meta")).toContainText("live run, ollama:gpt-oss:latest");
  // Event 19 is the accepted vegetarian round-trip: its state is on screen.
  await expect(page.locator("[data-canvas]")).toContainText(/Applied vegetarian/);
  await expect(page.getByTestId("receipt").locator("[data-testid=receipt-hash]")).toBeVisible(); // panel opened by the link
});

test("a fork deep link reconstructs the fork from its bundled parent", async ({ page }) => {
  await page.goto("/#s=project-deletion&fork=argues-back@17&e=17");
  await expect(page.getByTestId("fork-17")).toBeVisible();
  await expect(page.getByTestId("fixture-meta")).toContainText("forked at event 17");
  await expect(page.getByTestId("fork-blurb")).toContainText("The original is untouched");
});

test("copy-link writes the URL and a reload reconstructs the same moment", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("scenario-project-deletion").click();
  await page.getByRole("button", { name: "jump to event 17: TOOL_CALL_RESULT" }).click();
  await page.getByTestId("xray-toggle").click();
  await page.getByTestId("copy-link").click();
  const hash = await page.evaluate(() => location.hash);
  expect(hash).toContain("s=project-deletion");
  expect(hash).toContain("e=17");
  expect(hash).toContain("x=1");

  await page.reload();
  await expect(page.locator("[data-canvas] [data-a2ui-id]").first()).toBeVisible(); // moment restored
  await expect(page.getByTestId("xray-toggle")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("xray-card")).toBeVisible();
});

test("malformed and unknown links fail clearly and fall back", async ({ page }) => {
  await page.goto("/#s=project-deletion&e=banana");
  await expect(page.getByTestId("link-error")).toContainText("did not parse");
  await expect(page.getByTestId("fixture-meta")).toBeVisible(); // default view still works

  await page.goto("/#s=hotel-reservations");
  await page.reload();
  await expect(page.getByTestId("link-error")).toContainText("unknown or not-yet-ready");

  await page.goto("/#s=project-deletion&f=nonexistent");
  await page.reload();
  await expect(page.getByTestId("link-error")).toContainText("no recording");
});
