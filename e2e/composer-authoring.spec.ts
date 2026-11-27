/**
 * Composition authoring, the first increment (M1 A1 to A4), in the experimental Library: create and discard a
 * draft, edit its details, parameters and examples, run its checks, and approve it on this device. Agent-free:
 * nothing here calls a model, and the Library makes no request.
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
const bar = (page: Page) => page.getByTestId("authoring-bar");
/** The packaged draft of hotel results, chosen in the version control beside the title. */
const openDraft = (page: Page) => page.getByRole("radio", { name: /v2 Draft/i }).check();

async function choose(page: Page, composition: string) {
  if ((await page.getByTestId("composition-library").getAttribute("data-library")) !== "open") await page.getByTestId("toggle-library").click();
  await page.getByTestId(`library-item-${composition}`).click();
}

/** The definition hash of the selected version, from Technical details (where a designer never needs to look). */
async function definitionHash(page: Page) {
  if ((await page.getByTestId("composition-library").getAttribute("data-inspector")) !== "open") await page.getByTestId("toggle-inspector").click();
  const tech = page.getByTestId("technical-details");
  if ((await tech.getAttribute("open")) === null) await tech.locator("summary").click();
  const text = (await tech.textContent()) ?? "";
  await tech.locator("summary").click();
  return /Definition hash([0-9a-f]{12})/.exec(text)?.[1] ?? null;
}

async function runChecks(page: Page, expected: "pass" | "fail") {
  await page.getByTestId("run-checks").click();
  await expect(bar(page)).toHaveAttribute("data-state", expected);
}

test.describe("A1: create and discard drafts", () => {
  test("Create draft forks v2 from approved v1, opens it for editing, and leaves v1 exactly as it was, across a reload", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLibrary(page);
    await choose(page, "hotel-search");
    const v1 = await definitionHash(page);
    expect(v1).toMatch(/^[0-9a-f]{12}$/);
    const create = page.getByTestId("create-draft");
    await expect(create).toHaveClass(/cl-tool--primary/);
    await create.click();
    await expect(page.getByRole("radio", { name: /v2 Draft/i })).toBeChecked();
    await expect(page.getByTestId("authoring-notice")).toContainText("Draft v2 created from v1. v1 stays approved and unchanged.");
    await expect(page.getByTestId("tab-design")).toHaveText("Details");
    await expect(page.getByTestId("edit-name")).toHaveValue("Hotel search");
    await expect(bar(page)).toHaveAttribute("data-state", "unchecked");
    // Previewed through the pipeline, labelled as not checked.
    await expect(page.getByTestId("preview-note")).toContainText("not checked yet");
    await expect(canvas(page)).toContainText("Find a hotel");
    await page.getByRole("radio", { name: /v1 Approved/i }).check();
    expect(await definitionHash(page)).toBe(v1);
    await expect(page.getByTestId("create-draft")).toHaveCount(0);
    await expect(page.getByTestId("open-draft")).toHaveText("Open draft v2");
    await page.reload();
    await ready(page);
    await choose(page, "hotel-search");
    await expect(page.getByRole("radio", { name: /v2 Draft/i })).toBeVisible();
    expect(await definitionHash(page)).toBe(v1);
    const stored = await storage(page);
    expect(JSON.parse(stored[`${NS}drafts`]!).data.drafts.map((d: { id: string; version: number }) => `${d.id}@${d.version}`)).toEqual(["hotel-search@2"]);
  });

  test("an approved version with a draft directs to the draft instead of making another", async ({ page }) => {
    await openLibrary(page);
    await expect(page.getByTestId("create-draft")).toHaveCount(0);
    await openDraft(page);
    await expect(page.getByRole("radio", { name: /v2 Draft/i })).toBeChecked();
  });

  test("Discard asks first; discarding the sample draft withdraws it on this device, and a new draft can be made", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLibrary(page);
    const v1 = await definitionHash(page);
    await openDraft(page);
    await page.getByTestId("discard").click();
    const confirm = page.getByTestId("discard-confirm");
    await expect(confirm).toContainText("Discard draft v2?");
    await expect(confirm).toContainText("The approved versions are not affected.");
    await confirm.getByRole("button", { name: "Keep the draft" }).click();
    await expect(page.getByRole("radio", { name: /v2 Draft/i })).toBeChecked();
    await page.getByTestId("discard").click();
    await page.getByTestId("discard-confirm-button").click();
    await expect(page.getByTestId("authoring-notice")).toContainText("Draft v2 discarded");
    await expect(page.getByRole("radio")).toHaveCount(0);
    await expect(page.getByTestId("create-draft")).toBeVisible();
    expect(await definitionHash(page)).toBe(v1);
    await page.reload();
    await ready(page);
    await expect(page.getByTestId("create-draft")).toBeVisible();
    expect(JSON.parse((await storage(page))[`${NS}versions`]!).data).toEqual({ approved: [], retired: ["hotel-results@2"] });
  });
});

