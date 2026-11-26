/**
 * The Composition Library in the experimental artifact: the canvas-first workspace, refined designer-first
 * (D0, docs/repositioning/DESIGNER-FIRST-PROPOSAL.md). Agent-free: nothing here calls a model, and the Library
 * makes no request.
 *
 * Covers: real governed instances on Composer's canvas; version coexistence (approved v1 and the newer draft);
 * examples and states; refusals, expected and unexpected; a needs-a-new-check state from a rule try-out; actions
 * previewed and never run, with sensitive values in their recordable form only; the experimental storage
 * namespace (isolation, persistence, recovery); the review corrections R1 to R4; and D0: the first-run guide,
 * plain language with technical details closed, the Design and Checks tabs, the layout targets, the fixed
 * frame, the phone sheet, keyboard use, and axe at both widths.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const NS = "composer.experimental.workspace.";
const SECRET = "SYN-LOYAL-7781";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const DISMISSED = JSON.stringify({ schema: "composer.experimental.workspace/onboarding", version: 1, data: { dismissed: true } });

async function openLibrary(page: Page, options: { guide?: boolean } = {}) {
  await page.route("**/api/**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) }));
  // Seeded once per tab, so a test can clear it and reload to see a first run.
  if (options.guide === false)
    await page.addInitScript((v) => {
      if (!sessionStorage.getItem("onboarding-seeded")) {
        localStorage.setItem("composer.experimental.workspace.onboarding", v);
        sessionStorage.setItem("onboarding-seeded", "1");
      }
    }, DISMISSED);
  await page.goto("/");
  await page.getByTestId("nav-library").click();
  await expect(page.getByTestId("check-pill")).not.toHaveAttribute("data-state", "loading", { timeout: 30_000 });
}

const canvas = (page: Page) => page.locator('[data-project-canvas="composer"]:not(.cl-frame--kept)');
const pill = (page: Page) => page.getByTestId("check-pill");
const storage = (page: Page) => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
const example = (page: Page, id: string) => page.getByTestId(`scenario-${id}`).click();
async function openChecks(page: Page) {
  if ((await page.getByTestId("composition-library").getAttribute("data-inspector")) !== "open") await page.getByTestId("toggle-inspector").click();
  await page.getByTestId("tab-checks").click();
}
const compositionTop = (page: Page) => page.evaluate(() => Math.round(document.querySelector('[data-project-canvas="composer"]:not(.cl-frame--kept) [data-a2ui-surface]')!.getBoundingClientRect().top));

test.describe("the Composition Library", () => {
  test("opens from the primary nav and shows a governed instance on Composer's own canvas", async ({ page }) => {
    await openLibrary(page);
    await expect(page.getByTestId("library-item-hotel-results")).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("library-item-hotel-search")).toBeVisible();
    await expect(pill(page)).toHaveAttribute("data-state", "pass");
    await expect(pill(page)).toContainText("Passes the design rules");
    await expect(canvas(page).locator("[data-a2ui-surface]")).toHaveCount(1);
    await expect(canvas(page).locator('[data-a2ui-component="SelectableCard"]')).toHaveCount(3);
    await expect(canvas(page)).toContainText("Hotels in Lisbon");
    // The Library's scope and what comes next sit in the one app header row, and nothing there is a control
    // for an unavailable capability.
    const scope = page.locator("header.af-top").getByTestId("library-scope");
    await expect(scope).toContainText("Astryx sample");
    await expect(scope.locator(".cl-head__pop")).toContainText("Compose, Playground and Publish are not available yet");
    await expect(scope.locator("button, a")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Workspace" })).toHaveCount(0);
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

  test("examples are named for people; an expected refusal is calm and plain, the last valid instance is kept closed", async ({ page }) => {
    await openLibrary(page);
    await expect(page.getByTestId("scenario-chips").getByRole("button")).toHaveText(["Three hotels", "Two hotels", "One hotel · should be refused", "No hotels found", "Confirm a reservation"]);
    await expect(page.getByTestId("scenario-three")).toHaveAttribute("aria-pressed", "true");
    await example(page, "one");
    const refusal = page.getByTestId("refusal");
    await expect(refusal).toHaveAttribute("data-stage", "lint");
    await expect(refusal).toHaveAttribute("data-expected", "true");
    await expect(pill(page)).toHaveAttribute("data-state", "expected");
    await expect(refusal.locator(".cl-refusal__title")).toHaveText("Not shown, as expected");
    await expect(refusal).toContainText("A choice of one is not a comparison");
    await expect(refusal).toContainText("Choose another example to see the composition.");
    // The rule id and the raw message are in Technical details, closed.
    const tech = refusal.locator("details.cl-tech");
    await expect(tech).not.toHaveAttribute("open", "");
    await expect(tech).toContainText("rule.review-offers-alternatives");
    const kept = page.getByTestId("kept-instance");
    await expect(kept).not.toHaveAttribute("open", "");
    await expect(kept.locator("summary")).toHaveText("Last valid instance · not interactive");
    await expect(page.locator(".cl-frame--kept")).toHaveAttribute("inert", "");
    await example(page, "none");
    await expect(pill(page)).toHaveAttribute("data-state", "pass");
  });

  test("a state the example cannot reach is marked, and choosing it explains why and offers the way back", async ({ page }) => {
    await openLibrary(page);
    await openChecks(page);
    const select = page.getByTestId("state-select");
    await expect(select.locator('option[value="empty"]')).toHaveText("Empty (not available with this example)");
    await expect(select.locator('option[value="ready"]')).toHaveText("Ready");
    await select.selectOption("empty");
    const refusal = page.getByTestId("refusal");
    await expect(refusal).toHaveAttribute("data-stage", "state");
    await expect(refusal).toHaveAttribute("data-expected", "false");
    await expect(pill(page)).toHaveAttribute("data-state", "refused");
    await expect(refusal).toContainText("The “Empty” state needs no hotels, and the “Three hotels” example does not fit it.");
    await refusal.getByRole("button", { name: "Show the state the example chooses" }).click();
    await expect(pill(page)).toHaveAttribute("data-state", "pass");
  });

  test("a rule change needs a new check; a failed check approves nothing and stores nothing", async ({ page }) => {
    await openLibrary(page);
    const before = await storage(page);
    await openChecks(page);
    await expect(page.getByTestId("check-status")).toContainText("Checks pass: all 5 examples");
    await page.getByTestId("what-if").click();
    await expect(page.getByTestId("refusal")).toHaveAttribute("data-stage", "needs-recheck");
    await page.getByTestId("recheck").click();
    await expect(page.getByTestId("recheck-failed")).toContainText("Three hotels, Two hotels");
    await expect(page.getByTestId("refusal")).toHaveAttribute("data-stage", "needs-recheck");
    const after = await storage(page);
    expect(after[`${NS}approvals`]).toBe(before[`${NS}approvals`]);
    await page.getByTestId("what-if").click();
    await expect(pill(page)).toHaveAttribute("data-state", "pass");
  });

  test("actions are previewed in plain words, never run; a sensitive value is never shown or stored", async ({ page }) => {
    await openLibrary(page);
    await canvas(page).getByRole("button", { name: "Choose Hotel Miradouro" }).click();
    const note = page.getByTestId("action-note");
    await expect(note).toContainText("Preview only, not run.");
    await expect(note).toContainText("“Choose Hotel Miradouro” would send hotel id h-102.");
    await expect(note).not.toContainText("{");
    await page.getByTestId("library-item-hotel-search").click();
    await expect(canvas(page)).toContainText("Find a hotel");
    const field = (id: string) => canvas(page).locator(`[data-a2ui-id="${id}"] input`);
    await field("destination").fill("Lisbon");
    await field("member_number").fill(SECRET);
    await canvas(page).getByRole("button", { name: "Search hotels" }).click();
    await expect(note).toContainText("member number (private: not shown, never kept)");
    await expect(note).not.toContainText(SECRET);
    // The recordable form is in Technical details.
    await expect(page.getByTestId("action-raw")).toContainText('"memberNumber":"[sensitive]"');
    const stored = await storage(page);
    expect(JSON.stringify(stored)).not.toContain(SECRET);
    expect(Object.keys(stored).filter((k) => k.startsWith("composer.") && !k.startsWith(NS) && !["composer.appearance.v1", "composer.providers.v1", "composer.projects.v1", "composer.lastProject.v1", "composer.experimental.v1"].includes(k))).toEqual([]);
  });
});

test.describe("D0: designer-first", () => {
  test("first run: the guide explains what Composer enables, its examples work, and putting it away is remembered", async ({ page }) => {
    await openLibrary(page);
    const guide = page.getByTestId("first-run");
    await expect(guide).toBeVisible();
    await expect(guide).toContainText("Design screens an AI agent can fill with real data");
    await expect(guide).toContainText("not available yet");
    await page.getByTestId("guide-rules").click();
    await expect(page.getByTestId("scenario-one")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("refusal")).toHaveAttribute("data-expected", "true");
    await page.getByTestId("guide-draft").click();
    await expect(page.getByRole("radio", { name: /v2 Draft/i })).toBeChecked();
    await page.getByTestId("guide-confirm").click();
    await expect(page.getByTestId("scenario-confirm")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("guide-dismiss").click();
    await expect(guide).toHaveCount(0);
    await page.reload();
    await page.getByTestId("nav-library").click();
    await expect(pill(page)).not.toHaveAttribute("data-state", "loading");
    await expect(page.getByTestId("first-run")).toHaveCount(0);
    await page.getByTestId("guide-show").click();
    await expect(page.getByTestId("first-run")).toBeVisible();
  });

  test("what is designed comes first: no hashes, gates, toolchain, rule ids or raw payloads in the primary view", async ({ page }) => {
    await openLibrary(page);
    await page.getByTestId("toggle-inspector").click();
    await canvas(page).getByRole("button", { name: "Choose Casa do Rio" }).click();
    for (const tab of ["design", "checks"]) {
      await page.getByTestId(`tab-${tab}`).click();
      const visible = await page.getByTestId("composition-library").innerText();
      expect(visible, tab).not.toMatch(/\b[0-9a-f]{12}\b/);
      expect(visible, tab).not.toMatch(/S1–S3|A1–A3|lint \d|emit \d|rule\.|"hotelId"|surface id/i);
    }
    const tech = page.getByTestId("technical-details");
    await expect(tech).not.toHaveAttribute("open", "");
    await tech.locator("summary").click();
    await expect(tech).toContainText("S1–S3");
    await expect(tech).toContainText(/lint \d/);
    await expect(tech).toContainText("hotel-results");
  });

  test("the Design tab says what it is, its versions, and that nothing is published; tabs work by keyboard", async ({ page }) => {
    await openLibrary(page, { guide: false });
    await page.getByTestId("toggle-inspector").click();
    const design = page.getByTestId("tabpanel-design");
    await expect(design).toBeVisible();
    await expect(page.getByTestId("versions")).toContainText("Approved: a person approved this exact version, and it cannot change.");
    await expect(page.getByTestId("versions")).toContainText("Draft: not approved for use by agents.");
    await expect(page.getByTestId("publication-note")).toContainText("Published for agents: no.");
    await expect(design).toContainText("Reserve: sends the hotel id. Consequential: asks for confirmation first");
    await page.getByTestId("tab-design").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("tab-checks")).toBeFocused();
    await expect(page.getByTestId("tab-checks")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("tabpanel-checks")).toBeVisible();
    await expect(design).toBeHidden();
    await page.keyboard.press("Home");
    await expect(page.getByTestId("tab-design")).toHaveAttribute("aria-selected", "true");
  });

  test("layout targets at 1280 × 800: the composition starts within 200 px, normal and first run, in a fixed frame", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLibrary(page);
    expect(await compositionTop(page)).toBeLessThanOrEqual(200);
    await page.getByTestId("guide-dismiss").click();
    expect(await compositionTop(page)).toBeLessThanOrEqual(200);
    // A fixed frame: the page itself does not scroll; the canvas and the panels scroll on their own.
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
    await page.getByTestId("toggle-inspector").click();
    const scrolled = await page.evaluate(() => {
      const c = document.querySelector<HTMLElement>(".cl-canvas")!;
      c.scrollTop = 400;
      return { canvas: c.scrollTop, header: Math.round(document.querySelector(".af-top")!.getBoundingClientRect().top), inspectorTop: Math.round(document.querySelector("#cl-inspector")!.getBoundingClientRect().top) };
    });
    expect(scrolled.canvas).toBeGreaterThan(0);
    expect(scrolled.header).toBe(0);
    expect(scrolled.inspectorTop).toBeLessThan(80);
    // The toolbar stays in view while the canvas scrolls.
    await expect(page.getByTestId("scenario-chips")).toBeInViewport();
  });

  test("layout targets at 390 × 844: the composition starts within 260 px, normal and first run", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openLibrary(page, { guide: false });
    expect(await compositionTop(page)).toBeLessThanOrEqual(260);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.evaluate(() => localStorage.removeItem("composer.experimental.workspace.onboarding"));
    await page.reload();
    await page.getByTestId("nav-library").click();
    await expect(page.getByTestId("first-run-strip")).toBeVisible();
    expect(await compositionTop(page)).toBeLessThanOrEqual(260);
  });

  test("fit width widens the centred composition", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLibrary(page, { guide: false });
    const width = () => page.evaluate(() => Math.round(document.querySelector('[data-project-canvas="composer"]')!.getBoundingClientRect().width));
    const centred = await width();
    expect(centred).toBeLessThanOrEqual(760);
    await page.getByTestId("fit-width").click();
    await expect(page.getByTestId("fit-width")).toHaveAttribute("aria-pressed", "true");
    expect(await width()).toBeGreaterThan(centred + 100);
  });

  test("on a phone the inspector is a bottom sheet", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openLibrary(page, { guide: false });
    await page.getByTestId("toggle-inspector").click();
    const box = await page.locator("#cl-inspector").boundingBox();
    expect(Math.round(box!.y + box!.height)).toBe(844);
    expect(box!.y).toBeGreaterThan(100);
    expect(Math.round(box!.width)).toBe(390);
  });
});

test.describe("M1 workspace review corrections (R1 to R4)", () => {
  test("R1: passing checks never reads as approval; a draft stays a draft", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await openLibrary(page, { guide: false });
    await openChecks(page);
    await page.getByRole("radio", { name: /v2 Draft/i }).check();
    await expect(page.getByTestId("draft-note")).toContainText("not approved for use by agents");
    await expect(pill(page)).toContainText("Passes the design rules · Draft, not approved");
    await expect(page.getByTestId("check-status")).toHaveAttribute("data-check", "pass");
    await expect(page.getByTestId("draft-check-note")).toContainText("passing checks does not approve it");
    await expect(page.getByTestId("device-record")).not.toContainText(/approv/i);
    // Under changed rules, a draft is "last checked", never "approved".
    await page.getByTestId("what-if").click();
    await expect(page.getByTestId("refusal")).toContainText("was last checked");
    // "Approved" appears only as a version's status, or to say something is not approved or not published.
    for (const tab of ["design", "checks"]) {
      await page.getByTestId(`tab-${tab}`).click();
      const text = await page.getByTestId("composition-library").innerText();
      for (const line of text.split("\n").filter((l) => /approv/i.test(l))) {
        expect(line, line).toMatch(/v\d+ (·\s)?approved|approved v\d+|approved: a person approved this exact version|not approved|does not approve|being approved does not publish|approving a version is a separate|approved version/i);
        expect(line, line).not.toMatch(/checks? (pass|passed)[^.]*\bapproved\b(?! for)|first approval|was approved/i);
      }
    }
  });

  test("R2: the canvas and the inspector report one result, through try-out checks that pass and fail, and the restore", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await openLibrary(page, { guide: false });
    const approvalsBefore = (await storage(page))[`${NS}approvals`];
    await openChecks(page);
    const rules = () => page.getByTestId("technical-details").evaluate((el) => /Contract(.*?)Toolchain/.exec(el.textContent ?? "")?.[1]);
    const contract = await rules();
    expect(contract).toContain("Astryx reference");
    const status = () => page.getByTestId("check-status");
    await page.getByTestId("what-if").click();
    await expect(page.getByTestId("refusal")).toHaveAttribute("data-stage", "needs-recheck");
    await expect(status()).toHaveAttribute("data-check", "unchecked");
    await expect(pill(page)).toHaveAttribute("data-state", "unchecked");
    // A try-out check that fails: both say so.
    await page.getByTestId("recheck").click();
    await expect(status()).toHaveAttribute("data-check", "fail");
    await expect(status()).toContainText("Three hotels, Two hotels");
    await expect(pill(page)).toHaveAttribute("data-state", "fail");
    await expect(page.getByTestId("recheck-failed")).toContainText("Three hotels, Two hotels");
    // A try-out check that passes (hotel search is unaffected): both say so.
    await page.getByTestId("toggle-library").click();
    await page.getByTestId("library-item-hotel-search").click();
    await expect(page.getByTestId("refusal")).toHaveAttribute("data-stage", "needs-recheck");
    await page.getByTestId("recheck").click();
    await expect(pill(page)).toHaveAttribute("data-state", "pass");
    await openChecks(page);
    await expect(status()).toHaveAttribute("data-check", "pass");
    await expect(status()).toContainText("the stricter try-out rule");
    // Restore: the packaged checks authorize again, for both compositions, and the inspector agrees with the canvas.
    await page.getByTestId("what-if").click();
    await expect(pill(page)).toHaveAttribute("data-state", "pass");
    await expect(status()).toHaveAttribute("data-check", "pass");
    await expect(status()).toContainText("the Astryx design rules");
    await page.getByTestId("toggle-library").click();
    await page.getByTestId("library-item-hotel-results").click();
    await expect(pill(page)).toHaveAttribute("data-state", "pass");
    await openChecks(page);
    await expect(status()).toContainText("Checks pass: all 5 examples");
    // The packaged rules are unchanged and nothing from the try-out was stored.
    expect(await rules()).toBe(contract);
    expect((await storage(page))[`${NS}approvals`]).toBe(approvalsBefore);
  });

  test("R3: on a phone an open panel is a modal dialog; focus stays inside, the background is unavailable, Escape returns", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openLibrary(page, { guide: false });
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
    await openLibrary(page, { guide: false });
    const inView = () => page.getByTestId("action-note").evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
    await canvas(page).getByRole("button", { name: "Choose Casa do Rio" }).click();
    await expect(page.getByTestId("action-note")).toContainText("Preview only, not run.");
    expect(await inView()).toBe(true);
    const last = canvas(page).getByRole("button", { name: "Choose Lumen Chiado" });
    await last.scrollIntoViewIfNeeded();
    await last.click();
    await expect(page.getByTestId("action-note")).toContainText("hotel id h-103");
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
    await page.getByTestId("guide-dismiss").click();
    const after = await storage(page);
    const changed = Object.keys(after).filter((k) => after[k] !== before[k]);
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.every((k) => k.startsWith(NS))).toBe(true);
    expect(after["composer.projects.v1"]).toBe(projects);
    expect(JSON.parse(after[`${NS}library`]!)).toMatchObject({ schema: "composer.experimental.workspace/library", version: 1, data: { composition: "hotel-search", version: 1 } });
    expect(JSON.parse(after[`${NS}onboarding`]!)).toEqual({ schema: "composer.experimental.workspace/onboarding", version: 1, data: { dismissed: true } });
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
  test("keyboard only: reach the list, choose a composition, change version and example; focus is visible", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await openLibrary(page, { guide: false });
    await page.locator("#cl-filter").focus();
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      seen.push(await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.id ?? document.activeElement?.tagName ?? ""));
      if (seen.at(-1) === "library-item-hotel-search") break;
    }
    expect(seen).toContain("library-item-hotel-search");
    expect(await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle)).not.toBe("none");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("library-item-hotel-search")).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("library-item-hotel-search")).toBeFocused();
    await expect(canvas(page)).toContainText("Find a hotel");
    await page.getByTestId("library-item-hotel-results").click();
    await page.getByRole("radio", { name: /v1 Approved/i }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: /v2 Draft/i })).toBeChecked();
    await expect(canvas(page)).toContainText("Prices are per night");
    await page.getByTestId("scenario-two").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("scenario-two")).toHaveAttribute("aria-pressed", "true");
    await expect(canvas(page).locator('[data-a2ui-component="SelectableCard"]')).toHaveCount(2);
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

  test("390 px: canvas first; panels are sheets with focus moved in, Escape returns it, a choice lands on the canvas", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openLibrary(page);
    await expect(page.getByTestId("composition-library")).toHaveAttribute("data-library", "closed");
    await expect(page.getByTestId("composition-library")).toHaveAttribute("data-inspector", "closed");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.querySelector(".cl-canvas")!.getBoundingClientRect().width)).toBeGreaterThanOrEqual(380);
    await page.getByTestId("toggle-library").click();
    await expect(page.locator("#cl-library")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("composition-library")).toHaveAttribute("data-library", "closed");
    await expect(page.getByTestId("toggle-library")).toBeFocused();
    await page.getByTestId("toggle-library").click();
    await expect(page.getByTestId("coming-next-narrow")).toContainText("not available yet");
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
      // No exception: the Astryx list-item violation that used to be excepted here is fixed in the List adapter
      // (#128, docs/repositioning/list-semantics/).
      const results = await new AxeBuilder({ page }).include('[data-testid="composition-library"]').withTags(TAGS).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.length} (${v.help})`)).toEqual([]);
      if (w === 1280) {
        await page.getByTestId("tab-checks").click();
        await example(page, "one");
        const refused = await new AxeBuilder({ page }).include('[data-testid="composition-library"]').withTags(TAGS).analyze();
        expect(refused.violations.map((v) => `${v.id}: ${v.nodes.length} (${v.help})`)).toEqual([]);
      }
    });
  }
});
