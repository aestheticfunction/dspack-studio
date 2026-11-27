/**
 * Advanced authoring (experimental Library): the Structure view, canvas selection and the contextual element
 * inspector, and the authoring of typed input and actions on a draft. Agent-free: nothing here calls a model,
 * and every action pressed on the canvas is a preview.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const NS = "composer.experimental.workspace.";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const DISMISSED = JSON.stringify({ schema: "composer.experimental.workspace/onboarding", version: 1, data: { dismissed: true } });

async function openLibrary(page: Page) {
  await page.route("**/api/**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) }));
  await page.addInitScript((v) => {
    if (!sessionStorage.getItem("onboarding-seeded")) {
      localStorage.setItem("composer.experimental.workspace.onboarding", v);
      sessionStorage.setItem("onboarding-seeded", "1");
    }
  }, DISMISSED);
  await page.goto("/");
  await page.getByTestId("nav-library").click();
  await ready(page);
}
const ready = (page: Page) => expect(page.getByTestId("check-pill")).not.toHaveAttribute("data-state", "loading", { timeout: 30_000 });
const canvas = (page: Page) => page.locator('[data-project-canvas="composer"]:not(.cl-frame--kept)');
const storage = (page: Page) => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
const inspector = (page: Page) => page.getByTestId("element-inspector");

async function choose(page: Page, composition: string) {
  if ((await page.getByTestId("composition-library").getAttribute("data-library")) !== "open") await page.getByTestId("toggle-library").click();
  await page.getByTestId("view-compositions").click();
  await page.getByTestId(`library-item-${composition}`).click();
}
async function structure(page: Page) {
  if ((await page.getByTestId("composition-library").getAttribute("data-library")) !== "open") await page.getByTestId("toggle-library").click();
  await page.getByTestId("view-structure").click();
  await expect(page.getByTestId("structure-tree")).toBeVisible();
}
async function selectOn(page: Page) {
  const toggle = page.getByTestId("select-mode");
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
  await expect(page.getByTestId("select-layer")).toBeVisible();
}
async function selectOff(page: Page) {
  const toggle = page.getByTestId("select-mode");
  if ((await toggle.getAttribute("aria-pressed")) === "true") await toggle.click();
  await expect(page.getByTestId("select-layer")).toHaveCount(0);
}
/** Click a rendered component (by its A2UI id) where a person would: at the centre of what it draws. */
async function pick(page: Page, componentId: string) {
  const p = await page.locator(`[data-a2ui-id="${componentId}"]`).evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    const b = r.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await page.mouse.click(p.x, p.y);
}
async function runChecks(page: Page, expected: "pass" | "fail") {
  await page.getByTestId("run-checks").click();
  await expect(page.getByTestId("authoring-bar")).toHaveAttribute("data-state", expected);
}

