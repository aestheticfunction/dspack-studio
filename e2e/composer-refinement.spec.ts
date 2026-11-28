/**
 * Professional authoring refinement (experimental Library): the Structure panel's room and labels, collapse and
 * expand, semantic icons, the grouped toolbar and its shortcuts, Undo and Redo with the canvas, the contextual
 * component picker, Structure, canvas and inspector in step, status and version management, and the opt-in pair
 * of panels from 1280 px. Agent-free.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const NS = "composer.experimental.workspace.";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const DISMISSED = JSON.stringify({ schema: "composer.experimental.workspace/onboarding", version: 1, data: { dismissed: true } });
const CUSTOM = { scheme: "dark", surfaceHue: "sky", tint: "whisper", depth: "dim", warmth: "neutral", contrast: "standard", accentHue: "teal", chroma: "clear", presence: "balance", weight: "medium", elevation: "soft" };
const WORKSPACE = { density: "comfortable", textScale: "standard", labelCase: "sentence", display: "brand", surround: "workspace" };

async function openLibrary(page: Page, appearance?: { base: string; custom?: Record<string, string>; workspace?: Record<string, string> }) {
  await page.route("**/api/**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) }));
  await page.addInitScript(
    ([v, a]) => {
      if (!localStorage.getItem("composer.experimental.workspace.onboarding")) localStorage.setItem("composer.experimental.workspace.onboarding", v as string);
      if (a) localStorage.setItem("composer.experimental.workspace.appearance", a as string);
    },
    [DISMISSED, appearance ? JSON.stringify({ schema: "composer.experimental.workspace/appearance", version: 1, data: { base: appearance.base, custom: { ...CUSTOM, ...appearance.custom }, workspace: { ...WORKSPACE, ...appearance.workspace } } }) : null] as const,
  );
  await page.goto("/");
  await page.getByTestId("nav-library").click();
  await ready(page);
}
const ready = (page: Page) => expect(page.getByTestId("check-pill")).not.toHaveAttribute("data-state", "loading", { timeout: 30_000 });
const canvas = (page: Page) => page.locator('[data-project-canvas="composer"]:not(.cl-frame--kept)');
const tree = (page: Page, key: string) => page.getByTestId(`structure-${key}`);
const lib = (page: Page) => page.getByTestId("composition-library");
async function draft(page: Page) {
  await page.getByRole("radio", { name: /v2 Draft/i }).check();
  await ready(page);
}
async function structure(page: Page) {
  if ((await lib(page).getAttribute("data-library")) !== "open") await page.getByTestId("toggle-library").click();
  await page.getByTestId("view-structure").click();
  await expect(page.getByTestId("structure-tree")).toBeVisible();
}
const axe = async (page: Page) => (await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);

test.describe("Structure panel", () => {
  test("room for the tree: at 1280 × 800 the first row starts within 210 px of the panel top, all nine rows fit, one line each", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLibrary(page);
    await draft(page);
    await structure(page);
    await tree(page, "#choose").click();
    const m = await page.evaluate(() => {
      const panel = document.querySelector("#cl-library")!.getBoundingClientRect();
      const rows = [...document.querySelectorAll('[data-testid="structure-tree"] [role="treeitem"]')].map((r) => r.getBoundingClientRect());
      return { first: rows[0]!.top - panel.top, count: rows.length, lastBottom: rows.at(-1)!.bottom, panelBottom: panel.bottom, tallest: Math.max(...rows.map((r) => r.height)) };
    });
    expect(m.first).toBeLessThanOrEqual(210);
    expect(m.count).toBe(9);
    expect(m.lastBottom).toBeLessThanOrEqual(m.panelBottom);
    expect(m.tallest).toBeLessThanOrEqual(30);
  });

  test("content-first rows with a type icon; the full name stays in the tooltip and the accessible name; the count once on the repeat", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLibrary(page);
    await draft(page);
    await structure(page);
    const choose = tree(page, "#choose");
    await expect(choose).toHaveText(/^Choose ‹hotel name›/);
    await expect(choose).toHaveAttribute("aria-label", "Button, Choose ‹hotel name›, shows data, sends an action");
    await expect(choose).toHaveAttribute("title", "Button, Choose ‹hotel name›, shows data, sends an action");
    await expect(choose.locator(".cl-tree__type")).toHaveAttribute("data-icon", "button");
    await expect(tree(page, "ready@2.0").locator(".cl-tree__type")).toHaveAttribute("data-icon", "repeat");
    await expect(tree(page, "ready@2.0")).toContainText("×3");
    await expect(page.getByTestId("structure-tree")).toContainText("×3", { useInnerText: true });
    expect(await page.getByTestId("structure-tree").locator(".cl-tree__count").count()).toBe(1);
    // An element that shows no text reads as its component.
    await expect(tree(page, "ready@2.0.0.0")).toHaveText(/^Details list/);
    // No legacy text badges.
    await expect(page.getByTestId("structure-tree").locator(".cl-tree__badge")).toHaveCount(0);
  });

  test("collapse and expand: chevrons, arrow keys, aria-expanded in step, and a selection made elsewhere is never hidden", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLibrary(page);
    await draft(page);
    await structure(page);
    const list = tree(page, "#results");
    await expect(list).toHaveAttribute("aria-expanded", "true");
    await page.getByTestId("structure-toggle-#results").click();
    await expect(list).toHaveAttribute("aria-expanded", "false");
    await expect(tree(page, "#choose")).toHaveCount(0);
    // ArrowRight opens a closed row first, then moves in; ArrowLeft closes an open row first, then moves out.
    await list.focus();
    await page.keyboard.press("ArrowRight");
    await expect(list).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("ArrowRight");
    await expect(tree(page, "ready@2.0")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(tree(page, "ready@2.0")).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("ArrowLeft");
    await expect(list).toBeFocused();
    // Picking a hidden element on the canvas opens its rows.
    await page.getByTestId("select-mode").click();
    await canvas(page).getByRole("button", { name: "Choose Casa do Rio" }).click({ force: true });
    await expect(tree(page, "#choose")).toHaveAttribute("aria-selected", "true");
    await expect(tree(page, "ready@2.0")).toHaveAttribute("aria-expanded", "true");
  });

  test("selecting in Structure brings the element into view on the canvas", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLibrary(page);
    await draft(page);
    await structure(page);
    await tree(page, "#new-search").click();
    await expect(page.locator('.cl-canvas [data-testid="selection-outline"]').first()).toBeInViewport();
    expect(await page.evaluate(() => document.querySelector(".cl-canvas")!.scrollTop)).toBeGreaterThan(0);
  });
});

test.describe("toolbar, history and shortcuts", () => {
  test("one grouped toolbar row with names, tooltips and reasons; Undo and Redo with the canvas undo an inspector edit with no panel change", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLibrary(page);
    await draft(page);
    await structure(page);
    await tree(page, "ready@0").click();
    const ids = ["tt-add", "tt-up", "tt-down", "tt-move", "tt-remove"];
    const tops = await Promise.all(ids.map(async (id) => Math.round((await page.getByTestId(id).boundingBox())!.y)));
    expect(new Set(tops).size).toBe(1);
    await expect(page.getByTestId("tt-add")).toHaveText("Add");
    await expect(page.getByTestId("tt-up")).toHaveAttribute("aria-label", "Move up");
    await expect(page.getByTestId("tt-up")).toHaveAttribute("title", "Move up: Already first in Card");
    await expect(page.getByTestId("tt-up")).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByTestId("tt-down")).toHaveAttribute("title", "Move down (Alt+↓)");
    await expect(page.getByTestId("tt-remove")).toHaveAttribute("aria-keyshortcuts", "Delete");
    // History lives with the canvas: an inspector edit is undone with the inspector still open.
    await page.getByTestId("toggle-inspector").click();
    await tree(page, "#new-search").click();
    await page.getByTestId("content-label-text-0").fill("Search again");
    await page.getByTestId("content-label-apply").click();
    const before = await lib(page).getAttribute("data-library");
    await expect(page.locator(".cl-toolbar__view").getByTestId("tt-undo")).toBeVisible();
    await page.getByTestId("tt-undo").click();
    await expect(canvas(page).getByRole("button", { name: "Change search" })).toBeVisible();
    expect(await lib(page).getAttribute("data-library")).toBe(before);
    await expect(page.getByTestId("tt-status")).toContainText("Undone: label change.");
    await expect(page.getByTestId("tt-redo")).toHaveAttribute("title", /Redo .*Ctrl\+Y/);
  });

  test("shortcuts: Alt+arrows move, Delete asks first, Ctrl+Y redoes, and text fields keep their own undo", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLibrary(page);
    await draft(page);
    await structure(page);
    if ((await lib(page).getAttribute("data-inspector")) !== "open") await page.getByTestId("toggle-inspector").click();
    await tree(page, "#new-search").click();
    await tree(page, "#new-search").press("Alt+ArrowUp");
    await expect(page.getByTestId("tt-status")).toContainText("Moved up.");
    await expect(tree(page, "#new-search")).toBeFocused();
    await tree(page, "#new-search").press("Delete");
    await expect(page.getByTestId("tt-remove-panel")).toBeVisible();
    await expect(page.getByRole("button", { name: "Keep it" })).toBeFocused();
    await expect(tree(page, "#new-search")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("tt-remove")).toBeFocused();
    await page.keyboard.press("Control+z");
    await expect(page.getByTestId("tt-status")).toContainText("Undone: moved up.");
    await page.keyboard.press("Control+y");
    await expect(page.getByTestId("tt-status")).toContainText("Redone: moved up.");
    // Typing in a field: Ctrl+Z belongs to the field, not to the draft.
    await page.getByTestId("content-label-text-0").fill("Typed");
    await page.getByTestId("content-label-text-0").press("Control+z");
    await expect(page.getByTestId("tt-status")).toContainText("Redone: moved up.");
    // A checkbox is not text: Ctrl+Z there undoes the draft's last step.
    await page.getByTestId("content-isDisabled").check();
    await page.getByTestId("content-isDisabled").press("Control+z");
    await expect(page.getByTestId("tt-status")).toContainText("Undone: is disabled change.");
  });

  test("on a phone the toolbar keeps 44 px targets in the Structure sheet, with Undo and Redo there", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openLibrary(page);
    await draft(page);
    await page.getByTestId("toggle-library").click();
    await page.getByTestId("view-structure").click();
    await tree(page, "#new-search").click();
    for (const id of ["tt-add", "tt-up", "tt-down", "tt-move", "tt-remove", "tt-undo", "tt-redo"]) {
      const box = (await page.getByTestId(id).boundingBox())!;
      expect(box.height, id).toBeGreaterThanOrEqual(44);
      expect(box.width, id).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});

test.describe("component picker", () => {
  test("anchored beside the panel, names its target, says what cannot go where before anything is chosen, and keeps the row in view", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLibrary(page);
    await draft(page);
    await structure(page);
    await tree(page, "ready@2.0.0").click();
    const before = (await tree(page, "ready@2.0.0").boundingBox())!;
    await page.getByTestId("tt-add").click();
    const picker = page.getByTestId("tt-add-panel");
    await expect(picker).toHaveAttribute("role", "dialog");
    await expect(picker).toContainText("Add to");
    await expect(picker).toContainText("Selectable card “‹hotel name›”");
    // The selected row has not moved, and the picker sits beside the panel, not over it.
    const after = (await tree(page, "ready@2.0.0").boundingBox())!;
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
    await expect(tree(page, "ready@2.0.0")).toBeInViewport();
    const panel = (await page.locator("#cl-library").boundingBox())!;
    expect((await picker.boundingBox())!.x).toBeGreaterThanOrEqual(panel.x + panel.width - 1);
    // The repeat rule is known before confirming: Before and After are unavailable, with the reason.
    await expect(page.getByTestId("tt-pos-before")).toBeDisabled();
    await expect(page.getByTestId("tt-pos-after")).toBeDisabled();
    await expect(page.getByTestId("tt-pos-inside")).toBeChecked();
    await expect(picker).toContainText("Before and After unavailable: Each item of a repeat must be one element");
    await expect(picker).toContainText("Can be added here");
    await expect(picker).toContainText("Cannot go here");
    await expect(page.getByTestId("tt-component-text-input")).toBeDisabled();
    // J3: only the supported vocabulary is offered (dialogs arrived with state authoring, where they are safe).
    for (const later of ["Table", "Dropdown menu", "Details list"]) await expect(picker).not.toContainText(later);
    await expect(page.getByTestId("tt-component-alert-dialog")).toBeDisabled();
    // Escape closes and returns focus to Add.
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await expect(page.getByTestId("tt-add")).toBeFocused();
  });

  test("Enter adds; a new button is selected and its action is in the inspector", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLibrary(page);
    await draft(page);
    await structure(page);
    await page.getByTestId("toggle-inspector").click();
    await tree(page, "ready@2.0.0").click();
    await page.getByTestId("tt-add").click();
    await page.getByTestId("tt-component-button").check();
    await page.getByTestId("tt-label").fill("Show on map");
    await page.getByTestId("tt-label").press("Enter");
    await expect(tree(page, "#show-on-map")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('[data-group="When pressed"]')).toBeInViewport();
  });

  test("Move to lists impossible containers with the reason and marks where it is now", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLibrary(page);
    await draft(page);
    await structure(page);
    await tree(page, "#new-search").click();
    await page.getByTestId("tt-move").click();
    const options = page.getByTestId("tt-move-target").locator("option");
    await expect(options.filter({ hasText: "it is here now" })).toHaveCount(1);
    await expect(page.getByTestId("tt-move-target").locator('option[value="ready@2.0"]')).toBeDisabled();
  });

  test("on a phone the picker is part of the Structure sheet, with 44 px options", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openLibrary(page);
    await draft(page);
    await page.getByTestId("toggle-library").click();
    await page.getByTestId("view-structure").click();
    await tree(page, "ready@0").click();
    await page.getByTestId("tt-add").click();
    const picker = page.getByTestId("tt-add-panel");
    expect(await picker.evaluate((el) => getComputedStyle(el).position)).toBe("static");
    expect(await picker.evaluate((el) => !!el.closest("#cl-library"))).toBe(true);
    const heights = await picker.locator(".cl-picker__opt").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
    expect(await axe(page)).toEqual([]);
  });
});

test.describe("status, versions and panels", () => {
  test("the draft's next step works with the inspector closed: run checks, then approve in place, with no panel change", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLibrary(page);
    await draft(page);
    await structure(page);
    await tree(page, "#new-search").click();
    await page.getByTestId("tt-up").click();
    await expect(page.getByTestId("check-pill")).toHaveAttribute("data-state", "preview");
    await page.getByTestId("draft-run-checks").click();
    await expect(page.getByTestId("draft-approve")).toBeVisible();
    await expect(lib(page)).toHaveAttribute("data-inspector", "closed");
    await page.getByTestId("draft-approve").click();
    await expect(page.getByTestId("approve-confirm")).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.getByTestId("approve-confirm-button").click();
    await expect(page.getByRole("radio", { name: /v2 Approved/i })).toBeChecked();
    await expect(lib(page)).toHaveAttribute("data-inspector", "closed");
  });

  test("J4: withdrawal through the version menu while an element is selected, with its confirmation and safe default", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLibrary(page);
    await page.getByRole("radio", { name: /v1 Approved/i }).check();
    await structure(page);
    await tree(page, "#new-search").click();
    await page.getByTestId("toggle-inspector").click().catch(() => {});
    await expect(page.getByTestId("element-inspector")).toBeVisible();
    await page.getByTestId("version-menu").locator("summary").click();
    await page.getByTestId("version-withdraw").click();
    await expect(page.getByTestId("withdraw-confirm")).toBeVisible();
    await expect(page.getByRole("button", { name: "Keep it approved" })).toBeFocused();
    await expect(page.getByTestId("element-inspector")).toBeVisible();
    await page.getByTestId("withdraw-confirm-button").click();
    await expect(page.getByRole("radio", { name: /v1 Withdrawn/i })).toBeChecked();
    // Withdraw is never part of the Structure toolbar.
    await expect(page.getByTestId("template-tools")).toHaveCount(0);
  });

  test("names and notes where they are seen: the panel toggle says Structure, Select explains itself above the composition, one Technical details", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLibrary(page);
    await draft(page);
    await structure(page);
    await expect(page.getByTestId("toggle-library")).toHaveAttribute("title", "Structure");
    await page.getByTestId("select-mode").click();
    const note = (await page.getByTestId("select-note").boundingBox())!;
    const frame = (await canvas(page).boundingBox())!;
    expect(note.y).toBeLessThan(frame.y);
    await page.keyboard.press("Escape");
    await tree(page, "#new-search").click();
    if ((await lib(page).getAttribute("data-inspector")) !== "open") await page.getByTestId("toggle-inspector").click();
    await expect(page.getByTestId("inspector").getByText("Technical details", { exact: true })).toHaveCount(1);
  });

  test("J2: from 1280 px both panels can be chosen, in compact widths; one panel stays the default; not below 1280", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLibrary(page);
    await draft(page);
    await structure(page);
    // The default: opening the inspector closes Structure.
    await page.getByTestId("toggle-inspector").click();
    await expect(lib(page)).toHaveAttribute("data-library", "closed");
    await page.getByTestId("panels-both").click();
    await expect(lib(page)).toHaveAttribute("data-library", "open");
    await expect(lib(page)).toHaveAttribute("data-inspector", "open");
    await expect(lib(page)).toHaveAttribute("data-pair", "on");
    const m = await page.evaluate(() => ({
      left: document.querySelector("#cl-library")!.getBoundingClientRect().width,
      right: document.querySelector("#cl-inspector")!.getBoundingClientRect().width,
      share: document.querySelector(".cl-canvas")!.getBoundingClientRect().width / innerWidth,
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
    expect(m.left).toBe(248);
    // The Structure toolbar keeps one row in the compact pair, and nothing in it is clipped.
    const tools = await page.locator(".cl-tt__row .cl-tt__tool").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
    expect(new Set(tools.map((r) => Math.round(r.top))).size).toBe(1);
    const panelRight = (await page.locator("#cl-library").boundingBox())!;
    for (const r of tools) expect(r.right).toBeLessThanOrEqual(panelRight.x + panelRight.width);
    expect(m.right).toBe(312);
    expect(m.share).toBeGreaterThanOrEqual(0.55);
    expect(m.overflow).toBe(false);
    // Structure and the inspector stay in step without any panel change.
    await tree(page, "#new-search").click();
    await expect(page.getByTestId("element-inspector")).toHaveAttribute("data-key", "#new-search");
    expect(await axe(page)).toEqual([]);
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(page.getByTestId("panels-both")).toHaveCount(0);
    await expect(lib(page)).not.toHaveAttribute("data-pair", "on");
  });
});

test.describe("appearances, widths and accessibility", () => {
  for (const [name, appearance] of [
    ["Neutral light", { base: "neutral-light" }],
    ["Neutral dark", { base: "neutral-dark" }],
    ["Aesthetic Function", undefined],
    ["Custom, light", { base: "custom", custom: { scheme: "light", surfaceHue: "amber" } }],
    ["Neutral light, large text and compact", { base: "neutral-light", workspace: { textScale: "large", density: "compact" } }],
  ] as const)
    test(`${name}: Structure, toolbar and picker pass axe, rows stay one line, the canvas keeps its own look`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await openLibrary(page, appearance as never);
      await draft(page);
      await structure(page);
      await tree(page, "ready@2.0.0").click();
      await page.getByTestId("tt-add").click();
      expect(await axe(page)).toEqual([]);
      const rows = await page.locator('[data-testid="structure-tree"] [role="treeitem"]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      // One line per row: a row is never taller than one line of its text plus padding.
      for (const h of rows) expect(h).toBeLessThanOrEqual(40);
      // The canvas keeps the design system's own look, whatever the workspace appearance.
      expect(await canvas(page).evaluate((el) => getComputedStyle(el).colorScheme)).toContain("light");
    });

  for (const [w, h] of [
    [1440, 900],
    [1280, 800],
    [1024, 768],
  ] as const)
    test(`${w} px: the Structure toolbar is one row and nothing overflows`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await openLibrary(page);
      await draft(page);
      await structure(page);
      await tree(page, "#new-search").click();
      const ys = await page.locator(".cl-tt__row > *").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
      expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(8);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);
      void NS;
    });
});
