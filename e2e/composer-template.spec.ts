/**
 * Visual template editing (experimental Library): change what an element shows, give it an id, insert, move and
 * remove elements with their declarations, undo, preview, check, approve, withdraw, and reload. Agent-free.
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
const storage = (page: Page) => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
const tree = (page: Page, key: string) => page.getByTestId(`structure-${key}`);
async function structure(page: Page) {
  if ((await page.getByTestId("composition-library").getAttribute("data-library")) !== "open") await page.getByTestId("toggle-library").click();
  await page.getByTestId("view-structure").click();
  await expect(page.getByTestId("structure-tree")).toBeVisible();
}
/** At 1440 px both side panels stay open: Structure on the left, the inspector on the right. */
async function inspectorToo(page: Page) {
  if ((await page.getByTestId("composition-library").getAttribute("data-inspector")) !== "open") await page.getByTestId("toggle-inspector").click();
  await expect(page.getByTestId("composition-library")).toHaveAttribute("data-library", "open");
}
async function choose(page: Page, composition: string) {
  if ((await page.getByTestId("composition-library").getAttribute("data-library")) !== "open") await page.getByTestId("toggle-library").click();
  await page.getByTestId("view-compositions").click();
  await page.getByTestId(`library-item-${composition}`).click();
}
async function add(page: Page, position: "before" | "after" | "inside", component: string, label: string) {
  await page.getByTestId("tt-add").click();
  await page.getByTestId(`tt-pos-${position}`).check();
  await page.getByTestId(`tt-component-${component}`).check();
  await page.getByTestId("tt-label").fill(label);
  await page.getByTestId("tt-add-confirm").click();
}

