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
  await page.getByTestId("view-break").click();
  await page.getByTestId("break-unsupported-component").click();
  await expect(page.getByTestId("break-recorded-note")).toContainText("recorded catch");
  await page.getByTestId("scrubber").focus();
  await page.keyboard.press("End");
  await expect(page.getByTestId("failure-panel")).toContainText("dropdown-menu");
});

test("live-only conditions say plainly what they need", async ({ page }) => {
  await gotoOffline(page);
  await page.getByTestId("view-break").click();
  for (const id of ["malformed-generation", "ambiguous-action", "invalid-state"]) {
    await page.getByTestId(`break-${id}`).click();
    await expect(page.getByTestId("break-live-only")).toContainText("local agent");
    await expect(page.getByTestId("break-run")).toHaveCount(0);
  }
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