test.describe("A2: edit a draft", () => {
  test("name and summary are edited in place, applied only when valid, and kept across a reload", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLibrary(page);
    await openDraft(page);
    await page.getByTestId("toggle-inspector").click();
    await page.getByTestId("edit-name").fill("Hotel choices");
    await expect(page.locator("#cl-canvas-title")).toHaveText("Hotel choices");
    await page.getByTestId("edit-name").fill("");
    await expect(page.getByText("Not applied:")).toBeVisible();
    await expect(page.locator("#cl-canvas-title")).toHaveText("Hotel choices");
    await page.getByTestId("edit-name").fill("Hotel choices, compact");
    await expect(page.getByText("Not applied:")).toHaveCount(0);
    await page.getByTestId("edit-summary").fill("Compares the hotels a search found.");
    await expect(bar(page)).toHaveAttribute("data-state", "unchecked");
    await page.getByTestId("draft-note").locator("summary").click();
    await expect(page.getByTestId("draft-changes")).toContainText("The name reads “Hotel choices, compact”.");
    await expect(page.getByTestId("draft-changes")).toContainText("The summary is reworded.");
    await page.reload();
    await ready(page);
    await expect(page.locator("#cl-canvas-title")).toHaveText("Hotel choices, compact");
  });

  test("declared parameters are edited with typed controls; a composition without parameters says so", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLibrary(page);
    await page.getByTestId("toggle-inspector").click();
    await openDraft(page);
    await expect(page.getByTestId("no-parameters")).toBeVisible();
    await choose(page, "hotel-search");
    await page.getByTestId("create-draft").click();
    await page.getByTestId("param-title-description").fill("The form's heading.");
    await page.getByTestId("param-title-maxLength").fill("40");
    await expect(page.getByTestId("param-title-maxLength")).toHaveValue("40");
    await page.getByTestId("param-title-required").check();
    await page.getByTestId("draft-note").locator("summary").click();
    await expect(page.getByTestId("draft-changes")).toContainText("The “title” parameter changed.");
  });

  test("examples are added, duplicated, renamed, edited as a form and removed; the canvas previews each change", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLibrary(page);
    await openDraft(page);
    await page.getByTestId("toggle-inspector").click();
    await page.getByTestId("tab-examples").click();
    await page.getByTestId("duplicate-two").click();
    await expect(page.getByTestId("scenario-two-hotels-copy")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("edit-example-title").fill("Two hotels in Porto");
    await page.getByTestId("data-destination").fill("Porto");
    await expect(canvas(page)).toContainText("Hotels in Porto");
    await expect(page.getByTestId("preview-note")).toBeVisible();
    await expect(page.getByTestId("scenario-chips")).toContainText("Two hotels in Porto");
    await page.getByTestId("data-hotels-add").click();
    await page.getByTestId("data-hotels-2-name").fill("Casa Ribeira");
    await expect(page.getByTestId("example-issues")).toContainText("Hotels, item 3, id: is empty; it needs some text");
    await page.getByTestId("data-hotels-2-remove").click();
    await expect(page.getByTestId("example-issues")).toHaveCount(0);
    await page.getByTestId("add-example").click();
    await expect(page.getByTestId("scenario-new-example")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("example-issues")).toBeVisible();
    await page.getByTestId("remove-new-example").click();
    await expect(page.getByTestId("scenario-new-example")).toHaveCount(0);
    await page.reload();
    await ready(page);
    await expect(page.getByTestId("scenario-two-hotels-copy")).toHaveText("Two hotels in Porto");
  });

  test("invalid data is said in plain words before the checks; the last valid preview is kept, labelled", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLibrary(page);
    await openDraft(page);
    await page.getByTestId("toggle-inspector").click();
    await page.getByTestId("tab-examples").click();
    await page.getByTestId("example-two").click();
    await page.getByTestId("data-nights").fill("0");
    await expect(page.getByTestId("example-issues")).toContainText("Nights: must be at least 1");
    const refusal = page.getByTestId("refusal");
    await expect(refusal).toContainText("Not shown: this data does not fit the composition");
    await expect(page.getByTestId("refusal-data")).toContainText("Nights: must be at least 1");
    await expect(page.getByTestId("kept-instance").locator("summary")).toHaveText("Last valid preview · not interactive");
    await page.getByTestId("data-nights").fill("3");
    await expect(canvas(page)).toContainText("Hotels in Lisbon");
  });

  test("an expected refusal names a rule from the contract, and the checks hold the example to it", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLibrary(page);
    await openDraft(page);
    await page.getByTestId("toggle-inspector").click();
    await page.getByTestId("tab-examples").click();
    await page.getByTestId("example-two").click();
    await page.getByTestId("data-hotels-1-remove").click();
    await expect(page.getByTestId("refusal")).toContainText("A comparison needs at least two options to choose from.");
    await page.getByTestId("expect-refused").check();
    await expect(page.getByTestId("expect-rule")).toHaveValue("rule.review-offers-alternatives");
    await expect(page.getByTestId("expect-rule").locator("option:checked")).toContainText("A comparison needs at least two options");
    await expect(page.getByTestId("refusal")).toHaveAttribute("data-expected", "true");
    await runChecks(page, "pass");
    await page.getByTestId("tab-checks").click();
    await expect(page.getByTestId("check-row-two")).toContainText("Refused by a rule");
    await expect(page.getByTestId("check-row-two")).toContainText("✓ As expected");
  });
});

