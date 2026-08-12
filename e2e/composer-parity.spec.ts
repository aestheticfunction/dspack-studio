import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { connect, demoProject } from "./support/agent-project";
import { authorSurface } from "./support/composer-browser";

/**
 * Browser/agent parity, at the PRODUCT level.
 *
 * The emit seam is already asserted equivalent in unit tests on both sides.
 * This is the thing a person can actually feel: author one surface, and the
 * gates must reach the same verdict with the same words whether the project
 * lives in a repository on disk (the agent writes it) or in the browser (the
 * hosted experience owns it).
 *
 * The two projects are made identical the honest way — the repository project
 * is EXPORTED and imported back as a browser project, so both carry byte-equal
 * vocabulary rather than two hand-kept copies.
 *
 * Scope note: the comparison is SURFACE-scoped on purpose. A connected
 * repository additionally emits its `surfacesDir`, which a browser project has
 * no access to; that documented corpus asymmetry (validation.ts) means the two
 * findings TABLES are legitimately different sizes. What must not differ is the
 * verdict on the same authored surface, and that is what is compared here.
 */

/** Violates both of the demo contract's rules: an action-button with no label,
 *  and a status-report surface with no info-card. */
const DRAFT = { id: "parity-check", intent: "status-report", title: "Parity check", component: "action-button" } as const;

/**
 * Repair the draft into something both the rules AND the emitter accept: an
 * info-card (the intent requires one) wrapping a labelled action-button (the
 * card needs a child, the button needs its label). Identical keystrokes in both
 * projects — that is the whole point.
 */
async function repairDraft(page: import("@playwright/test").Page): Promise<void> {
  await page.getByTestId("node-component-0").selectOption("info-card");
  await page.getByTestId("add-child-0").click();
  await page.getByTestId("node-text-1").fill("Acknowledge");
  await page.getByTestId("node-prop-label").fill("Acknowledge");
}

/** Read the live gate panel as the person sees it: findings text, or "clean". */
async function gateVerdict(page: import("@playwright/test").Page): Promise<string> {
  const clean = page.getByTestId("lint-clean");
  if (await clean.count()) return `CLEAN: ${(await clean.innerText()).trim()}`;
  return (await page.getByTestId("lint-findings").innerText()).trim();
}

/**
 * Every Checks row that names one surface, with the id normalized out so two
 * differently-named copies of the SAME surface compare directly. Fidelity notes
 * count: they are findings about how this surface projects onto A2UI, and they
 * must not depend on which door the project came through.
 */
async function surfaceFindings(page: import("@playwright/test").Page, id: string): Promise<string[]> {
  const rows = page.locator('[data-testid^="finding-"]').filter({ hasText: id });
  const texts = await rows.allInnerTexts();
  return texts.map((t) => t.split(id).join("<surface>").replace(/\s+/g, " ").trim()).sort();
}

test("the same authored surface gets the same gate verdict and findings in a repository project and a browser project", async ({
  page,
}) => {
  const project = demoProject();
  await connect(page, project.root);

  /* ---------- repository project (the agent writes the file) ---------- */

  await page.getByTestId("nav-surfaces").click();
  await authorSurface(page, DRAFT);
  const refusedInRepo = await gateVerdict(page);
  expect(refusedInRepo).toContain("info-card");
  expect(refusedInRepo).toContain("label");
  await expect(page.getByTestId("save-scenario")).toBeDisabled();

  // Fix it in place — the same editor, the same live gates, and the emitter
  // accepting it too (the gates panel covers S1–S3; the preview panel is where
  // an emit refusal shows, and a genuinely clean surface has neither).
  await repairDraft(page);
  const cleanInRepo = await gateVerdict(page);
  expect(cleanInRepo).toContain("CLEAN");
  await expect(page.getByTestId("preview-refused")).toHaveCount(0);
  await expect(page.getByTestId("scenario-preview")).toBeVisible();
  await page.getByTestId("save-scenario").click();
  await expect(page.getByTestId("scenario-ex.parity-check")).toContainText("Parity check");

  // The agent really wrote it: the file on disk is the second witness.
  const onDisk = JSON.parse(readFileSync(project.contractPath, "utf8"));
  expect(onDisk.examples.map((e: { id: string }) => e.id)).toContain("ex.parity-check");

  await page.getByTestId("nav-validate").click();
  await page.getByTestId("run-validate").click();
  const repoStatus = await page.getByTestId("validate-status").innerText();
  expect(repoStatus).toContain("PASS");
  const repoFindings = await surfaceFindings(page, "ex.parity-check");
  expect(repoFindings.length).toBeGreaterThan(0); // a vacuous [] would prove nothing

  // Take the project with us — identity plus governed vocabulary, nothing
  // machine-specific — and become a BROWSER project with the same vocabulary.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("project-export").click()]);
  const file = (await download.path())!;

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("projects-empty")).toBeVisible();
  await page.getByTestId("import-project-input").setInputFiles(file);
  await expect(page.getByTestId("project-context")).toContainText("Imported");
  // The same project, now browser-backed: Build is ready here too, from the
  // vocabulary alone.
  await expect(page.getByTestId("build-prompt")).toBeVisible();

  /* ---------- browser project (no agent involved in the save) ---------- */

  await page.getByTestId("nav-surfaces").click();
  // The surface authored on disk travelled with the project…
  await expect(page.getByTestId("scenario-ex.parity-check")).toContainText("Parity check");

  // …and the SAME draft is judged identically here, word for word.
  await authorSurface(page, { ...DRAFT, id: "parity-check-browser" });
  expect(await gateVerdict(page)).toBe(refusedInRepo);
  await expect(page.getByTestId("save-scenario")).toBeDisabled();

  await repairDraft(page);
  expect(await gateVerdict(page)).toBe(cleanInRepo);
  await expect(page.getByTestId("preview-refused")).toHaveCount(0);
  await expect(page.getByTestId("scenario-preview")).toBeVisible();
  await page.getByTestId("save-scenario").click();
  await expect(page.getByTestId("scenario-ex.parity-check-browser")).toContainText("Parity check");

  await page.getByTestId("nav-validate").click();
  await page.getByTestId("run-validate").click();
  expect(await page.getByTestId("validate-status").innerText()).toBe(repoStatus);
  expect(await surfaceFindings(page, "ex.parity-check-browser")).toEqual(repoFindings);
});