test.describe("selection: one element shared by the canvas, Structure and the inspector", () => {
  test("picking a repeated button on the canvas selects the reusable element, says which item was picked, and Structure follows", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLibrary(page);
    await choose(page, "hotel-results");
    await selectOn(page);
    await expect(page.getByTestId("select-note")).toContainText("click an element to inspect it");
    await pick(page, "choose_2");
    await expect(inspector(page)).toHaveAttribute("data-key", "#choose");
    await expect(page.getByTestId("element-title")).toContainText("Button");
    await expect(page.getByTestId("element-repeat")).toContainText("You picked the one for “Hotel Miradouro” (item 2 of 3)");
    await expect(page.getByTestId("element-repeat")).toContainText("Changes here apply to every hotel");
    // Every item is outlined; the picked one strongest.
    await expect(page.getByTestId("selection-outline")).toHaveCount(3);
    await expect(page.locator('.cl-sel--on[data-testid="selection-outline"]')).toHaveAttribute("data-component", "choose_2");
    await expect(page.getByTestId("action-item-payload")).toContainText("For “Hotel Miradouro” it would send hotelId:");
    // Structure shows the template once, with the count on the canvas, and the same selection.
    await structure(page);
    const item = page.getByTestId("structure-#choose");
    await expect(item).toHaveAttribute("aria-selected", "true");
    await expect(item).toContainText("×3");
    await expect(page.getByTestId("structure-tree").getByRole("treeitem")).toHaveCount(9);
    // Choosing in Structure moves the selection (and the outline) to another element.
    await page.getByTestId("structure-#new-search").click();
    await expect(inspector(page)).toHaveAttribute("data-key", "#new-search");
    await expect(page.getByTestId("selection-outline")).toHaveCount(1);
    await expect(page.getByTestId("selection-outline")).toHaveAttribute("data-component", "new_search");
    // Escape leaves Select mode, and the canvas works again.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("select-mode")).toHaveAttribute("aria-pressed", "false");
    await canvas(page).getByRole("button", { name: "Choose Casa do Rio" }).click();
    await expect(page.getByTestId("action-note")).toContainText("Preview only, not run.");
  });

  test("the selection is a definition-level identity: it survives example changes, and an element not shown says where it is", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLibrary(page);
    await choose(page, "hotel-results");
    await structure(page);
    await page.getByTestId("structure-#choose").click();
    await expect(page.getByTestId("selection-outline")).toHaveCount(3);
    await page.getByTestId("scenario-two").click();
    await ready(page);
    await expect(inspector(page)).toHaveAttribute("data-key", "#choose");
    await expect(page.getByTestId("selection-outline")).toHaveCount(2);
    await page.getByTestId("scenario-none").click();
    await ready(page);
    await expect(inspector(page)).toHaveAttribute("data-key", "#choose");
    await expect(page.getByTestId("element-unavailable")).toContainText("Not on the canvas with this example: it appears in the Ready state. Choose an example that shows that state");
    await expect(page.getByTestId("selection-outline")).toHaveCount(0);
    await expect(page.getByTestId("structure-state")).toHaveValue("empty");
    // Another state's elements can still be inspected.
    await page.getByTestId("structure-state").selectOption("confirm");
    await page.getByTestId("structure-#reserve").click();
    await expect(page.getByTestId("element-title")).toContainText("Confirmation dialog");
    await expect(page.getByTestId("action-consequential")).toBeChecked();
    await expect(page.getByTestId("action-consequential")).toBeDisabled();
    await page.getByTestId("scenario-three").click();
    await ready(page);
    await page.getByTestId("structure-state").selectOption("ready");
    await page.getByTestId("structure-#choose").click();
    await expect(page.getByTestId("selection-outline")).toHaveCount(3);
    // Nothing about the selection is stored: it names template elements, never rendered ids.
    expect(Object.values(await storage(page)).join("")).not.toMatch(/choose_2|choose_3|#choose/);
  });

  test("keyboard: arrow keys move through Structure and the canvas follows; Enter opens the inspector", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLibrary(page);
    await choose(page, "hotel-search");
    await structure(page);
    await page.getByTestId("structure-ready@").focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    const second = page.getByTestId("structure-#destination");
    await expect(second).toBeFocused();
    await expect(second).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("selection-outline")).toHaveAttribute("data-component", "destination");
    await page.keyboard.press("End");
    await expect(page.getByTestId("structure-#search")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("structure-ready@")).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    // At 1280 one side panel at a time: the inspector opens in place of Structure (decision 18).
    await expect(inspector(page)).toBeVisible();
    await expect(page.getByTestId("element-title")).toContainText("Text");
  });
});