test.describe("A3 and A4: checks and approval", () => {
  test("an unexpected failure says which example and what to do; an edit makes a passing check stale", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLibrary(page);
    await openDraft(page);
    await page.getByTestId("toggle-inspector").click();
    await expect(bar(page)).toHaveAttribute("data-state", "pass");
    await expect(page.getByTestId("approve")).toBeVisible();
    await page.getByTestId("tab-examples").click();
    await page.getByTestId("example-two").click();
    await page.getByTestId("data-hotels-1-remove").click();
    // The packaged pass is stale now: approval is no longer offered.
    await expect(bar(page)).toHaveAttribute("data-state", "unchecked");
    await expect(page.getByTestId("approve")).toHaveCount(0);
    await expect(page.getByTestId("draft-note").locator("summary")).toContainText("Not checked");
    await runChecks(page, "fail");
    await expect(bar(page)).toContainText("1 example does not behave as expected");
    await page.getByTestId("tab-checks").click();
    await expect(page.getByTestId("check-status")).toHaveAttribute("data-check", "fail");
    await expect(page.getByTestId("check-why-two")).toContainText("A design rule refuses it: A comparison needs at least two options to choose from.");
    await expect(page.getByTestId("tab-checks")).toContainText("fails");
    await page.getByTestId("edit-example-two").click();
    await expect(page.getByTestId("tabpanel-examples")).toBeVisible();
    await expect(page.getByTestId("example-editor")).toContainText("Edit “Two hotels”");
  });

  test("approval needs a passing check of this exact draft, says what it means first, and records exactly that version", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLibrary(page);
    const v1 = await definitionHash(page);
    await openDraft(page);
    await page.getByTestId("approve").click();
    const confirm = page.getByTestId("approve-confirm");
    await expect(confirm).toContainText("v2 becomes approved and can no longer change.");
    await expect(confirm).toContainText("v1 and every other approved version stay available.");
    await expect(confirm).toContainText("The approval is recorded on this device only.");
    await expect(confirm).toContainText("It is not published: no external agent can use it.");
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("radio", { name: /v2 Draft/i })).toBeChecked();
    await page.getByTestId("approve").click();
    await page.getByTestId("approve-confirm-button").click();
    await expect(page.getByTestId("authoring-notice")).toContainText("v2 is approved on this device. It cannot change now; v1 stays available. It is not published.");
    await expect(page.getByRole("radio", { name: /v2 Approved/i })).toBeChecked();
    await expect(page.getByTestId("check-pill")).toHaveAttribute("data-state", "pass");
    await expect(canvas(page)).toContainText("Prices are per night, before taxes.");
    await expect(page.getByTestId("versions")).toContainText("Approved on this device");
    const v2 = await definitionHash(page);
    expect(v2).not.toBe(v1);
    await page.reload();
    await ready(page);
    await page.getByRole("radio", { name: /v2 Approved/i }).check();
    await expect(page.getByTestId("check-pill")).toHaveAttribute("data-state", "pass");
    expect(await definitionHash(page)).toBe(v2);
    await page.getByRole("radio", { name: /v1 Approved/i }).check();
    expect(await definitionHash(page)).toBe(v1);
    await expect(canvas(page)).toContainText("Compare and choose one.");
    // Both stay approved; the next draft is v3, and with three versions the version control becomes a menu.
    await page.getByRole("radio", { name: /v2 Approved/i }).check();
    await page.getByTestId("create-draft").click();
    await expect(page.getByTestId("version-select")).toHaveValue("3");
    await expect(page.getByTestId("version-select").locator("option")).toHaveText(["v3 Draft", "v2 Approved on this device", "v1 Approved"]);
    const stored = JSON.parse((await storage(page))[`${NS}versions`]!).data;
    expect(stored.approved.map((c: { id: string; version: number; status: string }) => `${c.id}@${c.version}:${c.status}`)).toEqual(["hotel-results@2:approved"]);
  });

  test("when the approval cannot be stored, nothing is approved and the draft stays a draft", async ({ page }) => {
    await page.addInitScript(() => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key === "composer.experimental.workspace.versions") throw new DOMException("quota", "QuotaExceededError");
        return set.call(this, key, value);
      };
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLibrary(page);
    await openDraft(page);
    await page.getByTestId("toggle-inspector").click();
    await page.getByTestId("approve").click();
    await page.getByTestId("approve-confirm-button").click();
    await expect(page.getByTestId("authoring-notice")).toContainText("Not approved: nothing was approved");
    await expect(page.getByRole("radio", { name: /v2 Draft/i })).toBeChecked();
    await page.reload();
    await ready(page);
    await expect(page.getByRole("radio", { name: /v2 Draft/i })).toBeVisible();
    expect((await storage(page))[`${NS}versions`]).toBeUndefined();
  });

  test("a sensitive value typed into a draft's preview is never shown or stored", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLibrary(page);
    await choose(page, "hotel-search");
    await page.getByTestId("create-draft").click();
    await expect(page.getByTestId("preview-note")).toBeVisible();
    await canvas(page).locator('[data-a2ui-id="destination"] input').fill("Lisbon");
    await canvas(page).locator('[data-a2ui-id="member_number"] input').fill("SYN-LOYAL-7781");
    await canvas(page).getByRole("button", { name: "Search hotels" }).click();
    await expect(page.getByTestId("action-note")).toContainText("member number (private: not shown, never kept)");
    await expect(page.getByTestId("action-note")).not.toContainText("SYN-LOYAL-7781");
    expect(JSON.stringify(await storage(page))).not.toContain("SYN-LOYAL-7781");
  });
});

