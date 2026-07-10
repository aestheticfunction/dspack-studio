/**
 * Inspector synchronization e2e: every panel is a prefix fold, so scrubbing
 * backward must show exactly the state that existed then — never future
 * events — and forward must restore the final state. Runs against the
 * recorded live fixture-005 (generation + two action round-trips).
 */
import { expect, test, type Page } from "@playwright/test";

async function openBookingReplayInspector(page: Page) {
  await page.goto("/");
  await page.getByTestId("scenario-appointment-booking").click();
  await page.getByTestId("fixture-generated-live").click();
  await page.getByTestId("scrubber").focus();
  await page.keyboard.press("End");
  await page.getByTestId("inspector-open").click();
}

test("state panel: scrub backward removes future patches, forward restores them", async ({ page }) => {
  await openBookingReplayInspector(page);
  await page.getByTestId("inspector-tab-state").click();
  await expect(page.getByTestId("inspector-state-json")).toContainText('"confirmed": true');

  await page.getByTestId("scrubber").focus();
  await page.keyboard.press("Home");
  await expect(page.getByTestId("inspector-state-json")).not.toContainText("confirmed");
  await expect(page.getByTestId("inspector-patches")).toContainText("no patches yet");

  await page.keyboard.press("End");
  await expect(page.getByTestId("inspector-state-json")).toContainText('"confirmed": true');
  await expect(page.getByTestId("inspector-patches")).toContainText("/booking/confirmed");
});

test("actions panel: lifecycles appear only once their events have happened", async ({ page }) => {
  await openBookingReplayInspector(page);
  await page.getByTestId("inspector-tab-actions").click();
  const panel = page.getByTestId("inspector-actions");
  await expect(panel).toContainText("select_slot");
  await expect(panel).toContainText("confirm_booking");
  await expect(panel).toContainText("accepted");

  await page.getByTestId("scrubber").focus();
  await page.keyboard.press("Home");
  await expect(panel).toContainText("no user actions yet");
});

test("events panel distinguishes categories; gates panel tracks the pipeline", async ({ page }) => {
  await openBookingReplayInspector(page);
  await page.getByTestId("inspector-tab-events").click();
  const events = page.getByTestId("inspector-events");
  await expect(events).toContainText("pipeline");
  await expect(events).toContainText("user-action");
  await expect(events).toContainText("agent-response");
  await expect(events).toContainText("enhancement");

  await page.getByTestId("inspector-tab-gates").click();
  await expect(page.getByTestId("inspector-gates")).toContainText("attempt 0");
  await expect(page.getByTestId("inspector-gates")).toContainText("audit: passed");

  await page.getByTestId("scrubber").focus();
  await page.keyboard.press("Home");
  await expect(page.getByTestId("inspector-gates")).toContainText("no gate results yet");
});

test("components panel shows enhanced provenance (bindings and grounded actions)", async ({ page }) => {
  await openBookingReplayInspector(page);
  await page.getByTestId("inspector-tab-components").click();
  const panel = page.getByTestId("inspector-components");
  await expect(panel).toContainText("select_slot");
  await expect(panel).toContainText("/booking/name");
});
