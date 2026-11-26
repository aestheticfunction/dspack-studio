/**
 * The Composition Library (M1, Slice C) in the experimental artifact: the first application integration of
 * the canvas-first workspace. Agent-free: nothing here calls a model, and the Library makes no request.
 *
 * Covers: real governed instances on Composer's canvas, version coexistence (approved v1 and the newer
 * draft), scenario and state selection, the governed refusal and needs-recheck states, actions shown and
 * never run, sensitive values in their recordable form only, the experimental storage namespace (isolation,
 * persistence, recovery), keyboard use and focus, the layout at 1280 and 390 px, and axe at both widths.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const NS = "composer.experimental.workspace.";
const SECRET = "SYN-LOYAL-7781";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function openLibrary(page: Page) {
  await page.route("**/api/**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) }));
  await page.goto("/");
  await page.getByTestId("nav-library").click();
  await expect(page.getByTestId("instance-status")).toBeVisible({ timeout: 30_000 });
}

const canvas = (page: Page) => page.locator('[data-project-canvas="composer"]:not(.cl-frame--kept)');
const storage = (page: Page) => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));

test.describe("the Composition Library", () => {
  test("opens from the primary nav and shows a governed instance on Composer's own canvas", async ({ page }) => {
    await openLibrary(page);
    await expect(page.getByTestId("library-item-hotel-results")).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("library-item-hotel-search")).toBeVisible();
    await expect(page.getByTestId("instance-status")).toContainText("Checks pass");
    await expect(canvas(page).locator("[data-a2ui-surface]")).toHaveCount(1);
    await expect(canvas(page).locator('[data-a2ui-component="SelectableCard"]')).toHaveCount(3);
    await expect(canvas(page)).toContainText("Hotels in Lisbon");
    // Future destinations are named, and none is a control.
    const bar = page.getByRole("navigation", { name: "Workspace" });
    // The Library's scope is named: the Astryx sample, whatever project is open.
    await expect(bar).toContainText("Astryx sample");
    await expect(bar).toContainText("Compose · Playground · Publish");
    await expect(bar).toContainText("not yet available");
    await expect(bar.locator("button, a")).toHaveCount(0);
  });

  test("an approved version and its newer draft coexist; the approved one is unchanged", async ({ page }) => {
    await openLibrary(page);
    await page.getByRole("radio", { name: /v2 Draft/i }).check();
    await expect(page.getByTestId("draft-note")).toContainText("approved v1");
    await expect(canvas(page)).toContainText("Prices are per night, before taxes.");
    await expect(canvas(page)).toContainText("Change search");
    await page.getByRole("radio", { name: /v1 Approved/i }).check();
    await expect(canvas(page)).toContainText("Compare and choose one.");
    await expect(canvas(page)).toContainText("New search");
    await expect(page.getByTestId("draft-note")).toHaveCount(0);
  });

  test("scenario and state selection; the rules' refusal is shown with the rule, and the last valid instance is kept", async ({ page }) => {
    await openLibrary(page);
    await page.getByTestId("scenario-select").selectOption("one");
    const refusal = page.getByTestId("refusal");
    await expect(refusal).toHaveAttribute("data-stage", "lint");
    await expect(refusal).toContainText("rule.review-offers-alternatives");
    await expect(refusal).toContainText("A choice of one is not a comparison");
    // The retained instance sits behind a closed disclosure, named as not interactive, and is inert.
    const kept = page.getByTestId("kept-instance");
    await expect(kept).not.toHaveAttribute("open", "");
    await expect(kept.locator("summary")).toHaveText("Last valid instance · not interactive");
    await expect(page.locator(".cl-frame--kept")).toHaveAttribute("inert", "");
    await page.getByTestId("scenario-select").selectOption("none");
    await expect(page.getByTestId("instance-status")).toContainText("empty");
    // A requested state is shown only when its own guard holds for the data.
    await page.getByTestId("scenario-select").selectOption("three");
    await page.getByTestId("state-select").selectOption("empty");
    await expect(page.getByTestId("refusal")).toHaveAttribute("data-stage", "state");
    await page.getByTestId("state-select").selectOption("");
    await expect(page.getByTestId("instance-status")).toContainText("ready");
  });

  test("a rule change needs a re-check; a failed re-check approves nothing and stores nothing", async ({ page }) => {
    await openLibrary(page);
    const before = await storage(page);
    await page.getByTestId("toggle-inspector").click();
    await expect(page.getByTestId("check-status")).toContainText("Checks pass: 5 of 5");
    await page.getByTestId("what-if").click();
    await expect(page.getByTestId("refusal")).toHaveAttribute("data-stage", "needs-recheck");
    await page.getByTestId("recheck").click();
    await expect(page.getByTestId("recheck-failed")).toContainText("three, two");
    await expect(page.getByTestId("refusal")).toHaveAttribute("data-stage", "needs-recheck");
    const after = await storage(page);
    expect(after[`${NS}approvals`]).toBe(before[`${NS}approvals`]);
    await page.getByTestId("what-if").click();
    await expect(page.getByTestId("instance-status")).toContainText("Checks pass");
  });

  test("actions are shown, never run; a sensitive value appears only in its recordable form and is stored nowhere", async ({ page }) => {
    await openLibrary(page);
    await canvas(page).getByRole("button", { name: "Choose Hotel Miradouro" }).click();
    await expect(page.getByTestId("action-note")).toContainText('{"hotelId":"h-102"}');
    await expect(page.getByTestId("action-note")).toContainText("Preview only, not run.");
    await page.getByTestId("library-item-hotel-search").click();
    await expect(canvas(page)).toContainText("Find a hotel");
    const field = (id: string) => canvas(page).locator(`[data-a2ui-id="${id}"] input`);
    await field("destination").fill("Lisbon");
    await field("member_number").fill(SECRET);
    await canvas(page).getByRole("button", { name: "Search hotels" }).click();
    await expect(page.getByTestId("action-note")).toContainText('"memberNumber":"[sensitive]"');
    await expect(page.getByTestId("action-note")).not.toContainText(SECRET);
    const stored = await storage(page);
    expect(JSON.stringify(stored)).not.toContain(SECRET);
    expect(Object.keys(stored).filter((k) => k.startsWith("composer.") && !k.startsWith(NS) && !["composer.appearance.v1", "composer.providers.v1", "composer.projects.v1", "composer.lastProject.v1", "composer.experimental.v1"].includes(k))).toEqual([]);
  });
});

test.describe("M1 workspace review corrections (R1 to R4)", () => {
  test("R1: passing checks never reads as approval; a draft stays a draft", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await openLibrary(page);
    await page.getByTestId("toggle-inspector").click();
    await page.getByRole("radio", { name: /v2 Draft/i }).check();
    await expect(page.getByTestId("draft-note")).toContainText("not approved for use by agents");
    await expect(page.getByTestId("instance-status")).toContainText("Checks pass · Draft, not approved");
    await expect(page.getByTestId("check-status")).toHaveAttribute("data-check", "pass");
    await expect(page.getByTestId("draft-check-note")).toContainText("passing checks does not approve it");
    await expect(page.getByTestId("device-record")).not.toContainText(/approv/i);
    // Under changed rules, a draft is "last checked", never "approved".
    await page.getByTestId("what-if").click();
    await expect(page.getByTestId("refusal")).toContainText("was last checked");
    // "Approved" appears only as a version's status.
    const words = await page.getByTestId("composition-library").innerText();
    for (const line of words.split("\n").filter((l) => /approv/i.test(l))) {
      expect(line, line).toMatch(/^(v\d+ · Approved|v\d+ Approved|Approved, immutable|v\d+ · Approved, immutable|.*not approved.*|.*does not approve.*|Approving a version is a separate.*|A draft, newer than approved v\d+.*|v\d+ approved, v\d+ draft|Version|.*Draft, not approved)$/i);
    }
  });

  test("R2: the canvas and the inspector report one result, through what-if checks that pass and fail, and the restore", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await openLibrary(page);
    const approvalsBefore = (await storage(page))[`${NS}approvals`];
    await page.getByTestId("toggle-inspector").click();
    const contract = await page.locator(".cl-facts").filter({ hasText: "Contract" }).innerText();
    const status = () => page.getByTestId("check-status");
    await page.getByTestId("what-if").click();
    await expect(page.getByTestId("refusal")).toHaveAttribute("data-stage", "needs-recheck");
    await expect(status()).toHaveAttribute("data-check", "unchecked");
    // A what-if check that fails: both say so.
    await page.getByTestId("recheck").click();
    await expect(status()).toHaveAttribute("data-check", "fail");
    await expect(status()).toContainText("three, two");
    await expect(page.getByTestId("recheck-failed")).toContainText("three, two");
    // A what-if check that passes (hotel search is unaffected): both say so.
    await page.getByTestId("toggle-library").click();
    await page.getByTestId("library-item-hotel-search").click();
    await expect(page.getByTestId("refusal")).toHaveAttribute("data-stage", "needs-recheck");
    await page.getByTestId("recheck").click();
    await expect(page.getByTestId("instance-status")).toContainText("Checks pass");
    await page.getByTestId("toggle-inspector").click();
    await expect(status()).toHaveAttribute("data-check", "pass");
    await expect(status()).toContainText("the what-if rules");
    // Restore: the packaged checks authorize again, for both versions, and the inspector agrees with the canvas.
    await page.getByTestId("what-if").click();
    await expect(page.getByTestId("instance-status")).toContainText("Checks pass");
    await expect(status()).toHaveAttribute("data-check", "pass");
    await expect(status()).toContainText("the packaged rules");
    await page.getByTestId("toggle-library").click();
    await page.getByTestId("library-item-hotel-results").click();
    await expect(page.getByTestId("instance-status")).toContainText("Checks pass");
    await page.getByTestId("toggle-inspector").click();
    await expect(status()).toContainText("Checks pass: 5 of 5");
    // The packaged rules are unchanged and nothing from the what-if was stored.
    expect(await page.locator(".cl-facts").filter({ hasText: "Contract" }).innerText()).toBe(contract);
    expect((await storage(page))[`${NS}approvals`]).toBe(approvalsBefore);
  });

  test("R3: on a phone an open panel is a modal dialog; focus stays inside, the background is unavailable, Escape returns", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openLibrary(page);
    await page.getByTestId("toggle-inspector").click();
    const drawer = page.getByRole("dialog", { name: "Inspector" });
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute("aria-modal", "true");
    await expect(page.locator(".cl-canvas")).toHaveAttribute("inert", "");
    await expect(page.locator("header.af-top")).toHaveAttribute("inert", "");
    const inside = () => page.evaluate(() => !!document.activeElement?.closest("#cl-inspector"));
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      expect(await inside(), `Tab ${i + 1}`).toBe(true);
    }
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(await inside(), `Shift+Tab ${i + 1}`).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("toggle-inspector")).toBeFocused();
    await expect(page.locator(".cl-canvas")).not.toHaveAttribute("inert", "");
    await expect(page.locator("header.af-top")).not.toHaveAttribute("inert", "");
    // The same for the Compositions drawer.
    await page.getByTestId("toggle-library").click();
    await expect(page.getByRole("dialog", { name: "Compositions" })).toBeVisible();
    await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("#cl-library"))).toBe(true);
  });

  test("R3: wider screens keep side panels non-modal", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await openLibrary(page);
    await page.getByTestId("toggle-inspector").click();
    await expect(page.locator("#cl-inspector")).not.toHaveAttribute("role", "dialog");
    await expect(page.locator(".cl-canvas")).not.toHaveAttribute("inert", "");
    await expect(page.locator("header.af-top")).not.toHaveAttribute("inert", "");
  });

  test("R4: action feedback appears inside the visible working area, wherever the button was", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLibrary(page);
    const inView = () => page.getByTestId("action-note").evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
    await canvas(page).getByRole("button", { name: "Choose Casa do Rio" }).click();
    await expect(page.getByTestId("action-note")).toContainText("Preview only, not run.");
    expect(await inView()).toBe(true);
    const last = canvas(page).getByRole("button", { name: "Choose Lumen Chiado" });
    await last.scrollIntoViewIfNeeded();
    await last.click();
    await expect(page.getByTestId("action-note")).toContainText('"hotelId":"h-103"');
    expect(await inView()).toBe(true);
    await page.getByRole("button", { name: "Dismiss the action preview" }).click();
    await expect(page.getByTestId("action-note")).toHaveCount(0);
  });
});

test.describe("experimental storage", () => {
  test("only the workspace namespace is written, production data is untouched, and the selection survives a reload", async ({ page }) => {
    const projects = JSON.stringify([]);
    await page.addInitScript((p) => {
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem("composer.projects.v1", p);
        sessionStorage.setItem("seeded", "1");
      }
    }, projects);
    await openLibrary(page);
    const before = await storage(page);
    await page.getByTestId("library-item-hotel-search").click();
    await expect(canvas(page)).toContainText("Find a hotel");
    const after = await storage(page);
    const changed = Object.keys(after).filter((k) => after[k] !== before[k]);
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.every((k) => k.startsWith(NS))).toBe(true);
    expect(after["composer.projects.v1"]).toBe(projects);
    const prefs = JSON.parse(after[`${NS}library`]!);
    expect(prefs).toMatchObject({ schema: "composer.experimental.workspace/library", version: 1, data: { composition: "hotel-search", version: 1 } });
    await page.reload();
    await page.getByTestId("nav-library").click();
    await expect(page.getByTestId("library-item-hotel-search")).toHaveAttribute("aria-current", "true");
  });

  test("a malformed record gives the defaults, says so, and is kept aside before it is overwritten", async ({ page }) => {
    await page.addInitScript((key) => {
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem(key, "{not a record");
        sessionStorage.setItem("seeded", "1");
      }
    }, `${NS}library`);
    await openLibrary(page);
    await page.getByTestId("toggle-inspector").click();
    await expect(page.getByTestId("storage-note")).toContainText("could not be read");
    await page.getByTestId("toggle-library").click();
    await page.getByTestId("library-item-hotel-search").click();
    await expect(canvas(page)).toContainText("Find a hotel");
    const stored = await storage(page);
    expect(stored[`${NS}library.preserved`]).toBe("{not a record");
    expect(JSON.parse(stored[`${NS}library`]!).data.composition).toBe("hotel-search");
  });
});

test.describe("keyboard, focus and layout", () => {
  test("keyboard only: reach the list, choose a composition, change version; focus is visible", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await openLibrary(page);
    await page.getByTestId("toggle-library").focus();
    const seen: string[] = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      seen.push(await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.id ?? document.activeElement?.tagName ?? ""));
      if (seen.at(-1) === "library-item-hotel-search") break;
    }
    expect(seen).toContain("library-item-hotel-search");
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
    expect(outline).not.toBe("none");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("library-item-hotel-search")).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("library-item-hotel-search")).toBeFocused();
    await expect(canvas(page)).toContainText("Find a hotel");
    // Version radios move with the arrow keys.
    await page.getByTestId("library-item-hotel-results").click();
    await page.getByRole("radio", { name: /v1 Approved/i }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: /v2 Draft/i })).toBeChecked();
    await expect(canvas(page)).toContainText("Prices are per night");
  });

  test("1280 px: one side panel at a time, and the canvas keeps at least 60% of the width", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await openLibrary(page);
    const share = () => page.evaluate(() => document.querySelector(".cl-canvas")!.getBoundingClientRect().width / window.innerWidth);
    await expect(page.getByTestId("composition-library")).toHaveAttribute("data-library", "open");
    expect(await share()).toBeGreaterThanOrEqual(0.6);
    await page.getByTestId("toggle-inspector").click();
    await expect(page.getByTestId("composition-library")).toHaveAttribute("data-inspector", "open");
    await expect(page.getByTestId("composition-library")).toHaveAttribute("data-library", "closed");
    expect(await share()).toBeGreaterThanOrEqual(0.6);
    await expect(page.getByTestId("toggle-inspector")).toHaveAttribute("aria-expanded", "true");
  });

  test("390 px: canvas first; panels are drawers with focus moved in, Escape returns it, a choice lands on the canvas", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openLibrary(page);
    await expect(page.getByTestId("composition-library")).toHaveAttribute("data-library", "closed");
    await expect(page.getByTestId("composition-library")).toHaveAttribute("data-inspector", "closed");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const width = await page.evaluate(() => document.querySelector(".cl-canvas")!.getBoundingClientRect().width);
    expect(width).toBeGreaterThanOrEqual(380);
    await page.getByTestId("toggle-library").click();
    await expect(page.locator("#cl-library")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("composition-library")).toHaveAttribute("data-library", "closed");
    await expect(page.getByTestId("toggle-library")).toBeFocused();
    await page.getByTestId("toggle-library").click();
    await page.getByTestId("library-item-hotel-search").click();
    await expect(page.getByTestId("composition-library")).toHaveAttribute("data-library", "closed");
    await expect(page.locator("#cl-canvas-title")).toBeFocused();
    await expect(canvas(page)).toContainText("Find a hotel");
  });

  for (const [w, h] of [
    [1280, 860],
    [390, 844],
  ] as const) {
    test(`axe finds no WCAG 2.2 A or AA violation at ${w} px`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await openLibrary(page);
      if (w === 1280) await page.getByTestId("toggle-inspector").click();
      const results = await new AxeBuilder({ page }).include('[data-testid="composition-library"]').withTags(TAGS).analyze();
      // No exception: the Astryx list-item violation that used to be excepted here is fixed in the List adapter
      // (#128, docs/repositioning/list-semantics/).
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.length} (${v.help})`)).toEqual([]);
    });
  }
});
