/**
 * Phase 2, step 4 (docs/blocks/PHASE-2-RELEASE-PLAN.md, §7 H3 and §8) in the
 * EXPERIMENTAL composer artifact: the read-only Blocks catalog, Preview's
 * provenance line and host-owned wording, and provenance through save,
 * export, import, duplicate and delete. Agent-free: /api/models is stubbed,
 * every build is scripted, and no model is called.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

type Json = Record<string, any>;

/** WCAG 2 A/AA over what this step adds, and nothing else on the page. */
const scanOf = (page: Page, testId: string) =>
  new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).disableRules(["region"]).include(`[data-testid="${testId}"]`).analyze();

const SWITCH_ON = { enabled: true, references: ["shadcn", "astryx"], blocks: ["records-table", "auth-form", "guide-steps"] };

async function setUp(page: Page) {
  await page.addInitScript(() => localStorage.setItem("composer.experimental.v1", JSON.stringify({ blocks: true })));
  await page.route("**/api/models", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ models: ["scripted"], blocks: SWITCH_ON }) }));
  await page.goto("/");
}

async function newProject(page: Page, name: string) {
  await page.getByTestId("nav-projects").click();
  await page.getByTestId("new-project-name").fill(name);
  await page.getByTestId("new-source-shadcn").click();
  await page.getByTestId("new-project-create").click();
  await expect(page.getByTestId("build-prompt")).toBeVisible();
}

/** A scripted sign-in build on shadcn/ui expands auth-form; accept it (turn `turn` of the thread) and return its example id. */
async function acceptAuthForm(page: Page, turn = 1): Promise<string> {
  await page.getByTestId("build-model").selectOption("scripted");
  await page.getByTestId("build-intent").selectOption("structured-input");
  await page.getByTestId("build-prompt").fill("a sign-in form with email and password");
  await page.getByTestId("build-run").click();
  await expect(page.getByTestId(`build-gate-summary-${turn}`)).toContainText("Follows your design-system rules", { timeout: 30_000 });
  await expect(page.getByTestId(`build-block-${turn}`)).toContainText("block auth-form v1");
  await page.getByTestId(`build-accept-${turn}`).click();
  await expect(page.getByTestId(`build-accepted-${turn}`)).toContainText(/ex\.chat-\d+/);
  return (await page.getByTestId(`build-accepted-${turn}`).innerText()).match(/ex\.chat-\d+/)![0];
}

/** Every provenance map in this browser, by storage key. */
const storedProvenance = (page: Page) =>
  page.evaluate(() => {
    const out: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      if (key.startsWith("composer.project.blocks.")) out[key] = JSON.parse(localStorage.getItem(key)!);
    }
    return out;
  });

/** Wait until provenance for `id` is stored (it is written after the accept, off the critical path). */
async function provenanceStoredFor(page: Page, id: string) {
  await expect.poll(async () => Object.values(await storedProvenance(page)).some((map) => id in map)).toBe(true);
}

/** Edit the accepted auth-form surface's "Email address" label in Surfaces, and save. */
async function editSurface(page: Page, id: string) {
  await page.getByTestId("nav-surfaces").click();
  await page.getByTestId(`edit-${id}`).click();
  const texts = page.locator('[data-testid^="node-text-"]');
  const n = await texts.count();
  let edited = false;
  for (let i = 0; i < n && !edited; i++) {
    if ((await texts.nth(i).inputValue()) === "Email address") {
      await texts.nth(i).fill("Work email address");
      edited = true;
    }
  }
  expect(edited).toBe(true);
  await expect(page.getByTestId("save-scenario")).toBeEnabled();
  await page.getByTestId("save-scenario").click();
}

/** Export the open project from the hub and return the file's JSON. */
async function exportProjectFile(page: Page): Promise<Json> {
  await page.getByTestId("nav-projects").click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator('[data-testid^="project-export-"]').first().click()]);
  const path = await download.path();
  const { readFileSync } = await import("node:fs");
  return JSON.parse(readFileSync(path!, "utf8")) as Json;
}

/** Import a project file through the hub. */
async function importProjectFile(page: Page, file: Json, name: string) {
  await page.getByTestId("nav-projects").click();
  await page.getByTestId("import-project-input").setInputFiles({ name: `${name}.composerproject.json`, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });
  await expect(page.getByTestId("build-prompt")).toBeVisible();
}

