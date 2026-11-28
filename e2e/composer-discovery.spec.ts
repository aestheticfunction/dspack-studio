/**
 * Local agent-facing discovery (experimental, local and synthetic): the eight demonstrations.
 * 1. Hotel results is eligible and discoverable.
 * 2. Hotel search v1 is excluded: it needs a safety update.
 * 3. A corrected Hotel search version becomes discoverable once approved.
 * 4. An unresolved promoted composition is excluded.
 * 5. Resolved and approved, it becomes discoverable.
 * 6. Withdrawing approval removes the exact version from discovery.
 * 7. A reference obtained before the withdrawal is refused.
 * 8. Restoring needs current authorization and passing checks; then it is discoverable again.
 *
 * DISCOVERY_SHOTS=1 writes the screenshots to docs/repositioning/m1/discovery/.
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
const lib = (page: Page) => page.getByTestId("composition-library");
const shot = async (page: Page, name: string) => {
  if (process.env.DISCOVERY_SHOTS) await page.screenshot({ path: `docs/repositioning/m1/discovery/${name}.png` });
};
async function leftPanel(page: Page) {
  if ((await lib(page).getAttribute("data-library")) !== "open") await page.getByTestId("toggle-library").click();
}
async function agents(page: Page) {
  await leftPanel(page);
  await page.getByTestId("view-agents").click();
  await expect(page.getByTestId("discovery")).toBeVisible();
}
async function compositions(page: Page) {
  await leftPanel(page);
  await page.getByTestId("view-compositions").click();
}
async function choose(page: Page, id: string) {
  await compositions(page);
  await page.getByTestId(`library-item-${id}`).click();
  await ready(page);
}
async function inspector(page: Page) {
  if ((await lib(page).getAttribute("data-inspector")) !== "open") await page.getByTestId("toggle-inspector").click();
  await page.getByTestId("tab-design").click();
}
async function structure(page: Page) {
  await leftPanel(page);
  await page.getByTestId("view-structure").click();
  await expect(page.getByTestId("structure-tree")).toBeVisible();
}
async function add(page: Page, position: string, component: string, label: string) {
  await page.getByTestId("tt-add").click();
  await page.getByTestId(`tt-pos-${position}`).check();
  await page.getByTestId(`tt-component-${component}`).check();
  await page.getByTestId("tt-label").fill(label);
  await page.getByTestId("tt-add-confirm").click();
}
const row = (page: Page, id: string) => page.getByTestId(`promotion-row-${id}`);
async function checkAndApprove(page: Page) {
  await inspector(page);
  await page.getByTestId("run-checks").click();
  await expect(page.getByTestId("authoring-bar")).toHaveAttribute("data-state", "pass", { timeout: 20_000 });
  await page.getByTestId("approve").click();
  await page.getByTestId("approve-confirm-button").click();
}
const machine = async (page: Page) => {
  await page.getByTestId("discovery-machine").locator("summary").click();
  const json = JSON.parse((await page.getByTestId("discovery-json").textContent())!);
  await page.getByTestId("discovery-machine").locator("summary").click();
  return json;
};

test.describe("local agent-facing discovery", () => {
  test("the eight demonstrations, on the Library's own compositions", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLibrary(page);

    // 1. Hotel results v1 is eligible and discoverable; a local agent resolves its exact reference.
    await agents(page);
    await expect(page.getByTestId("discovery-eligible-hotel-results-1")).toContainText("Exact approved version available · not published");
    const first = await machine(page);
    expect(first).toMatchObject({ schema: "composer.local-discovery/1", scope: "local-synthetic", published: false });
    expect(first.eligible[0].reference).toEqual({ composition: "hotel-results", version: 1, definitionSha256: "232a1fe4fced886cf199eef6fca846cde693cda5071be0b8737e39dfbe0ed913" });
    await page.getByTestId("discovery-resolve-hotel-results-1").click();
    await expect(page.getByTestId("discovery-resolution")).toHaveAttribute("data-ok", "true");
    await expect(page.getByTestId("discovery-resolution")).toContainText("through the governed pipeline");
    await shot(page, "01-discoverable");

    // 2. Hotel search v1 is excluded: it needs a safety update. Its draft-free history stays as it is.
    await expect(page.getByTestId("discovery-excluded-hotel-search-1")).toContainText("Member number is private, but its field shows what is typed.");
    await page.getByTestId("discovery-excluded-hotel-search-1").scrollIntoViewIfNeeded();
    await shot(page, "02-excluded-safety");

    // 3. A corrected Hotel search: a draft, its private field masked, checked and approved. It becomes discoverable.
    await choose(page, "hotel-search");
    await page.getByTestId("create-draft").click();
    await inspector(page);
    await page.getByTestId("mask-fix").click();
    await checkAndApprove(page);
    await expect(page.getByRole("radio", { name: /v2 Approved/i })).toBeChecked();
    await agents(page);
    await expect(page.getByTestId("discovery-eligible-hotel-search-2")).toBeVisible();
    await expect(page.getByTestId("discovery-excluded-hotel-search-1")).toBeVisible();
    await shot(page, "03-corrected-discoverable");

    // 4. An unresolved promoted composition is excluded, with what is unresolved.
    await compositions(page);
    await page.getByTestId("promote-auth-form").click();
    await page.getByTestId("promote-confirm-button").click();
    await expect(page.getByTestId("promotion-details")).toBeVisible();
    await agents(page);
    const unresolved = page.getByTestId("discovery-excluded-auth-form-1");
    await expect(unresolved).toContainText("Only an approved version can be used by agents; this is a draft.");
    await expect(unresolved).not.toContainText("withdrawn");
    await expect(unresolved.locator('[data-kind="promotion"]').first()).toBeVisible();
    await unresolved.scrollIntoViewIfNeeded();
    await shot(page, "04-promotion-excluded");

    // 5. Resolved as in the promotion walkthrough, checked and approved: discoverable.
    await compositions(page);
    await page.getByTestId("library-item-auth-form").click();
    await ready(page);
    await inspector(page);
    await row(page, "auth_submit").getByTestId("promotion-map-auth_submit").click();
    await row(page, "auth_forgot").getByTestId("promotion-remove-auth_forgot").click();
    await expect(row(page, "auth_forgot")).toHaveCount(0);
    await row(page, "repeat-providers").getByTestId("promotion-remove-repeat-providers").click();
    await expect(row(page, "repeat-providers")).toHaveCount(0);
    await structure(page);
    await inspector(page);
    await page.getByTestId("structure-#auth-submit").click();
    await add(page, "before", "text-input", "Email address");
    await page.getByTestId("structure-#auth-submit").click();
    await add(page, "before", "text-input", "Password");
    await page.getByTestId("input-sensitive").check();
    await inspector(page);
    await page.getByTestId("draft-resolve").or(page.getByTestId("promotion-review")).first().click();
    await row(page, "input-fields").getByTestId("promotion-remove-input-fields").click();
    await expect(page.getByTestId("promotion-summary")).toContainText("Everything from the block is resolved");
    await checkAndApprove(page);
    await expect(page.getByTestId("promotion-summary")).toContainText("resolved before this version was approved");
    await agents(page);
    await expect(page.getByTestId("discovery-eligible-auth-form-1")).toBeVisible();
    const withAuth = await machine(page);
    const auth = withAuth.eligible.find((e: any) => e.reference.composition === "auth-form");
    expect(auth.inputs.find((i: any) => i.name === "password")).toEqual({ name: "password", kind: "text", required: false, private: true });
    await page.getByTestId("discovery-eligible-auth-form-1").scrollIntoViewIfNeeded();
    await shot(page, "05-promotion-discoverable");

    // 6. Withdrawing Hotel results v1 removes exactly that version from discovery.
    await choose(page, "hotel-results");
    await page.getByRole("radio", { name: /v1 Approved/i }).check();
    await ready(page);
    await inspector(page);
    await page.getByTestId("withdraw").click();
    await page.getByTestId("withdraw-confirm-button").click();
    await expect(page.getByTestId("approval-withdrawn")).toBeVisible();
    await agents(page);
    await expect(page.getByTestId("discovery-eligible-hotel-results-1")).toHaveCount(0);
    await expect(page.getByTestId("discovery-excluded-hotel-results-1")).toContainText("Its approval is withdrawn on this device.");
    await expect(page.getByTestId("discovery-eligible-hotel-search-2")).toBeVisible();
    await shot(page, "06-withdrawn-removed");

    // 7. The reference obtained in step 1 is refused now.
    await page.getByTestId("discovery-resolve-again").click();
    await expect(page.getByTestId("discovery-resolution")).toHaveAttribute("data-ok", "false");
    await expect(page.getByTestId("discovery-resolution")).toContainText("Refused: Hotel results v1 is not eligible for agents now");
    await expect(page.getByTestId("discovery-resolution")).toContainText("Its approval is withdrawn on this device.");
    await page.getByTestId("discovery-resolution").scrollIntoViewIfNeeded();
    await shot(page, "07-reference-refused");

    // 8. Restoring runs the checks now, under current authorization; then the same reference resolves again.
    await compositions(page);
    await page.getByTestId("refusal-restore").click();
    await expect(page.getByTestId("restore-confirm")).toContainText("Its checks run again now");
    await page.getByTestId("restore-confirm-button").click();
    await expect(page.getByTestId("check-pill")).toHaveAttribute("data-state", "pass", { timeout: 20_000 });
    await agents(page);
    await expect(page.getByTestId("discovery-eligible-hotel-results-1")).toBeVisible();
    await page.getByTestId("discovery-resolve-again").click();
    await expect(page.getByTestId("discovery-resolution")).toHaveAttribute("data-ok", "true");
    await shot(page, "08-restored");
  });

  test("a withdrawal in another tab applies to discovery here at the next request, without relying on what this tab showed", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const a = await context.newPage();
    const b = await context.newPage();
    await openLibrary(a);
    await openLibrary(b);
    await agents(b);
    await expect(b.getByTestId("discovery-eligible-hotel-results-1")).toBeVisible();
    await a.getByRole("radio", { name: /v1 Approved/i }).check();
    await ready(a);
    await inspector(a);
    await a.getByTestId("withdraw").click();
    await a.getByTestId("withdraw-confirm-button").click();
    await expect(a.getByTestId("approval-withdrawn")).toBeVisible();
    await b.getByTestId("discovery-refresh").click();
    await expect(b.getByTestId("discovery-eligible-hotel-results-1")).toHaveCount(0);
    await expect(b.getByTestId("discovery-excluded-hotel-results-1")).toContainText("withdrawn");
    await context.close();
  });

  for (const width of [1440, 390]) {
    test(`the Agents view passes axe at ${width} px and is keyboard-reachable`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openLibrary(page);
      await agents(page);
      await page.getByTestId("discovery-resolve-hotel-results-1").focus();
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("discovery-resolution")).toHaveAttribute("data-ok", "true");
      await page.getByTestId("discovery-machine").locator("summary").focus();
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("discovery-json")).toBeVisible();
      const r = await new AxeBuilder({ page }).withTags(TAGS).include('[data-testid="composition-library"]').analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
      await expect(page.locator("body")).toHaveJSProperty("scrollWidth", width);
      // The panel's three views fit its width: nothing scrolls sideways.
      const overflow = await page.evaluate(() => {
        const panel = document.querySelector(".cl-switch")!.closest("aside")!;
        return panel.scrollWidth - panel.clientWidth;
      });
      expect(overflow).toBe(0);
    });
  }
});
