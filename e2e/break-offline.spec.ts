/**
 * Break-it Mode without the local agent (the deployed static site): the
 * switcher marks the agent-dependent modes, conditions with an equivalent
 * recorded real run replay it labeled as a recorded catch, live-only
 * conditions say plainly what they need, and the client-side validator demo
 * still works. The agent runs locally during e2e, so this suite blocks it
 * at the network layer to reproduce production.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function gotoOffline(page: Page) {
  await page.route("http://localhost:8787/**", (r) => r.abort());
  await page.route("http://127.0.0.1:8787/**", (r) => r.abort());
  await page.goto("/");
}

test("the switcher marks agent-dependent modes when the agent is offline", async ({ page }) => {
  await gotoOffline(page);
  await expect(page.getByTestId("view-live")).toContainText("offline");
  await expect(page.getByTestId("view-break")).toContainText("recorded");
  await page.getByTestId("view-live").click();
  await expect(page.getByTestId("view-help")).toContainText("local agent is offline");
});

test("governed-repair conditions replay their recorded catch", async ({ page }) => {
  await gotoOffline(page);
  await page.getByTestId("scenario-project-deletion").click();
  await page.getByTestId("view-break").click();
  await page.getByTestId("break-no-alertdialog").click();
  await expect(page.getByTestId("break-recorded-note")).toContainText("recorded catch");
  await expect(page.getByTestId("fixture-meta")).toContainText("live run, ollama:gemma4:e4b");
  // The recorded run carries the catch: scrub to the end, the repair shipped.
  await page.getByTestId("scrubber").focus();
  await page.keyboard.press("End");
  await expect(page.getByTestId("gate-ticker")).toContainText("repair");
  await expect(page.getByTestId("audit-outcome")).toContainText("passed");
  // No dead run buttons.
  await expect(page.getByTestId("break-run")).toHaveCount(0);
});

test("the emitter-refusal condition replays the recorded refusal", async ({ page }) => {
  await gotoOffline(page);
  await page.getByTestId("scenario-project-deletion").click();
  await page.getByTestId("view-break").click();
  await page.getByTestId("break-unsupported-component").click();
  await expect(page.getByTestId("break-recorded-note")).toContainText("recorded catch");
  await page.getByTestId("scrubber").focus();
  await page.keyboard.press("End");
  await expect(page.getByTestId("failure-panel")).toContainText("dropdown-menu");
});

test("live-only conditions say plainly what they need", async ({ page }) => {
  await gotoOffline(page);
  await page.getByTestId("scenario-project-deletion").click();
  await page.getByTestId("view-break").click();
  await page.getByTestId("break-malformed-generation").click();
  await expect(page.getByTestId("break-live-only")).toContainText("local agent");
  await expect(page.getByTestId("break-run")).toHaveCount(0);
});

test("the booking scenario's recorded catch replays the unresolved action", async ({ page }) => {
  await gotoOffline(page);
  await page.getByTestId("scenario-appointment-booking").click();
  await page.getByTestId("view-break").click();
  await page.getByTestId("break-ambiguous-action").click();
  await expect(page.getByTestId("break-recorded-note")).toContainText("recorded catch");
  // The recorded run carries the catch: the dispatched action grounds on no
  // capability, resolution rejects it client-side, on the record.
  await page.getByTestId("scrubber").focus();
  await page.keyboard.press("End");
  await page.getByTestId("inspector-open").click();
  await page.getByTestId("inspector-tab-actions").click();
  await expect(page.getByTestId("inspector-actions")).toContainText("unresolved");
  await expect(page.getByTestId("inspector-actions")).toContainText("mystery_action");
  // No dead run buttons.
  await expect(page.getByTestId("break-run")).toHaveCount(0);
});

test("the recipe scenario's recorded catch replays the recoverable rejection", async ({ page }) => {
  await gotoOffline(page);
  await page.getByTestId("scenario-recipe-creator").click();
  await page.getByTestId("view-break").click();
  await page.getByTestId("break-invalid-state").click();
  await expect(page.getByTestId("break-recorded-note")).toContainText("recorded catch");
  // The recorded run carries the catch: the agent rejects the unknown
  // constraint recoverably and the session keeps going.
  await page.getByTestId("scrubber").focus();
  await page.keyboard.press("End");
  await expect(page.locator("[data-canvas]")).toContainText("Unknown constraint. Try: vegetarian, vegan, gluten-free.");
  await page.getByTestId("inspector-open").click();
  await page.getByTestId("inspector-tab-actions").click();
  await expect(page.getByTestId("inspector-actions")).toContainText("rejected");
  await expect(page.getByTestId("break-run")).toHaveCount(0);
});

test("offline states (badges active, recorded catch, live-only note) have no axe violations", async ({ page }) => {
  // The offline badges render inside ACTIVE buttons on the deployed site;
  // this is the state local e2e never sees (the agent is running), so it is
  // scanned here with the agent blocked. Regression test for the badge
  // contrast failure axe caught in production.
  await gotoOffline(page);
  await expect(page.getByTestId("view-live")).toContainText("offline");
  const scan = () =>
    new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).disableRules(["region"]).analyze();

  await page.getByTestId("view-live").click();
  await expect(page.getByTestId("agent-offline")).toBeVisible();
  expect((await scan()).violations).toEqual([]);

  await page.getByTestId("scenario-project-deletion").click();
  await page.getByTestId("view-break").click();
  await expect(page.getByTestId("break-recorded-note")).toBeVisible();
  expect((await scan()).violations).toEqual([]);

  await page.getByTestId("break-malformed-generation").click();
  await expect(page.getByTestId("break-live-only")).toBeVisible();
  expect((await scan()).violations).toEqual([]);
});

test("the malformed-import demo stays fully client-side", async ({ page }) => {
  await gotoOffline(page);
  await page.getByTestId("view-break").click();
  await page.getByTestId("break-malformed-import").click();
  await page.getByTestId("break-run").click();
  await expect(page.getByTestId("break-import-error")).toContainText("The validator said no");
});
