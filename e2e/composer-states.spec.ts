/**
 * State, transition and dialog authoring (experimental Library, slices A to C): create, order, condition,
 * duplicate, rename and remove states with their references in step; what actions do; dialogs and confirmation
 * dialogs placed only where the contract and the host's safeguards allow; a state previewed through the governed
 * pipeline; an invalid declaration met and resolved; checks and approval. Agent-free.
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
const canvas = (page: Page) => page.locator('[data-project-canvas="composer"]:not(.cl-frame--kept)');
const tree = (page: Page, key: string) => page.getByTestId(`structure-${key}`);
const lib = (page: Page) => page.getByTestId("composition-library");
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
async function newState(page: Page, name: string, purpose: string) {
  await page.getByTestId("state-new").click();
  await page.getByTestId("state-new-name").fill(name);
  await page.getByTestId("state-new-purpose").selectOption(purpose);
  await page.getByTestId("state-new-add").click();
  await expect(page.getByTestId("state-applied")).toContainText("is added");
}

test.describe("state authoring walkthrough", () => {
  test("Hotel results: a new destructive state, its condition and order, an example for it, refused until it confirms, a confirmation dialog, its payload, checks and approval", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLibrary(page);
    // 1. The draft, with Structure and the inspector side by side, and its states.
    await draftWithStates(page);
    await expect(page.getByTestId("states-editor").locator(".cl-states__row")).toHaveCount(3);
    // 2. A new state, for releasing a hold; it is judged as a destructive action.
    await newState(page, "cancel-hold", "destructive-action");
    await expect(page.getByTestId("state-detail")).toHaveAttribute("data-state", "cancel-hold");
    // It is placed before Ready (always shown), so nothing after it is lost; the data would now choose it first.
    expect((await storedDraft(page)).states.map((s: any) => s.id)).toEqual(["confirm", "empty", "cancel-hold", "ready"]);
    // 4. Its condition: a selection is given and there are no hotels. Then first in order.
    await page.getByTestId("state-guard-when").check();
    await page.getByTestId("state-guard-field-0").selectOption("selection");
    await page.getByTestId("state-guard-kind-0").selectOption("present");
    await page.getByTestId("state-guard-add-part").click();
    await page.getByTestId("state-guard-field-1").selectOption("hotels");
    await page.getByTestId("state-guard-kind-1").selectOption("empty");
    await page.getByTestId("state-guard-apply").click();
    await expect(page.getByTestId("state-applied")).toContainText("shown when selection is given and hotels is empty");
    for (let i = 0; i < 2; i++) await page.getByTestId("state-earlier").click();
    expect((await storedDraft(page)).states.map((s: any) => s.id)).toEqual(["cancel-hold", "confirm", "empty", "ready"]);
    expect((await storedDraft(page)).states[0].guard).toEqual({ all: [{ present: "selection" }, { empty: "hotels" }] });
    // 6. An example for it: a copy of “Confirm a reservation” with no hotels, asking for this state.
    await page.getByTestId("tab-examples").click();
    await page.getByTestId("duplicate-confirm").click();
    await page.getByTestId("edit-example-title").fill("Release a hold");
    await page.getByTestId("example-data").getByText("Edit the data as JSON").click();
    const json = JSON.parse(await page.getByTestId("example-json").inputValue());
    await page.getByTestId("example-json").fill(JSON.stringify({ ...json, hotels: [] }, null, 2));
    await page.getByTestId("example-json-apply").click();
    await page.getByTestId("example-state").selectOption("cancel-hold");
    // 7. An invalid declaration: a destructive state must confirm, so the design rules refuse it.
    await expect(page.getByTestId("refusal")).toContainText("AlertDialog");
    // Structure shows the state; the starting card is there.
    await page.getByTestId("structure-state").selectOption("cancel-hold");
    await tree(page, "cancel-hold@").click();
    // 3. Edit its template: what the card says.
    await tree(page, "cancel-hold@0").click();
    await page.getByTestId("content-text-text-0").fill("Your hold can be released.");
    await page.getByTestId("content-text-apply").click();
    // 5. A confirmation dialog, offered here because the state is destructive; a generic label is refused.
    await tree(page, "cancel-hold@").click();
    await page.getByTestId("tt-add").click();
    await page.getByTestId("tt-pos-inside").check();
    await expect(page.getByTestId("tt-component-dialog")).toBeDisabled();
    await page.getByTestId("tt-component-alert-dialog").check();
    await page.getByTestId("tt-label").fill("Confirm");
    await page.getByTestId("tt-add-confirm").click();
    await expect(page.getByTestId("tt-error")).toContainText("says what it does");
    await page.getByTestId("tt-label").fill("Release the hold");
    await page.getByTestId("tt-add-confirm").click();
    await expect(tree(page, "#release-the-hold")).toHaveAttribute("aria-selected", "true");
    // Resolved: the state renders, with its confirmation.
    await expect(page.getByTestId("check-pill")).toHaveAttribute("data-state", "preview");
    // The canvas draws the confirmation in place (it is the state's screen): its title and its specific action.
    await expect(canvas(page).getByRole("heading", { name: "Release the hold?" })).toBeVisible();
    await expect(canvas(page).getByRole("button", { name: "Release the hold" })).toBeVisible();
    const d = await storedDraft(page);
    expect(d.actions.find((a: any) => a.node === "release-the-hold")).toMatchObject({ name: "release_the_hold", states: ["cancel-hold"], consequential: true });
    // What it sends: the selected hotel's id, fixed when the confirmation is shown.
    await page.getByTestId("payload-add").click();
    await page.getByTestId("payload-new-key").fill("hotelId");
    await page.getByTestId("payload-new-source").selectOption("field:selection.id");
    await page.getByTestId("payload-new-add").click();
    await expect(page.getByTestId("element-applied")).toBeVisible();
    // What actions do says it plainly.
    await page.getByTestId("element-back").click();
    await expect(page.getByTestId("action-flow-release_the_hold")).toContainText("Asked in Cancel hold");
    // 8. Checks pass; approve on this device.
    await page.getByTestId("run-checks").click();
    await expect(page.getByTestId("authoring-bar")).toHaveAttribute("data-state", "pass");
    await page.getByTestId("approve").click();
    await page.getByTestId("approve-confirm-button").click();
    await expect(page.getByRole("radio", { name: /v2 Approved/i })).toBeChecked();
    // The approved version is read-only: its states are shown, not editable.
    await page.getByTestId("tab-design").click();
    await expect(page.getByTestId("state-new")).toHaveCount(0);
  });
});

test.describe("states and their references", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLibrary(page);
    await draftWithStates(page);
  });

  test("duplicate, rename and remove keep actions and examples in step, and removal says what changes first", async ({ page }) => {
    await page.getByTestId("state-row-ready").click();
    await page.getByTestId("state-duplicate").click();
    await page.getByTestId("state-duplicate-name").fill("ready-compact");
    await page.getByTestId("state-duplicate-confirm").click();
    let d = await storedDraft(page);
    expect(d.actions.find((a: any) => a.name === "choose").states).toEqual(["ready", "ready-compact"]);
    // Rename: the actions and an example asking for it follow.
    await page.getByTestId("state-rename-input").fill("ready-short");
    await page.getByTestId("state-rename-apply").click();
    d = await storedDraft(page);
    expect(d.actions.find((a: any) => a.name === "choose").states).toEqual(["ready", "ready-short"]);
    // A name already used is refused with the reason, and nothing changes.
    await page.getByTestId("state-rename-input").fill("ready");
    await page.getByTestId("state-rename-apply").click();
    await expect(page.getByTestId("state-error")).toContainText("already a “ready” state");
    // What actions do: Choose can be sent from either; stop it in the copy.
    await page.getByTestId("action-from-choose-ready-short").uncheck();
    await expect.poll(async () => (await storedDraft(page)).actions.find((a: any) => a.name === "choose").states).toEqual(["ready"]);
    // Remove the empty state: its action and an example's request are said first.
    await page.getByTestId("state-row-empty").click();
    await page.getByTestId("state-remove").click();
    await expect(page.getByTestId("state-remove-effects")).toContainText("The “Search again” action is removed.");
    await expect(page.getByRole("button", { name: "Keep it" })).toBeFocused();
    await page.getByTestId("state-remove-confirm").click();
    d = await storedDraft(page);
    expect(d.states.map((s: any) => s.id)).toEqual(["confirm", "ready", "ready-short"]);
    expect(d.actions.map((a: any) => a.name)).not.toContain("search_again");
    // A confirmation state is not duplicated: its consequential action belongs to one state.
    await page.getByTestId("state-row-confirm").click();
    await page.getByTestId("state-duplicate").click();
    await page.getByTestId("state-duplicate-confirm").click();
    await expect(page.getByTestId("state-error")).toContainText("consequential");
  });

  test("conditions read only declared fields; a number of items is offered only for a list; unreachable states are said", async ({ page }) => {
    await page.getByTestId("state-row-empty").click();
    await page.getByTestId("state-guard-field-0").selectOption("destination");
    await expect(page.getByTestId("state-guard-kind-0").locator('option[value="minItems"]')).toBeDisabled();
    await page.getByTestId("state-guard-field-0").selectOption("hotels");
    await page.getByTestId("state-guard-kind-0").selectOption("minItems");
    await page.getByTestId("state-guard-min-0").fill("0");
    await page.getByTestId("state-guard-apply").click();
    await expect(page.getByTestId("state-applied")).toContainText("hotels has at least 0 items");
    // Ready, always shown, moved first: the states after it are never chosen by the data, and it says so.
    await page.getByTestId("state-row-ready").click();
    await page.getByTestId("state-earlier").click();
    await page.getByTestId("state-earlier").click();
    await expect(page.getByTestId("states-unreachable")).toContainText("Confirm, Empty");
  });

  test("a dialog is not offered where a confirmation is required, nor inside another dialog, nor repeated", async ({ page }) => {
    // Ready is a transactional review: a confirmation dialog is not offered, with the reason.
    await page.getByTestId("structure-state").selectOption("ready");
    await tree(page, "ready@").click();
    await page.getByTestId("tt-add").click();
    await page.getByTestId("tt-pos-inside").check();
    await expect(page.getByTestId("tt-component-alert-dialog")).toBeDisabled();
    await expect(page.getByTestId("tt-add-panel")).toContainText("belongs in a state whose purpose is Destructive action");
    // A dialog is offered there, and nothing that opens goes inside it.
    await page.getByTestId("tt-component-dialog").check();
    await page.getByTestId("tt-label").fill("About prices");
    await page.getByTestId("tt-add-confirm").click();
    const dialogKey = await page.locator('[data-testid="structure-tree"] [aria-selected="true"]').getAttribute("data-key");
    await page.getByTestId("tt-add").click();
    await page.getByTestId("tt-pos-inside").check();
    await expect(page.getByTestId("tt-component-dialog")).toBeDisabled();
    await expect(page.getByTestId("tt-add-panel")).toContainText("A dialog is one layer");
    expect(dialogKey).toBeTruthy();
    // Inside each hotel: not repeated.
    await page.keyboard.press("Escape");
    await tree(page, "ready@2.0.0").click();
    await page.getByTestId("tt-add").click();
    await expect(page.getByTestId("tt-component-dialog")).toBeDisabled();
  });

  test("axe at 1440 px: the states section, a new-state form and what actions do, with no exceptions", async ({ page }) => {
    await page.getByTestId("state-new").click();
    const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
});

test("axe at 390 px: the states in the inspector sheet, reached from Structure, with no exceptions", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openLibrary(page);
  await page.getByRole("radio", { name: /v2 Draft/i }).check();
  await ready(page);
  await page.getByTestId("toggle-library").click();
  await page.getByTestId("view-structure").click();
  await page.getByTestId("edit-states").click();
  await expect(page.getByTestId("states-editor")).toBeVisible();
  await expect(lib(page)).toHaveAttribute("data-inspector", "open");
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
});