test.describe("the authoring walkthrough, keyboard, layout and accessibility", () => {
  test("walkthrough: create a draft, break an example, find the failure, fix it, check, approve, reload", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLibrary(page);
    await choose(page, "hotel-search");
    await page.getByTestId("create-draft").click();
    await page.getByTestId("tab-examples").click();
    await page.getByTestId("example-invalid").click();
    await page.getByTestId("data-errors-0").fill("");
    await expect(page.getByTestId("example-issues")).toContainText("Errors, item 1: is empty; it needs some text");
    await runChecks(page, "fail");
    await page.getByTestId("tab-checks").click();
    await expect(page.getByTestId("check-why-invalid")).toContainText("Its data does not fit: Errors, item 1: is empty");
    await page.getByTestId("edit-example-invalid").click();
    await page.getByTestId("data-errors-0").fill("Choose a check-out date after check-in.");
    await runChecks(page, "pass");
    await page.getByTestId("approve").click();
    await page.getByTestId("approve-confirm-button").click();
    await expect(page.getByRole("radio", { name: /v2 Approved/i })).toBeChecked();
    await page.reload();
    await ready(page);
    await choose(page, "hotel-search");
    await expect(page.getByRole("radio", { name: /v2 Approved/i })).toBeVisible();
    await page.getByRole("radio", { name: /v2 Approved/i }).check();
    await page.getByTestId("scenario-invalid").click();
    await expect(canvas(page)).toContainText("Choose a check-out date after check-in.");
    await expect(page.getByTestId("check-pill")).toHaveAttribute("data-state", "pass");
  });

  test("keyboard only: the three tabs move with arrows, and Run checks and Approve work from the keyboard", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLibrary(page);
    await page.getByRole("radio", { name: /v1 Approved/i }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: /v2 Draft/i })).toBeChecked();
    await page.getByTestId("toggle-inspector").focus();
    await page.keyboard.press("Enter");
    await page.getByTestId("tab-design").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("tab-examples")).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("tab-checks")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("tab-design")).toBeFocused();
    await page.getByTestId("run-checks-again").focus();
    await page.keyboard.press("Enter");
    await expect(bar(page)).toHaveAttribute("data-state", "pass");
    await page.getByTestId("approve").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByTestId("approve-confirm-button")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("radio", { name: /v2 Approved/i })).toBeChecked();
  });

  test("on a phone the inspector sheet holds the editors and the authoring actions, without sideways scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openLibrary(page);
    await openDraft(page);
    await page.getByTestId("toggle-inspector").click();
    await expect(page.getByRole("dialog", { name: "Inspector" })).toBeVisible();
    await page.getByTestId("tab-examples").click();
    await page.getByTestId("example-two").click();
    await page.getByTestId("data-destination").fill("Porto");
    await expect(bar(page)).toHaveAttribute("data-state", "unchecked");
    const run = page.getByTestId("run-checks");
    await expect(run).toBeInViewport();
    expect((await run.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await run.click();
    await expect(bar(page)).toHaveAttribute("data-state", "pass");
  });

  for (const [w, h] of [
    [1280, 800],
    [390, 844],
  ] as const) {
    test(`axe finds no WCAG 2.2 A or AA violation while authoring at ${w} px`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await openLibrary(page);
      await openDraft(page);
      await page.getByTestId("toggle-inspector").click();
      const scan = async (label: string) => {
        const results = await new AxeBuilder({ page }).include('[data-testid="composition-library"]').withTags(TAGS).analyze();
        expect(results.violations.map((v) => `${label} ${v.id}: ${v.nodes.length} (${v.help})`)).toEqual([]);
      };
      await scan("details");
      await page.getByTestId("tab-examples").click();
      await page.getByTestId("example-two").click();
      await page.getByTestId("data-hotels-1-remove").click();
      await scan("examples with an issue");
      await page.getByTestId("run-checks").click();
      await expect(bar(page)).toHaveAttribute("data-state", "fail");
      await page.getByTestId("tab-checks").click();
      await scan("failing checks");
      await page.getByTestId("data-hotels-add").count();
      await page.getByTestId("discard").click();
      await scan("discard confirmation");
    });
  }
});