test.describe("authoring: typed input and actions on a draft", () => {
  test("journey: draft, select a field, edit its input, select a hotel action, edit what it sends, preview, meet and fix an invalid declaration, check, approve, reload", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLibrary(page);
    // 1. Create a draft of Hotel search.
    await choose(page, "hotel-search");
    await page.getByTestId("create-draft").click();
    await expect(page.getByRole("radio", { name: /v2 Draft/i })).toBeChecked();
    // 2. Select an input on the canvas.
    await selectOn(page);
    await pick(page, "check_in");
    await expect(inspector(page)).toHaveAttribute("data-key", "#check-in");
    await expect(page.getByTestId("input-form")).toBeVisible();
    // 3. Edit its binding; 7. an invalid declaration is refused in plain words, then resolved.
    await page.getByTestId("input-name").fill("destination");
    await page.getByTestId("input-name").press("Enter");
    await expect(page.getByTestId("element-error")).toHaveText("Not applied: Another typed field is already called “destination”. Choose a different name.");
    await page.getByTestId("input-name").fill("arrival");
    await page.getByTestId("input-name").press("Enter");
    await expect(page.getByTestId("element-applied")).toContainText("Renamed “arrival”.");
    await expect(page.getByTestId("authoring-bar")).toHaveAttribute("data-state", "unchecked");
    await page.getByTestId("input-required").uncheck();
    await expect(page.getByTestId("element-applied")).toContainText("Now optional.");
    // The search button sends the renamed field: the reference followed the rename.
    await pick(page, "search");
    await expect(page.getByTestId("carries-arrival")).toBeChecked();
    // The private loyalty field inherited from v1 is not masked: approval waits for it.
    await pick(page, "member_number");
    await expect(page.getByTestId("input-sensitive")).toBeChecked();
    await expect(page.getByTestId("input-mask")).toBeVisible();
    await runChecks(page, "pass");
    await expect(page.getByTestId("approval-blocked")).toContainText("Member number is private, but its field shows what is typed");
    await expect(page.getByTestId("approve")).toHaveCount(0);
    await page.getByTestId("mask-fix").click();
    await expect(page.getByTestId("approval-blocked")).toHaveCount(0);
    await expect(page.getByTestId("authoring-bar")).toHaveAttribute("data-state", "unchecked");
    // 6. Preview: the masked field draws as a password field, and pressing Search shows what it would send.
    await selectOff(page);
    await expect(canvas(page).locator('input[type="password"]')).toHaveCount(1);
    await canvas(page).getByLabel("Check-in date").fill("2026-12-04");
    await canvas(page).getByLabel(/Loyalty number/).fill("SECRET-123");
    await canvas(page).getByRole("button", { name: "Search hotels" }).click();
    const note = page.getByTestId("action-note");
    await expect(note).toContainText("Preview only, not run.");
    await expect(note).toContainText("2026-12-04");
    await expect(note).not.toContainText("SECRET-123");
    // 8. Run checks; 9. approve on this device; reload.
    await runChecks(page, "pass");
    await page.getByTestId("approve").click();
    await page.getByTestId("approve-confirm-button").click();
    await expect(page.getByTestId("authoring-notice")).toContainText("v2 is approved on this device.");
    const stored = await storage(page);
    expect(Object.values(stored).join("")).not.toContain("SECRET-123");
    const approved = JSON.parse(stored[`${NS}versions`]!).data.approved[0];
    expect(approved.inputs.find((i: { node: string }) => i.node === "check-in")).toMatchObject({ name: "arrival" });
    expect(approved.inputs.find((i: { node: string }) => i.node === "check-in").required).toBeUndefined();
    await page.reload();
    await ready(page);
    await choose(page, "hotel-search");
    await page.getByRole("radio", { name: /v2 Approved/i }).check();
    await expect(canvas(page).locator('input[type="password"]')).toHaveCount(1);
    // An approved version is read-only in the inspector.
    await selectOn(page);
    await pick(page, "check_in");
    await expect(page.getByTestId("element-readonly")).toContainText("approved and cannot change");
    await expect(page.getByTestId("input-form")).toHaveCount(0);
  });

  test("hotel action in a repeat: edit what each hotel's Choose sends, preview item k sending item k's values, and keep the safeguards", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLibrary(page);
    await choose(page, "hotel-results");
    await page.getByRole("radio", { name: /v2 Draft/i }).check();
    await selectOn(page);
    // 4. Select a hotel action within the repeat.
    await pick(page, "choose_3");
    await expect(page.getByTestId("element-repeat")).toContainText("“Lumen Chiado” (item 3 of 3)");
    // 5. Inspect and edit its payload: only the item's own fields are offered.
    const options = await page.getByTestId("payload-source-hotelId").locator("option").allTextContents();
    expect(options).toEqual(["Hotel id", "Hotel name", "Hotel area", "Hotel price", "Hotel rating", "Fixed value…"]);
    await page.getByTestId("payload-add").click();
    await page.getByTestId("payload-new-key").fill("hotel name");
    await page.getByTestId("payload-new-source").selectOption("field:hotel.name");
    await page.getByTestId("payload-new-add").click();
    await expect(page.getByTestId("element-error")).toContainText("letters and digits only");
    await page.getByTestId("payload-add").click();
    await page.getByTestId("payload-new-key").fill("hotelName");
    await page.getByTestId("payload-new-source").selectOption("field:hotel.name");
    await page.getByTestId("payload-new-add").click();
    await expect(page.getByTestId("element-applied")).toContainText("It now also sends “hotelName”.");
    await expect(page.getByTestId("payload-hotelName")).toContainText("Hotel name");
    // A repeated action cannot send typed fields; the option is not offered.
    await expect(page.locator('[data-testid^="carries-"]')).toHaveCount(0);
    // 6. Preview: each item sends its own values.
    await selectOff(page);
    for (const name of ["Casa do Rio", "Lumen Chiado"]) {
      await canvas(page).getByRole("button", { name: `Choose ${name}` }).click();
      await expect(page.getByTestId("action-note")).toContainText(name);
    }
    // Safeguards: the confirmation stays a confirmation.
    await page.getByTestId("scenario-confirm").click();
    await ready(page);
    await selectOn(page);
    await pick(page, "reserve");
    await expect(page.getByTestId("action-consequential")).toBeChecked();
    await expect(page.getByTestId("action-consequential")).toBeDisabled();
    await expect(page.locator('[data-testid^="carries-"]')).toHaveCount(0);
    // Checks run on the edited draft and pass; nothing was approved.
    await runChecks(page, "pass");
    const versions = (await storage(page))[`${NS}versions`];
    expect(versions ? JSON.parse(versions).data.approved : []).toEqual([]);
    const drafts = JSON.parse((await storage(page))[`${NS}drafts`]!).data.drafts;
    expect(drafts[0].actions.find((a: { name: string }) => a.name === "choose").payload).toEqual({ hotelId: { $prop: "hotel.id" }, hotelName: { $prop: "hotel.name" } });
  });
});