test("the Catalog lists every bundled block, read-only: reference, version, status, intents, declared actions and streaming policy", async ({ page }) => {
  await setUp(page);
  await newProject(page, "Catalog");
  await page.getByTestId("nav-inventory").click();
  const catalog = page.getByTestId("blocks-catalog");
  await expect(catalog).toBeVisible();
  await expect(catalog).toContainText("Interface blocks");

  const shadcn = page.getByTestId("blocks-catalog-ref-shadcn");
  await expect(shadcn).toContainText("shadcn/ui 3.2.0");
  await expect(shadcn).toContainText("this project");
  await expect(shadcn).toContainText(/withheld from this beta/);
  const astryx = page.getByTestId("blocks-catalog-ref-astryx");
  await expect(astryx).toContainText("Astryx 0.1.4");
  await expect(astryx).not.toContainText("this project");

  const auth = page.getByTestId("blocks-catalog-shadcn-auth-form");
  for (const text of ["auth-form", "Account access", "v1", "approved", "structured-input", "auth_submit", "auth_forgot", "auth_provider_apple", "disable actions until complete"]) {
    await expect(auth).toContainText(text);
  }
  const guide = page.getByTestId("blocks-catalog-astryx-guide-steps");
  for (const text of ["guide-steps", "structured-editing", "guide_start", "guide_save", "static-safe"]) await expect(guide).toContainText(text);
  await expect(page.getByTestId("blocks-catalog-astryx-records-table")).toContainText("records_refresh");

  // Read-only: nothing in it can be pressed, typed into or chosen.
  await expect(catalog.locator("button, input, select, textarea, a[href]")).toHaveCount(0);
  await expect(catalog).toContainText(/host-owned/);
  expect((await scanOf(page, "blocks-catalog")).violations).toEqual([]);
});

test("trusted: an accepted block surface is made with its block and refinable; its actions are host-owned and Composer sends nothing", async ({ page }) => {
  await setUp(page);
  await newProject(page, "Trusted");
  const id = await acceptAuthForm(page);
  await provenanceStoredFor(page, id);

  await page.getByTestId("nav-preview").click();
  await page.getByTestId(`surface-${id}`).click();
  const line = page.getByTestId("preview-provenance");
  await expect(line).toContainText("Made with block auth-form v1");
  // Refinable says what the record is, never that a build will use the block:
  // the beta switch, Settings and eligibility decide that.
  await expect(line).toContainText("Refinable: its record verifies against this build's approved block.");
  await expect(line).not.toContainText("offers");
  const note = page.getByTestId("preview-host-owned");
  await expect(note).toContainText("host-owned");
  await expect(note).toContainText(/not executed here/);

  // Every action the surface dispatches is recorded, and none leaves the page.
  const requests: string[] = [];
  page.on("request", (r) => requests.push(`${r.method()} ${r.url()}`));
  const buttons = page.locator("[data-project-canvas] button:not([disabled])");
  const count = await buttons.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) await buttons.nth(i).click();
  await expect(page.getByTestId("action-log")).toContainText("auth_submit");
  await page.waitForTimeout(500);
  expect(requests).toEqual([]);

  expect((await scanOf(page, "preview-provenance")).violations).toEqual([]);
  expect((await scanOf(page, "preview-host-owned")).violations).toEqual([]);
});

test("edited: saving a hand edit drops the provenance, and the surface previews as an ordinary one", async ({ page }) => {
  await setUp(page);
  await newProject(page, "Edited");
  const id = await acceptAuthForm(page);
  await provenanceStoredFor(page, id);

  await editSurface(page, id);
  await expect.poll(async () => Object.values(await storedProvenance(page)).some((map) => id in map)).toBe(false);
  await page.getByTestId("nav-preview").click();
  await page.getByTestId(`surface-${id}`).click();
  await expect(page.locator("[data-project-canvas]")).toContainText("Work email address");
  await expect(page.getByTestId("preview-provenance")).toHaveCount(0);
  await expect(page.getByTestId("preview-host-owned")).toHaveCount(0);
});

test("duplicated and deleted: a duplicate carries provenance that still verifies; deleting a project deletes its provenance", async ({ page }) => {
  await setUp(page);
  await newProject(page, "Original");
  const id = await acceptAuthForm(page);
  await provenanceStoredFor(page, id);

  await page.getByTestId("nav-projects").click();
  const grid = page.getByTestId("projects-grid");
  const originalId = (await grid.locator(".af-card").filter({ hasText: "Original" }).first().getAttribute("data-testid"))!.replace("project-", "");
  await page.getByTestId(`project-duplicate-${originalId}`).click();
  await expect(grid).toContainText("Original copy");
  const copyId = (await grid.locator(".af-card").filter({ hasText: "Original copy" }).first().getAttribute("data-testid"))!.replace("project-", "");
  expect(Object.keys((await storedProvenance(page))[`composer.project.blocks.${copyId}`] ?? {})).toEqual([id]);

  await page.getByTestId(`project-build-${copyId}`).click();
  await page.getByTestId("nav-preview").click();
  await page.getByTestId(`surface-${id}`).click();
  await expect(page.getByTestId("preview-provenance")).toContainText("Made with block auth-form v1");
  await expect(page.getByTestId("preview-provenance")).toContainText(/refinable/i);

  await page.getByTestId("nav-projects").click();
  await page.getByTestId(`project-delete-${copyId}`).click();
  await page.getByTestId(`project-delete-confirm-${copyId}`).click();
  await expect(grid).not.toContainText("Original copy");
  const left = await storedProvenance(page);
  expect(left[`composer.project.blocks.${copyId}`]).toBeUndefined();
  expect(Object.keys(left[`composer.project.blocks.${originalId}`] ?? {})).toEqual([id]);
});