test.describe("visual template editing", () => {
  test("journey on Hotel results: content, id, insert, configure, reorder, a refused move resolved, remove and undo, preview, check, approve, withdraw, reload", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLibrary(page);
    // 1. Open the packaged draft.
    await page.getByRole("radio", { name: /v2 Draft/i }).check();
    await ready(page);
    await structure(page);
    await inspectorToo(page);
    // 2-3. Select an element and change what it shows: Change search becomes Start over.
    await tree(page, "#new-search").click();
    await page.getByTestId("content-label-text-0").fill("Start over");
    await page.getByTestId("content-label-apply").click();
    await expect(page.getByTestId("content-applied")).toContainText("Label changed.");
    await expect(canvas(page).getByRole("button", { name: "Start over" })).toBeVisible();
    await expect(page.getByTestId("authoring-bar")).toHaveAttribute("data-state", "unchecked");
    // An enum prop from the contract: the button's style.
    await page.getByTestId("content-variant").selectOption("primary");
    await expect(page.getByTestId("content-applied")).toContainText("Variant changed.");
    // 4. Give the price note an id: its key follows.
    await tree(page, "ready@1").click();
    await page.getByTestId("identity-input").fill("price note");
    await page.getByTestId("identity-apply").click();
    await expect(page.getByTestId("identity-error")).toContainText("lowercase letters");
    await page.getByTestId("identity-input").fill("price-note");
    await page.getByTestId("identity-apply").click();
    await expect(tree(page, "#price-note")).toHaveAttribute("aria-selected", "true");
    // 5-6. Insert a button inside each hotel's card: it comes with its repeated action. Set what it sends.
    await tree(page, "ready@2.0.0").click();
    await add(page, "inside", "button", "Show on map");
    await expect(tree(page, "#show-on-map")).toBeFocused();
    await expect(page.getByTestId("element-repeat")).toContainText("Changes here apply to every hotel");
    await expect(canvas(page).getByRole("button", { name: "Show on map" })).toHaveCount(3);
    await page.getByTestId("payload-add").click();
    await page.getByTestId("payload-new-key").fill("hotelId");
    await page.getByTestId("payload-new-source").selectOption("field:hotel.id");
    await page.getByTestId("payload-new-add").click();
    await expect(page.getByTestId("element-applied")).toContainText("It now also sends “hotelId”.");
    // 7. Reorder: Show on map moves above Choose, in every card.
    await page.getByTestId("tt-up").click();
    await expect(tree(page, "#show-on-map")).toBeFocused();
    const order = await canvas(page).getByRole("button").allTextContents();
    expect(order.indexOf("Show on map")).toBeLessThan(order.indexOf("Choose Casa do Rio"));
    // 8. An invalid structural operation: moving Start over into each hotel's repeat would give each item two
    //    elements. It is known before anything is chosen (tried through the loader on a copy): the container is
    //    listed with the reason and cannot be chosen. It is resolved by moving it somewhere valid.
    await tree(page, "#new-search").click();
    await page.getByTestId("tt-move").click();
    const repeatTarget = page.getByTestId("tt-move-target").locator('option[value="ready@2.0"]');
    await expect(repeatTarget).toBeDisabled();
    await expect(repeatTarget).toContainText("Each item of a repeat must be one element");
    await expect(tree(page, "#new-search")).toBeVisible();
    await page.getByTestId("tt-move-target").selectOption("ready@");
    await page.getByTestId("tt-move-confirm").click();
    await expect(page.getByTestId("tt-error")).toHaveCount(0);
    // Remove, with its dependency said first, then undo.
    await tree(page, "#show-on-map").click();
    await page.getByTestId("tt-remove").click();
    await expect(page.getByTestId("tt-remove-effects")).toContainText("The “Show on map” action is removed.");
    await page.getByTestId("tt-remove-confirm").click();
    await expect(tree(page, "#show-on-map")).toHaveCount(0);
    await expect(canvas(page).getByRole("button", { name: "Show on map" })).toHaveCount(0);
    await page.getByTestId("tt-undo").click();
    await expect(tree(page, "#show-on-map")).toBeVisible();
    await expect(canvas(page).getByRole("button", { name: "Show on map" })).toHaveCount(3);
    // 9. Preview: Leave nothing selected-mode; pressing Show on map for one hotel sends that hotel's id.
    await canvas(page).getByRole("button", { name: "Show on map" }).nth(1).click();
    await expect(page.getByTestId("action-note")).toContainText("Preview only, not run.");
    await expect(page.getByTestId("action-note")).toContainText("h-");
    // 10. Run checks and approve.
    await page.getByTestId("run-checks").click();
    await expect(page.getByTestId("authoring-bar")).toHaveAttribute("data-state", "pass");
    await page.getByTestId("approve").click();
    await page.getByTestId("approve-confirm-button").click();
    await expect(page.getByRole("radio", { name: /v2 Approved/i })).toBeChecked();
    // 11. Withdraw the local approval: the definition does not change.
    const approvedBefore = JSON.parse((await storage(page))[`${NS}versions`]!).data.approved[0];
    if ((await page.getByTestId("composition-library").getAttribute("data-inspector")) !== "open") await page.getByTestId("toggle-inspector").click();
    await page.getByTestId("element-back").click().catch(() => {});
    await page.getByTestId("tab-design").click();
    await page.getByTestId("withdraw").click();
    await page.getByTestId("withdraw-confirm-button").click();
    await expect(page.getByTestId("approval-withdrawn")).toBeVisible();
    expect(JSON.parse((await storage(page))[`${NS}versions`]!).data.approved[0]).toEqual(approvedBefore);
    // 12. Reload: v2 is approved, withdrawn, and still has every edit.
    await page.reload();
    await ready(page);
    await expect(page.getByRole("radio", { name: /v2 Withdrawn/i })).toBeChecked();
    await expect(page.getByTestId("refusal")).toHaveAttribute("data-stage", "withdrawn");
    expect(JSON.stringify(approvedBefore)).toContain("show-on-map");
    expect(JSON.stringify(approvedBefore)).toContain("Start over");
    expect(JSON.stringify(approvedBefore)).toContain("price-note");
    // v1 is untouched.
    await page.getByRole("radio", { name: /v1 Approved/i }).check();
    await ready(page);
    await expect(canvas(page).getByRole("button", { name: "Show on map" })).toHaveCount(0);
  });

  test("Hotel search: a content change applies in every state that shows the element; an inserted text field comes with its typed input", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLibrary(page);
    await choose(page, "hotel-search");
    await page.getByTestId("create-draft").click();
    await structure(page);
    await inspectorToo(page);
    await tree(page, "#destination").click();
    await expect(page.getByTestId("content-editor")).toContainText("appears in 2 states");
    await page.getByTestId("content-label-text-0").fill("Where to");
    await page.getByTestId("content-label-apply").click();
    await expect(canvas(page).getByLabel("Where to")).toBeVisible();
    await page.getByTestId("scenario-invalid").click();
    await ready(page);
    await expect(canvas(page).getByLabel("Where to")).toBeVisible();
    await page.getByTestId("scenario-ready").click();
    await ready(page);
    await tree(page, "#guests").click();
    await add(page, "after", "text-input", "Promo code");
    await expect(tree(page, "#promo-code")).toBeFocused();
    await expect(page.getByTestId("input-form")).toBeVisible();
    await expect(canvas(page).getByLabel("Promo code")).toBeVisible();
    const drafts = JSON.parse((await storage(page))[`${NS}drafts`]!).data.drafts;
    expect(drafts[0].inputs.find((i: { node: string }) => i.node === "promo-code")).toEqual({ name: "promoCode", node: "promo-code", kind: "text", maxLength: 80 });
    // A text field cannot go inside a repeat; a button cannot hold elements: the choices say why.
    await tree(page, "#search").click();
    await page.getByTestId("tt-add").click();
    await expect(page.getByTestId("tt-pos-inside")).toBeDisabled();
    // Keyboard undo, outside text fields: the field goes, and so does its typed input.
    await tree(page, "#search").focus();
    await page.keyboard.press("Control+z");
    await expect(tree(page, "#promo-code")).toHaveCount(0);
    expect(JSON.parse((await storage(page))[`${NS}drafts`]!).data.drafts[0].inputs.map((i: { name: string }) => i.name)).not.toContain("promoCode");
  });

  test("approved versions are read-only: no structure tools, content shown, not editable", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLibrary(page);
    await page.getByRole("radio", { name: /v1 Approved/i }).check();
    await structure(page);
    await expect(page.getByTestId("template-tools")).toHaveCount(0);
    await tree(page, "#new-search").press("Enter");
    await expect(page.getByTestId("content-editor")).toHaveCount(0);
    await expect(page.getByTestId("element-inspector")).toContainText("Create a draft to change what it shows.");
  });

  for (const [w, h] of [
    [1280, 800],
    [390, 844],
  ] as const)
    test(`axe at ${w} px: structure tools, the add panel and the content editor, with no exceptions`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await openLibrary(page);
      await page.getByRole("radio", { name: /v2 Draft/i }).check();
      await structure(page);
      await tree(page, "#new-search").click();
      await page.getByTestId("tt-add").click();
      const a = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      expect(a.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
      await tree(page, "#new-search").press("Enter");
      await expect(page.getByTestId("content-editor")).toBeVisible();
      const b = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      expect(b.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    });
});

