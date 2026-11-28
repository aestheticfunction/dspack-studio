/**
 * Block promotion (experimental Library, slice D): open a packaged Astryx block, promote it to a new draft
 * composition, inspect what maps and what does not, resolve the mappings through the ordinary editing, refine
 * the examples, preview and check, approve on this device, and reopen it from the Library. The block is never
 * changed, nothing is mapped for the designer, and approval stays blocked while anything is unresolved.
 *
 * PROMOTION_SHOTS=1 writes the walkthrough's screenshots to docs/repositioning/m1/promotion/.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

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
const shot = async (page: Page, name: string) => {
  if (process.env.PROMOTION_SHOTS) await page.screenshot({ path: `docs/repositioning/m1/promotion/${name}.png` });
};
async function compositions(page: Page) {
  if ((await page.getByTestId("composition-library").getAttribute("data-library")) !== "open") await page.getByTestId("toggle-library").click();
  await page.getByTestId("view-compositions").click();
}
async function structure(page: Page) {
  if ((await page.getByTestId("composition-library").getAttribute("data-library")) !== "open") await page.getByTestId("toggle-library").click();
  await page.getByTestId("view-structure").click();
  await expect(page.getByTestId("structure-tree")).toBeVisible();
}
async function inspector(page: Page) {
  if ((await page.getByTestId("composition-library").getAttribute("data-inspector")) !== "open") await page.getByTestId("toggle-inspector").click();
}
async function add(page: Page, position: "before" | "after" | "inside", component: string, label: string) {
  await page.getByTestId("tt-add").click();
  await page.getByTestId(`tt-pos-${position}`).check();
  await page.getByTestId(`tt-component-${component}`).check();
  await page.getByTestId("tt-label").fill(label);
  await page.getByTestId("tt-add-confirm").click();
}
const row = (page: Page, id: string) => page.getByTestId(`promotion-row-${id}`);
async function promoteAuthForm(page: Page) {
  await compositions(page);
  await page.getByTestId("block-auth-form").getByTestId("promote-auth-form").click();
  await page.getByTestId("promote-confirm-button").click();
  await expect(page.getByTestId("promotion-details")).toBeVisible();
}

test.describe("block promotion", () => {
  test("walkthrough on Account access: open, promote, inspect, resolve, identify unsupported, refine examples, preview and check, approve, reopen", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLibrary(page);

    // 1. Open the block: the Compositions panel lists the blocks a composition can start from.
    await compositions(page);
    const block = page.getByTestId("block-auth-form");
    await block.scrollIntoViewIfNeeded();
    await expect(block).toContainText("Account access");
    await expect(page.getByTestId("block-list")).toContainText("the block itself does not change");
    await shot(page, "01-blocks");

    // 2. Promote: the confirmation says what it will make and what is left to resolve, before anything happens.
    await block.getByTestId("promote-auth-form").click();
    const confirm = page.getByTestId("promote-confirm");
    await expect(confirm).toContainText("A new draft, “Account access” v1");
    await expect(confirm).toContainText("Nothing is approved or published");
    await expect(page.getByTestId("promote-to-resolve")).toContainText("5 things to resolve");
    await expect(page.getByTestId("promote-to-resolve")).toContainText("Nothing is mapped for you");
    await shot(page, "02-promote-confirm");
    await page.getByTestId("promote-confirm-button").click();

    // 3. Inspect: a new draft in the Library; the inspector says where it came from and what is unresolved; the
    // canvas refuses it, because a button would send an action nobody declared.
    await expect(page.getByTestId("library-item-auth-form")).toContainText("v1 · Draft");
    await expect(page.getByTestId("promotion-source")).toContainText("Astryx block “Account access” (auth-form v1). The block is unchanged.");
    await expect(page.getByTestId("promotion-summary")).toContainText("5 things to resolve");
    // Its checks between fields cannot be carried, and the composition still shows those fields: approval waits.
    await expect(row(page, "checks-blocking")).toContainText("4 checks between fields");
    await expect(row(page, "auth_submit")).toHaveAttribute("data-status", "to-resolve");
    await expect(row(page, "auth_forgot")).toContainText("shown only when “recovery” is set");
    await expect(row(page, "repeat-providers")).toContainText("cannot be mapped");
    await expect(row(page, "input-fields")).toContainText("cannot be bound");
    await expect(page.getByTestId("refusal")).toHaveAttribute("data-stage", "attach");
    await expect(page.getByTestId("refusal")).toContainText("The “auth submit” button sends an action that the “Data collection” state does not declare");
    await shot(page, "03-inspect");
    await structure(page);
    await inspector(page);
    await expect(page.getByTestId("structure-tree")).toContainText("Card");
    await shot(page, "04-structure");

    // 4. Resolve the mapping: Submit is a literal, always-shown button, so its action can be declared.
    await row(page, "auth_submit").getByTestId("promotion-map-auth_submit").click();
    await expect(row(page, "auth_submit")).toHaveAttribute("data-status", "resolved");
    await expect(page.getByTestId("promotion-summary")).toContainText("4 things to resolve");

    // 5. Identify and remove what cannot be supported: the conditional Forgot and the provider buttons.
    await row(page, "auth_forgot").getByTestId("promotion-remove-auth_forgot").click();
    await expect(page.getByTestId("promotion-status")).toContainText("Undo brings it back");
    await expect(row(page, "auth_forgot")).toHaveCount(0);
    await expect(row(page, "removed")).toContainText("Auth forgot: no element sends it any more");
    await row(page, "repeat-providers").getByTestId("promotion-remove-repeat-providers").click();
    await expect(row(page, "repeat-providers")).toHaveCount(0);
    await expect(row(page, "removed")).toContainText("5 actions no longer sent");
    await expect(page.getByTestId("promotion-summary")).toContainText("2 things to resolve");
    // Approval is blocked with the reason while anything is unresolved, even before the checks.
    await expect(page.getByTestId("promotion-blocked")).toContainText("from the block to resolve");
    await expect(page.getByTestId("approve")).toHaveCount(0);
    // Replace the computed text fields with fields of their own, then remove the computed ones.
    await page.getByTestId("structure-#auth-submit").click();
    await add(page, "before", "text-input", "Email address");
    await page.getByTestId("structure-#auth-submit").click();
    await add(page, "before", "text-input", "Password");
    await expect(page.getByTestId("element-inspector")).toBeVisible();
    await page.getByTestId("input-sensitive").check();
    await expect(page.getByTestId("input-mask")).toHaveCount(0);
    await inspector(page);
    await page.getByTestId("draft-resolve").or(page.getByTestId("promotion-review")).first().click();
    await row(page, "input-fields").getByTestId("promotion-remove-input-fields").click();
    await expect(page.getByTestId("promotion-summary")).toContainText("Everything from the block is resolved");
    // Only the fields of its own remain: one email field and one masked, private password field.
    await expect(canvas(page).locator('input[type="password"]')).toHaveCount(1);
    await expect(canvas(page).getByLabel("Email address")).toHaveCount(1);
    await expect(row(page, "input-password")).toContainText("Declared and private");
    await expect(page.getByTestId("promotion-blocked")).toHaveCount(0);
    // The checks between fields are genuinely resolved: the composition no longer shows the fields they constrain.
    await expect(row(page, "checks-moot")).toContainText("when mode is reset, fields includes email");
    await expect(row(page, "checks-moot")).toHaveAttribute("data-status", "resolved");
    await shot(page, "05-resolved");

    // 6. Refine the examples: rename the block's example and add a sign-in one.
    await page.getByTestId("tab-examples").click();
    await page.getByTestId("edit-example-title").fill("New account");
    await page.getByTestId("duplicate-sign-up").click();
    await page.getByTestId("edit-example-title").fill("Returning person");
    await page.getByTestId("data-mode").selectOption("sign-in");
    await expect(page.getByTestId("examples-list")).toContainText("Returning person");
    await shot(page, "06-examples");

    // 7. Preview and check: the form renders through the governed pipeline, and the checks pass.
    await expect(canvas(page).getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(canvas(page).getByLabel("Email address")).toBeVisible();
    await page.getByTestId("tab-design").click();
    await page.getByTestId("run-checks").click();
    await expect(page.getByTestId("authoring-bar")).toHaveAttribute("data-state", "pass", { timeout: 20_000 });
    await shot(page, "07-checked");

    // 8. Approve on this device.
    await page.getByTestId("approve").click();
    await page.getByTestId("approve-confirm-button").click();
    await expect(page.getByTestId("promotion-summary")).toContainText("resolved before this version was approved");
    await compositions(page);
    await expect(page.getByTestId("library-item-auth-form")).toContainText("v1 · Approved");
    await shot(page, "08-approved");

    // 9. Reopen from the Library after a reload: approved, with where it came from.
    await page.reload();
    await ready(page);
    await compositions(page);
    await page.getByTestId("library-item-auth-form").click();
    await inspector(page);
    await expect(page.getByTestId("promotion-summary")).toContainText("resolved before this version was approved");
    await expect(page.getByTestId("promotion-source")).toContainText("auth-form v1");
    await expect(canvas(page).getByLabel("Email address")).toBeVisible();
    await shot(page, "09-reopened");
    // The packaged compositions are where they were.
    await expect(page.getByTestId("library-item-hotel-search")).toContainText("v1 · Approved");
  });

  test("approval is refused until every block action is resolved; undo brings a removed part back", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLibrary(page);
    await promoteAuthForm(page);
    await row(page, "auth_forgot").getByTestId("promotion-remove-auth_forgot").click();
    await expect(row(page, "removed")).toBeVisible();
    await page.locator(".cl-toolbar__view").getByTestId("tt-undo").click();
    await expect(row(page, "auth_forgot")).toHaveAttribute("data-status", "to-resolve");
    await expect(page.getByTestId("promotion-blocked")).toContainText("5 things");
    // Discarding the draft removes it and its provenance; the block is still offered.
    await page.getByTestId("discard").click();
    await page.getByTestId("discard-confirm-button").click();
    await expect(page.getByTestId("library-item-auth-form")).toHaveCount(0);
    await compositions(page);
    await expect(page.getByTestId("block-auth-form")).toBeVisible();
    const stored = await page.evaluate(() => localStorage.getItem("composer.experimental.workspace.promotions"));
    expect(JSON.parse(stored!).data.promoted).toEqual([]);
  });

  test("records-table: what a composition cannot carry is said, not dropped", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLibrary(page);
    await compositions(page);
    await page.getByTestId("promote-records-table").click();
    await expect(page.getByTestId("promote-confirm")).toContainText("Not carried: The block's check that columns and rows.*.cells have the same length");
    await page.getByTestId("promote-confirm-button").click();
    await expect(row(page, "checks-blocking")).toContainText("still shows those fields");
    await expect(page.getByTestId("promotion-summary")).toContainText("to resolve");
  });

  for (const width of [1440, 390]) {
    test(`promotion has no axe violations at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openLibrary(page);
      if (width === 390) await page.getByTestId("toggle-library").click();
      await page.getByTestId("view-compositions").click();
      await page.getByTestId("promote-auth-form").click();
      let r = await new AxeBuilder({ page }).withTags(TAGS).include('[data-testid="composition-library"]').analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
      await page.getByTestId("promote-confirm-button").click();
      await expect(page.getByTestId("promotion-details")).toBeVisible();
      r = await new AxeBuilder({ page }).withTags(TAGS).include('[data-testid="composition-library"]').analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
      await expect(page.locator("body")).toHaveJSProperty("scrollWidth", width);
    });
  }
});