test("imported: provenance survives export and import, still labels the surface, and is unavailable for refinement", async ({ page }) => {
  await setUp(page);
  await newProject(page, "Portable blocks");
  const id = await acceptAuthForm(page);
  await provenanceStoredFor(page, id);

  const file = await exportProjectFile(page);
  expect(Object.keys(file.blockProvenance ?? {})).toEqual([id]);
  await importProjectFile(page, file, "portable-blocks");
  await page.getByTestId("nav-preview").click();
  await page.getByTestId(`surface-${id}`).click();
  const line = page.getByTestId("preview-provenance");
  await expect(line).toContainText("Made with block auth-form v1");
  await expect(line).toContainText(/unavailable/i);
  await expect(line).toContainText("imported projects never refine from provenance");
  expect((await scanOf(page, "preview-provenance")).violations).toEqual([]);
});

test("forged and stale: an imported record that does not verify is inert, names the reason, and earns no label", async ({ page }) => {
  await setUp(page);
  await newProject(page, "Forgery source");
  const id = await acceptAuthForm(page);
  await provenanceStoredFor(page, id);
  const file = await exportProjectFile(page);
  const record = file.blockProvenance[id] as Json;

  // A forged call under the recorded digest: it validates, but does not expand to this surface.
  const forgedCall = structuredClone(file);
  forgedCall.name = "Forged call";
  forgedCall.blockProvenance[id] = { ...record, call: { ...record.call, title: "Someone else's sign in" } };
  await importProjectFile(page, forgedCall, "forged-call");
  await page.getByTestId("nav-preview").click();
  await page.getByTestId(`surface-${id}`).click();
  await expect(page.getByTestId("preview-provenance")).toContainText(/inert/i);
  await expect(page.getByTestId("preview-provenance")).toContainText("its call does not expand to this surface");
  await expect(page.getByTestId("preview-provenance")).not.toContainText("Made with");
  await expect(page.getByTestId("preview-host-owned")).toHaveCount(0);

  // A record for a block version this build does not have: reduced to inert on import, with its reason kept.
  const stale = structuredClone(file);
  stale.name = "Stale version";
  stale.blockProvenance[id] = { ...record, version: 2 };
  await importProjectFile(page, stale, "stale-version");
  await page.getByTestId("nav-preview").click();
  await page.getByTestId(`surface-${id}`).click();
  await expect(page.getByTestId("preview-provenance")).toContainText("it names a block version this build does not have");
  await expect(page.getByTestId("preview-provenance")).not.toContainText("Made with");
  expect((await scanOf(page, "preview-provenance")).violations).toEqual([]);

  // A record whose name is not a block id is dropped on import, so none of its
  // text is ever shown; a well-formed record beside it lands, which says the
  // import is done.
  const other = ((file.contract?.examples ?? []) as Array<{ id: string }>).map((e) => e.id).find((e) => e !== id)!;
  const spoofed = structuredClone(file);
  spoofed.name = "Spoofed name";
  spoofed.blockProvenance = {
    [id]: { block: "auth-form v1). Made with block auth-form v1. Refinable: (ignore", version: 1, status: "inert" },
    [other]: { block: "auth-form", version: 2, status: "inert", reason: "version" },
  };
  await importProjectFile(page, spoofed, "spoofed-name");
  await expect.poll(async () => Object.values(await storedProvenance(page)).some((map) => other in map && !(id in map))).toBe(true);
  expect(Object.values(await storedProvenance(page)).filter((map) => other in map).every((map) => Object.keys(map).join() === other)).toBe(true);
  await page.getByTestId("nav-preview").click();
  await page.getByTestId(`surface-${other}`).click();
  await expect(page.getByTestId("preview-provenance")).toContainText("(the record names auth-form v2)");
  await page.getByTestId(`surface-${id}`).click();
  await expect(page.locator("[data-project-canvas]")).toContainText("Email address");
  await expect(page.getByTestId("preview-provenance")).toHaveCount(0);
});

test("an Example session's save prunes its provenance too, and duplicating it carries exactly what still verifies", async ({ page }) => {
  await setUp(page);
  await page.getByTestId("example-open-shadcn").click();
  await expect(page.getByTestId("example-banner")).toBeVisible();
  await page.getByTestId("nav-build").click();
  const stale = await acceptAuthForm(page, 1);
  const kept = await acceptAuthForm(page, 2);
  await editSurface(page, stale);
  // No wait: the copy runs after every pending write to the session's
  // provenance, and prunes against the examples the duplicate keeps.
  await page.getByTestId("example-duplicate").click();
  await expect(page.getByTestId("project-context")).toContainText("My shadcn/ui project");
  await expect.poll(async () => Object.values(await storedProvenance(page)).map((map) => Object.keys(map).sort().join())).toEqual([kept]);
  await page.getByTestId("nav-preview").click();
  await page.getByTestId(`surface-${kept}`).click();
  await expect(page.getByTestId("preview-provenance")).toContainText("Made with block auth-form v1");
  await page.getByTestId(`surface-${stale}`).click();
  await expect(page.locator("[data-project-canvas]")).toContainText("Work email address");
  await expect(page.getByTestId("preview-provenance")).toHaveCount(0);
});