test.describe("accessibility and isolation", () => {
  for (const [w, h] of [
    [1280, 800],
    [390, 844],
  ] as const)
    test(`axe at ${w} px: Structure and the element inspector on a draft, with no exceptions`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await openLibrary(page);
      await choose(page, "hotel-results");
      await page.getByRole("radio", { name: /v2 Draft/i }).check();
      await structure(page);
      const s = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      expect(s.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
      await page.getByTestId("structure-#choose").click();
      await page.getByTestId("structure-#choose").press("Enter");
      await expect(inspector(page)).toBeVisible();
      const i = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      expect(i.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
      // Targets in the new controls meet the 24 px floor.
      const small = await inspector(page).evaluate((root) =>
        [...root.querySelectorAll("button, select, input")].filter((el) => el.getClientRects().length && el.getBoundingClientRect().height < 24 && (el as HTMLInputElement).type !== "checkbox").map((el) => el.outerHTML.slice(0, 60)),
      );
      expect(small).toEqual([]);
    });

  test("selecting never restyles the canvas: its computed styles are identical with and without a selection", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLibrary(page);
    await choose(page, "hotel-results");
    const styles = () =>
      canvas(page).evaluate((frame) =>
        [frame, ...frame.querySelectorAll("*")].map((el) => {
          const cs = getComputedStyle(el);
          return ["color", "background-color", "outline-style", "box-shadow", "border-top-color", "font-size", "color-scheme"].map((p) => cs.getPropertyValue(p)).join(";");
        }),
      );
    const before = await styles();
    await selectOn(page);
    await pick(page, "choose_2");
    await selectOff(page);
    await expect(page.getByTestId("selection-outline")).toHaveCount(3);
    expect(await styles()).toEqual(before);
  });
});
