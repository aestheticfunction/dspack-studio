/**
 * Interactive-scenario + session-import e2e (deterministic: the booking
 * responder is local logic; no model calls).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

test("booking happy path: the governed question, its gates, confirm, and scrub reconstruction (FM-7)", async ({ page }) => {
  await startBooking(page);
  await page.locator('[data-a2ui-id="name_input"] input').fill("Ada");
  await byLabel(page, "10:30").click();
  await expect(status(page)).toContainText("Holding 10:30 for Ada");
  // The accepted action committed the name into the shared data model.
  await expect(page.locator('[data-a2ui-id="name_input"] input')).toHaveValue("Ada");

  // FM-7: the agent's question is a REAL governed surface delivered beside
  // the booking surface — an AlertDialog whose own S1/S2/S3 gates just ran
  // in this same stream (visible in the ticker), with the specific action
  // label the governance requires (never "OK"/"Confirm").
  const question = page.locator('[data-a2ui-surface="scheduling_question"]');
  await expect(question).toBeVisible();
  await expect(question).toContainText("Book 10:30 for Ada?");
  await expect(page.getByTestId("gate-ticker")).toContainText("attempt 0");
  await expect(page.getByTestId("gate-ticker")).toContainText("S3");
  const confirm = question.locator("button", { hasText: "Book 10:30" }).first();
  await expect(confirm).toBeVisible();
  await confirm.click();

  // Answering removes exactly the question surface; the booking surface
  // underneath carries the outcome.
  await expect(question).toHaveCount(0);
  await expect(status(page)).toContainText("Booked 10:30 for Ada");

  // Replay reconstruction: back to the beginning, through the question
  // moment, forward to the booked state.
  await page.getByTestId("scrubber").focus();
  await page.keyboard.press("Home");
  await expect(page.locator("[data-canvas] [data-a2ui-id]")).toHaveCount(0);
  await page.keyboard.press("End");
  await expect(status(page)).toContainText("Booked 10:30 for Ada");
  await expect(page.locator('[data-a2ui-id="name_input"] input')).toHaveValue("Ada");
  await expect(question).toHaveCount(0);

  // Cancel/reset path.
  await byLabel(page, "Start over").click();
  await expect(status(page)).toContainText("Pick a time to begin.");
});

test("declining the governed question releases the slot and removes the question (FM-7)", async ({ page }) => {
  await startBooking(page);
  await page.locator('[data-a2ui-id="name_input"] input').fill("Ada");
  await byLabel(page, "9:00").click();
  const question = page.locator('[data-a2ui-surface="scheduling_question"]');
  await expect(question).toContainText("Book 9:00 for Ada?");
  await question.locator("button", { hasText: "Back to the times" }).click();
  await expect(question).toHaveCount(0);
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

test("fixture-009 shelf replay: the live governed question reconstructs at its moment and resolves (FM-7)", async ({ page }) => {
  const fixture = JSON.parse(
    readFileSync(join(process.cwd(), "packages", "replay", "fixtures", "fixture-009.json"), "utf-8"),
  ) as { mode: string; adapterId: string; events: Array<{ event: any }> };
  // Provenance honesty: the shelf recording is a real live run whose stream
  // carries TWO pipeline runs (the surface and the question), no fallback.
  expect(fixture.mode).toBe("live");
  expect(fixture.events.filter((e) => e.event?.name === "dspack.gates").length).toBe(2);
  expect(fixture.events.some((e) => e.event?.name === "studio.question.fallback")).toBe(false);
  const questionAt = fixture.events.findIndex(
    (e) => e.event?.name === "studio.surface.enhanced" && JSON.stringify(e.event.value?.notes).includes("scheduling_question"),
  );
  expect(questionAt).toBeGreaterThan(0);

  await page.goto("/");
  await page.getByTestId("scenario-appointment-booking").click();
  await page.getByTestId("fixture-governed-question").click();
  const question = page.locator('[data-a2ui-surface="scheduling_question"]');

  // At the question moment: the governed AlertDialog is on canvas.
  await page.getByTestId("scrubber").focus();
  await page.keyboard.press("End");
  await page.getByTestId("scrubber").fill(String(questionAt));
  await expect(question).toBeVisible();
  await expect(question.locator('[data-a2ui-component="AlertDialog"]')).toBeVisible();

  // At the ending: answered, removed, booked.
  await page.keyboard.press("End");
  await expect(question).toHaveCount(0);
  await expect(page.locator("[data-canvas]")).toContainText(/Booked .* for Ada/);
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
