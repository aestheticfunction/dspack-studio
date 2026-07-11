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

test("an operation deep link opens the named view on the named scenario", async ({ page }) => {
  await page.goto("/#s=appointment-booking&v=break&bc=ambiguous-action");
  await expect(page.getByTestId("break-expected")).toContainText("studio.action.unresolved");
  // The scenario is the named one: its tagline is on screen.
  await expect(page.locator("main")).toContainText("Human-in-the-loop, live");
});

test("a cross-axis mismatch keeps the scenario and lands on its valid default", async ({ page }) => {
  // no-alertdialog belongs to project-deletion; the link names recipe-creator.
  // The scenario always wins: the condition never drags the scenario along.
  await page.goto("/#s=recipe-creator&v=break&bc=no-alertdialog");
  await expect(page.getByTestId("link-error")).toContainText("not a failure condition for Recipe creator");
  await expect(page.getByTestId("break-invalid-state")).toBeVisible();
  await expect(page.getByTestId("break-no-alertdialog")).toHaveCount(0);
  await expect(page.getByTestId("break-expected")).toContainText("studio.action.rejected");
});

test("an unknown view fails clearly and falls back to replay", async ({ page }) => {
  await page.goto("/#v=telepathy");
  await expect(page.getByTestId("link-error")).toContainText("unknown view 'telepathy'");
  await expect(page.getByTestId("fixture-meta")).toBeVisible(); // default view still works
});

test("a restyle deep link opens the theme dial", async ({ page }) => {
  await page.goto("/#s=appointment-booking&v=canvas");
  await expect(page.getByTestId("fm5-caption")).toBeVisible();
});

test("copy-link from a recorded catch round-trips through a reload", async ({ page }) => {
  // Agent blocked: the recorded catch is the offline break experience.
  await page.route("http://localhost:8787/**", (r) => r.abort());
  await page.route("http://127.0.0.1:8787/**", (r) => r.abort());
  await page.goto("/");
  await page.getByTestId("scenario-project-deletion").click();
  await page.getByTestId("view-break").click();
  await expect(page.getByTestId("break-recorded-note")).toBeVisible();
  await page.getByTestId("scrubber").focus();
  await page.keyboard.press("End");
  await page.getByTestId("copy-link").click();
  const hash = await page.evaluate(() => location.hash);
  expect(hash).toContain("s=project-deletion");
  expect(hash).toContain("v=break");
  expect(hash).toContain("bc=no-alertdialog");

  await page.reload();
  await expect(page.getByTestId("break-recorded-note")).toBeVisible();
  await expect(page.getByTestId("audit-outcome")).toContainText("passed"); // the linked moment is the run's ending
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
