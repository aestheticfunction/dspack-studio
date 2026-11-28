/**
 * Transition intent (decision 81, experimental Library): a state's title and description; an action's intended
 * next states, said as intent, never behaviour; the evidence that each intended state is reachable by an
 * example; renaming and removing states keep the intent in step; approval waits for evidence.
 *
 * TRANSITION_SHOTS=1 writes screenshots to docs/repositioning/m1/transitions/.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const NS = "composer.experimental.workspace.";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const DISMISSED = JSON.stringify({ schema: "composer.experimental.workspace/onboarding", version: 1, data: { dismissed: true } });

async function openLibrary(page: Page) {
  await page.route("**/api/**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) }));
  await page.addInitScript((v) => {
    if (!localStorage.getItem("composer.experimental.workspace.onboarding")) localStorage.setItem("composer.experimental.workspace.onboarding", v);
  }, DISMISSED);
  await page.goto("/");
  await page.getByTestId("nav-library").click();
  await ready(page);
}
const ready = (page: Page) => expect(page.getByTestId("check-pill")).not.toHaveAttribute("data-state", "loading", { timeout: 30_000 });
const lib = (page: Page) => page.getByTestId("composition-library");
const shot = async (page: Page, name: string) => {
  if (process.env.TRANSITION_SHOTS) await page.screenshot({ path: `docs/repositioning/m1/transitions/${name}.png` });
};
const storedDraft = async (page: Page) => {
  const raw = await page.evaluate((k) => localStorage.getItem(k), `${NS}drafts`);
  return (JSON.parse(raw!).data.drafts as Array<Record<string, any>>).find((d) => d.id === "hotel-results")!;
};
async function draftWithStates(page: Page) {
  await page.getByRole("radio", { name: /v2 Draft/i }).check();
  await ready(page);
  if ((await lib(page).getAttribute("data-library")) !== "open") await page.getByTestId("toggle-library").click();
  await page.getByTestId("view-structure").click();
  if ((await lib(page).getAttribute("data-inspector")) !== "open") await page.getByTestId("toggle-inspector").click();
  await page.getByTestId("edit-states").click();
  await expect(page.getByTestId("states-editor")).toBeVisible();
}

test.describe("transition intent", () => {
  test("titles, descriptions and intended next states, with reachability evidence said as evidence, not behaviour", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLibrary(page);
    await draftWithStates(page);

    // A title and a description for Confirm: shown in the list and the state's detail; the name stays its identity.
    await page.getByTestId("state-row-confirm").click();
    await page.getByTestId("state-title-input").fill("Confirm the stay");
    await page.getByTestId("state-title-apply").click();
    await expect(page.getByTestId("state-applied")).toContainText("Titled “Confirm the stay”.");
    await page.getByTestId("state-description-input").fill("The person checks the hotel, dates and price before the hold is placed.");
    await page.getByTestId("state-description-apply").click();
    await expect(page.getByTestId("state-row-confirm")).toContainText("Confirm the stay");
    await expect(page.getByTestId("state-description-text")).toContainText("before the hold is placed");
    expect((await storedDraft(page)).states[0]).toMatchObject({ id: "confirm", title: "Confirm the stay" });
    await shot(page, "01-state-title");

    // Choose is intended to lead to Confirm: the example that reaches it is named, and the note says what that proves.
    await page.getByTestId("action-leads-choose-confirm").check();
    await expect(page.getByTestId("action-evidence-choose-confirm")).toHaveAttribute("data-reached", "true");
    await expect(page.getByTestId("action-evidence-choose-confirm")).toContainText("Confirm the stay is reached by the example");
    await expect(page.getByTestId("action-flow-intent-note")).toContainText("not that this action leads to it");
    expect((await storedDraft(page)).actions.find((a: any) => a.name === "choose").leadsTo).toEqual(["confirm"]);
    // A consequential action cannot lead back to its own confirmation: that choice is not offered.
    await expect(page.getByTestId("action-leads-reserve-confirm")).toHaveCount(0);
    await page.getByTestId("action-flow-choose").scrollIntoViewIfNeeded();
    await shot(page, "02-intended-next");

    // Renaming Confirm carries the intent in the same step.
    await page.getByTestId("state-row-confirm").click();
    await page.getByTestId("state-rename-input").fill("review");
    await page.getByTestId("state-rename-apply").click();
    await expect(page.getByTestId("state-applied")).toContainText("Renamed to Review");
    expect((await storedDraft(page)).actions.find((a: any) => a.name === "choose").leadsTo).toEqual(["review"]);
    await expect(page.getByTestId("action-leads-choose-review")).toBeChecked();

    // Intent towards a state no example reaches: said, and approval waits for an example.
    await page.getByTestId("state-new").click();
    await page.getByTestId("state-new-name").fill("sold-out");
    await page.getByTestId("state-new-purpose").selectOption("structured-editing");
    await page.getByTestId("state-new-add").click();
    await page.getByTestId("state-guard-when").check();
    await page.getByTestId("state-guard-field-0").selectOption("selection");
    await page.getByTestId("state-guard-kind-0").selectOption("present");
    await page.getByTestId("state-guard-apply").click();
    // Placed after Review, whose condition is the same, the data never chooses it: no example can reach it.
    await page.getByTestId("action-leads-new_search-sold-out").check();
    await expect(page.getByTestId("action-evidence-new_search-sold-out")).toHaveAttribute("data-reached", "false");
    await expect(page.getByTestId("action-evidence-new_search-sold-out")).toContainText("No example reaches Sold out yet");
    await page.getByTestId("run-checks").click();
    await expect(page.getByTestId("authoring-bar")).toHaveAttribute("data-state", "pass", { timeout: 20_000 });
    await expect(page.getByTestId("intent-blocked")).toContainText("no example reaches that state");
    await expect(page.getByTestId("approve")).toHaveCount(0);
    await shot(page, "03-approval-waits");

    // Removing the state says the intent goes with it, and does it in the same step.
    await page.getByTestId("state-row-sold-out").click();
    await page.getByTestId("state-remove").click();
    await expect(page.getByTestId("state-remove-effects")).toContainText("“New search” is no longer intended to lead here.");
    await page.getByTestId("state-remove-confirm").click();
    expect((await storedDraft(page)).actions.find((a: any) => a.name === "new_search").leadsTo).toBeUndefined();
    await expect(page.getByTestId("intent-blocked")).toHaveCount(0);

    // A reload keeps the 0.3 draft as it was.
    await page.reload();
    await ready(page);
    expect((await storedDraft(page)).actions.find((a: any) => a.name === "choose").leadsTo).toEqual(["review"]);
  });

  for (const width of [1440, 390]) {
    test(`the state and action controls pass axe at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openLibrary(page);
      if (width === 390) {
        await page.getByRole("radio", { name: /v2 Draft/i }).check();
        await ready(page);
        await page.getByTestId("toggle-library").click();
        await page.getByTestId("view-structure").click();
        await page.getByTestId("edit-states").click();
      } else await draftWithStates(page);
      await page.getByTestId("action-leads-choose-confirm").check();
      await expect(page.getByTestId("action-evidence-choose-confirm")).toBeVisible();
      const r = await new AxeBuilder({ page }).withTags(TAGS).include('[data-testid="composition-library"]').analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
      await expect(page.locator("body")).toHaveJSProperty("scrollWidth", width);
    });
  }
});
