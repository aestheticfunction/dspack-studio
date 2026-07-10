/**
 * Interactive-scenario + session-import e2e (deterministic: the booking
 * responder is local logic; no model calls).
 */
import { expect, test, type Page } from "@playwright/test";

const status = (page: Page) => page.locator('[data-a2ui-id="status"]');
const byLabel = (page: Page, t: string) => page.locator("[data-canvas] button", { hasText: t }).first();

async function startBooking(page: Page) {
  await page.goto("/");
  await page.getByTestId("scenario-appointment-booking").click();
  await page.getByTestId("view-live").click();
  await page.getByTestId("live-run").click();
  await expect(status(page)).toContainText("Pick a time to begin.", { timeout: 15_000 });
}

test("booking validation path: selecting a slot without a name is rejected", async ({ page }) => {
  await startBooking(page);
  await byLabel(page, "10:30").click();
  await expect(status(page)).toContainText("Please enter your name first");
});

test("booking happy path: co-edited state reaches the success state and survives scrubbing", async ({ page }) => {
  await startBooking(page);
  await page.locator('[data-a2ui-id="name_input"] input').fill("Ada");
  await byLabel(page, "10:30").click();
  await expect(status(page)).toContainText("Holding 10:30 for Ada");
  // The accepted action committed the name into the shared data model.
  await expect(page.locator('[data-a2ui-id="name_input"] input')).toHaveValue("Ada");
  await byLabel(page, "Confirm booking").click();
  await expect(status(page)).toContainText("Booked 10:30 for Ada");

  // Replay reconstruction: back to the beginning, forward to the booked state.
  await page.getByTestId("scrubber").focus();
  await page.keyboard.press("Home");
  await expect(page.locator("[data-canvas] [data-a2ui-id]")).toHaveCount(0);
  await page.keyboard.press("End");
  await expect(status(page)).toContainText("Booked 10:30 for Ada");
  await expect(page.locator('[data-a2ui-id="name_input"] input')).toHaveValue("Ada");

  // Cancel/reset path.
  await byLabel(page, "Start over").click();
  await expect(status(page)).toContainText("Pick a time to begin.");
});

test("session import: download a live run, import it, replay it (round-trip)", async ({ page }) => {
  await startBooking(page);
  await page.locator('[data-a2ui-id="name_input"] input').fill("Ada");
  await byLabel(page, "10:30").click();
  await expect(status(page)).toContainText("Holding 10:30 for Ada");

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("live-download").click();
  const download = await downloadPromise;
  const path = await download.path();

  await page.getByTestId("view-replay").click();
  await page.getByTestId("import-input").setInputFiles(path!);
  await expect(page.getByTestId("fixture-meta")).toContainText("(imported)");
  await page.getByTestId("scrubber").focus();
  await page.keyboard.press("End");
  await expect(status(page)).toContainText("Holding 10:30 for Ada");
});

test("session import: malformed and incompatible files show clear errors", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("import-input").setInputFiles({
    name: "junk.json",
    mimeType: "application/json",
    buffer: Buffer.from("{not json"),
  });
  await expect(page.getByTestId("import-error")).toContainText("not valid JSON");

  await page.getByTestId("import-input").setInputFiles({
    name: "future.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ replayFixture: "9.9", mode: "live", events: [] })),
  });
  await expect(page.getByTestId("import-error")).toContainText("unsupported fixture version");
});