/** The stored draft of a composition at a version, as the workspace wrote it. */
async function storedDraft(page: Page, id: string, version: number) {
  const raw = (await storage(page))[`${NS}drafts`];
  return raw ? (JSON.parse(raw).data.drafts as Array<Record<string, any>>).find((d) => d.id === id && d.version === version) : undefined;
}
const nodeById = (template: unknown, id: string): Record<string, any> | undefined => {
  if (!template || typeof template !== "object") return undefined;
  if (Array.isArray(template)) return template.map((t) => nodeById(t, id)).find(Boolean);
  const t = template as Record<string, any>;
  if (t.id === id) return t;
  return [t.children, t.else, t.$each?.template, t.$each?.children, t.template].map((c) => nodeById(c, id)).find(Boolean);
};

test.describe("authoring review corrections (Priority 1)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLibrary(page);
    await page.getByRole("radio", { name: /v2 Draft/i }).check();
    await ready(page);
    await structure(page);
    await inspectorToo(page);
  });

  test("F1: a boolean prop turns off again; the canvas follows and the prop is removed", async ({ page }) => {
    await tree(page, "#new-search").click();
    await page.getByTestId("content-isDisabled").check();
    await expect(canvas(page).getByRole("button", { name: "Change search" })).toBeDisabled();
    await page.getByTestId("content-isDisabled").uncheck();
    await expect(page.getByTestId("content-isDisabled")).not.toBeChecked();
    await expect(page.getByTestId("content-error")).toHaveCount(0);
    await expect(canvas(page).getByRole("button", { name: "Change search" })).toBeEnabled();
    const d = await storedDraft(page, "hotel-results", 2);
    expect(nodeById(d!.states.find((s: any) => s.id === "ready").template, "new-search")!.props?.isDisabled).toBeUndefined();
  });

  test("F2: an enum prop goes back to the design system's default", async ({ page }) => {
    await tree(page, "#new-search").click();
    await page.getByTestId("content-variant").selectOption("primary");
    await expect(page.getByTestId("content-applied")).toContainText("Variant changed.");
    await page.getByTestId("content-variant").selectOption("");
    await expect(page.getByTestId("content-error")).toHaveCount(0);
    await expect(page.getByTestId("content-applied")).toContainText("Variant is not set: the design system's default applies.");
    const d = await storedDraft(page, "hotel-results", 2);
    expect(nodeById(d!.states.find((s: any) => s.id === "ready").template, "new-search")!.props?.variant).toBeUndefined();
  });

  test("F3: undo takes back only its element or structure edit; a later summary edit stays", async ({ page }) => {
    await tree(page, "#new-search").click();
    await page.getByTestId("tt-up").click();
    await expect(page.getByTestId("tt-status")).toContainText("Moved up.");
    const moved = JSON.stringify((await storedDraft(page, "hotel-results", 2))!.states);
    await page.getByTestId("element-back").click();
    await page.getByTestId("edit-summary").fill("Hotels the search found, to compare.");
    await expect.poll(async () => (await storedDraft(page, "hotel-results", 2))?.summary).toBe("Hotels the search found, to compare.");
    await page.getByTestId("tt-undo").click();
    await expect(page.getByTestId("tt-status")).toContainText("Undone: moved up.");
    const after = (await storedDraft(page, "hotel-results", 2))!;
    expect(after.summary).toBe("Hotels the search found, to compare.");
    expect(JSON.stringify(after.states)).not.toBe(moved);
    await page.getByTestId("tt-redo").click();
    await expect(page.getByTestId("tt-status")).toContainText("Redone: moved up.");
    const redone = (await storedDraft(page, "hotel-results", 2))!;
    expect(JSON.stringify(redone.states)).toBe(moved);
    expect(redone.summary).toBe("Hotels the search found, to compare.");
  });

  test("F3: an inspector content edit is a step of its own: undo puts back the label, then the move", async ({ page }) => {
    await tree(page, "#new-search").click();
    await page.getByTestId("tt-up").click();
    await page.getByTestId("content-label-text-0").fill("Search again");
    await page.getByTestId("content-label-apply").click();
    await expect(canvas(page).getByRole("button", { name: "Search again" })).toBeVisible();
    await page.getByTestId("tt-undo").click();
    await expect(page.getByTestId("tt-status")).toContainText("Undone: label change.");
    await expect(canvas(page).getByRole("button", { name: "Change search" })).toBeVisible();
    await page.getByTestId("tt-undo").click();
    await expect(page.getByTestId("tt-status")).toContainText("Undone: moved up.");
    await expect(page.getByTestId("tt-undo")).toBeDisabled();
  });

  test("F4: undo history ends with its draft: discard, create a draft, and nothing can be undone into it", async ({ page }) => {
    // The work that is discarded: a move and a label change on v2.
    await tree(page, "#new-search").click();
    await page.getByTestId("tt-up").click();
    await page.getByTestId("content-label-text-0").fill("Discarded label");
    await page.getByTestId("content-label-apply").click();
    await expect(page.getByTestId("tt-undo")).toBeEnabled();
    await page.getByTestId("element-back").click();
    await page.getByTestId("discard").click();
    await page.getByTestId("discard-confirm-button").click();
    await expect(page.getByTestId("authoring-notice")).toContainText("discarded");
    await page.getByTestId("create-draft").click();
    await ready(page);
    await structure(page);
    await expect(page.getByTestId("tt-undo")).toBeDisabled();
    await expect(page.getByTestId("tt-redo")).toBeDisabled();
    await page.locator("body").press("Control+z");
    await page.locator("body").press("Control+Shift+z");
    // The new draft is v1's content, and nothing of the discarded draft comes back.
    await expect(canvas(page).getByRole("button", { name: "New search" })).toBeVisible();
    await expect(canvas(page).getByText("Discarded label")).toHaveCount(0);
    const raw = (await storage(page))[`${NS}drafts`];
    const drafts = (raw ? JSON.parse(raw).data.drafts : []) as Array<Record<string, any>>;
    expect(JSON.stringify(drafts.filter((x) => x.id === "hotel-results"))).not.toContain("Discarded label");
    await expect(page.getByTestId("tt-status")).toHaveCount(0);
  });

  test("F4: approving a draft ends its undo history", async ({ page }) => {
    await tree(page, "#new-search").click();
    await page.getByTestId("content-label-text-0").fill("Search again");
    await page.getByTestId("content-label-apply").click();
    await expect(page.getByTestId("tt-undo")).toBeEnabled();
    await page.getByTestId("element-back").click();
    await page.getByTestId("run-checks").click();
    await expect(page.getByTestId("authoring-bar")).toHaveAttribute("data-state", "pass");
    await page.getByTestId("approve").click();
    await page.getByTestId("approve-confirm-button").click();
    await expect(page.getByRole("radio", { name: /v2 Approved/i })).toBeChecked();
    await expect(page.getByTestId("template-tools")).toHaveCount(0);
    await page.locator("body").press("Control+z");
    await expect(canvas(page).getByRole("button", { name: "Search again" })).toBeVisible();
  });

  test("F5: Add opens on a position and component that work, and an impossible position says why before anything is chosen", async ({ page }) => {
    // The outermost card: nothing beside it, so Add opens inside it.
    await tree(page, "ready@").click();
    await page.getByTestId("tt-add").click();
    await expect(page.getByTestId("tt-pos-inside")).toBeChecked();
    await expect(page.getByTestId("tt-pos-after")).toBeDisabled();
    await expect(page.getByTestId("tt-add-panel")).toContainText("Nothing can be placed beside the outermost element.");
    await expect(page.getByTestId("tt-add-confirm")).toBeEnabled();
    await page.keyboard.press("Escape");
    // The single element of each hotel's item: nothing can go beside it, for any component, with the reason now.
    await tree(page, "ready@2.0.0").click();
    await page.getByTestId("tt-add").click();
    await expect(page.getByTestId("tt-pos-inside")).toBeChecked();
    await expect(page.getByTestId("tt-pos-after")).toBeDisabled();
    await expect(page.getByTestId("tt-add-panel")).toContainText("Each item of a repeat must be one element");
    await page.getByTestId("tt-add-confirm").click();
    await expect(page.getByTestId("tt-error")).toHaveCount(0);
    // A text, after Inside was used: Add opens After it, never on a dead Inside.
    await tree(page, "ready@1").click();
    await page.getByTestId("tt-add").click();
    await expect(page.getByTestId("tt-pos-after")).toBeChecked();
    await expect(page.getByTestId("tt-pos-inside")).toBeDisabled();
    await expect(page.getByTestId("tt-add-confirm")).toBeEnabled();
  });

  test("F6: an edit's result is beside its control and in view; structure edits say what happened", async ({ page }) => {
    await tree(page, "#new-search").click();
    await page.getByTestId("content-isDisabled").check();
    const applied = page.getByTestId("content-applied");
    await expect(applied).toBeInViewport();
    // It sits in the same control group as the checkbox that made it.
    expect(await applied.evaluate((el) => !!el.closest(".cl-content__control")?.querySelector('[data-testid="content-isDisabled"]'))).toBe(true);
    await page.getByTestId("tt-up").click();
    await expect(page.getByTestId("tt-status")).toContainText("Moved up.");
    await expect(page.getByTestId("edit-announce")).toContainText("Moved up.");
  });

  test("F8: Escape closes Add, Move to and Remove; Cancel and Keep it return focus to their control", async ({ page }) => {
    await tree(page, "#new-search").click();
    await page.getByTestId("tt-add").click();
    await expect(page.getByTestId("tt-add-panel")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("tt-add-panel")).toHaveCount(0);
    await expect(page.getByTestId("tt-add")).toBeFocused();
    await page.getByTestId("tt-move").click();
    await expect(page.getByTestId("tt-move-target")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("tt-move")).toBeFocused();
    await page.getByTestId("tt-remove").click();
    await expect(page.getByRole("button", { name: "Keep it" })).toBeFocused();
    await page.getByRole("button", { name: "Keep it" }).click();
    await expect(page.getByTestId("tt-remove-panel")).toHaveCount(0);
    await expect(page.getByTestId("tt-remove")).toBeFocused();
    // An undo that empties the history hands focus to Redo.
    await page.getByTestId("tt-up").click();
    await page.getByTestId("tt-undo").click();
    await expect(page.getByTestId("tt-redo")).toBeFocused();
  });

  test("F16 and status: the removal confirmation fits its tools, and an unchecked preview never reads as passing", async ({ page }) => {
    await tree(page, "#new-search").click();
    await page.getByTestId("content-label-text-0").fill("Search again");
    await page.getByTestId("content-label-apply").click();
    await expect(page.getByTestId("check-pill")).toHaveAttribute("data-state", "preview");
    await expect(page.getByTestId("check-pill")).toContainText("Preview · not checked");
    await expect(page.getByTestId("check-pill")).not.toContainText("Passes");
    await page.getByTestId("tt-remove").click();
    const [panel, tools] = await Promise.all([page.getByTestId("tt-remove-panel").boundingBox(), page.getByTestId("template-tools").boundingBox()]);
    expect(panel!.x + panel!.width).toBeLessThanOrEqual(tools!.x + tools!.width + 0.5);
    await expect(page.getByTestId("tt-remove-panel")).toContainText("Remove Button “Search again” from this state?");
  });
});
