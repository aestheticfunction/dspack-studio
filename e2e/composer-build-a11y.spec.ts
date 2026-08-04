/**
 * Accessibility of the Build surface (Phase 3): streaming must be announced,
 * the decision controls must carry unambiguous names, keyboard and focus
 * must work, and axe must pass in pending, failed, successful, and
 * refinement states. Automation is the floor; the manual pass stays in the
 * release checklist.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { connect, demoProject } from "./support/agent-project";

const scan = (page: Page) =>
  new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).disableRules(["region"]).analyze();

async function ready(page: Page) {
  const project = demoProject();
  await connect(page, project.root);
  await expect(page.getByTestId("nav-build")).toBeEnabled();
  await page.getByTestId("nav-build").click();
  return project;
}

async function runScripted(page: Page, prompt: string) {
  await page.getByTestId("build-prompt").fill(prompt);
  await page.getByTestId("build-run").click();
  await expect(page.getByTestId("build-status")).toContainText(/latest outcome/, { timeout: 30_000 });
}

test("stream status is a live region and announces progress and settlement", async ({ page }) => {
  await ready(page);
  const status = page.getByTestId("build-status");
  await expect(status).toHaveAttribute("role", "status");
  await expect(status).toHaveAttribute("aria-live", "polite");
  await runScripted(page, "a deployment status screen");
  await expect(status).toContainText("latest outcome: passed");
});

test("Build, Refine, and Accept carry unambiguous accessible names; keyboard operates the flow", async ({ page }) => {
  await ready(page);
  await expect(page.getByRole("button", { name: "Build a new surface from this ask" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refine the previous surface with this ask" })).toBeVisible();

  // Keyboard: type the ask, Enter submits.
  await page.getByTestId("build-prompt").focus();
  await page.keyboard.type("a deployment status screen");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("build-status")).toContainText(/latest outcome/, { timeout: 30_000 });

  const accept = page.getByRole("button", { name: /Accept turn 1 as worked example ex\.chat-1/ });
  await expect(accept).toBeVisible();
  await accept.focus();
  await expect(accept).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("build-accepted-1")).toBeVisible();
  const active = await page.evaluate(() => document.activeElement?.tagName.toLowerCase() ?? "");
  expect(active, "focus fell to body after Accept").not.toBe("body");
});

test("axe: pending (disabled Build), streaming-settled success, failure, and refinement states", async ({ page }) => {
  // Failure + gap state: ready at connect, corpus sabotaged on disk AFTER
  // entering Build (a corpus that breaks gates rightfully disables Build).
  const broken = demoProject();
  await connect(page, broken.root);
  await page.getByTestId("nav-build").click();
  const doc = broken.contract();
  doc.examples[0].surface.root.children[0].component = "not-a-component";
  broken.writeContract(doc);
  await page.getByTestId("build-prompt").fill("anything");
  await page.getByTestId("build-run").click();
  await expect(page.getByTestId("build-gap-1")).toBeVisible({ timeout: 30_000 });
  expect((await scan(page)).violations, "failed state").toEqual([]);

  // Not-ready (disabled nav) state.
  const notReady = demoProject();
  const d2 = notReady.contract();
  d2.intents = [];
  d2.examples = [];
  d2.rules = [];
  notReady.writeContract(d2);
  await page.reload();
  await connect(page, notReady.root);
  await expect(page.getByTestId("nav-build")).toBeDisabled();
  expect((await scan(page)).violations, "not-ready state").toEqual([]);

  // Success + refinement states.
  const project = demoProject();
  await page.reload();
  await connect(page, project.root);
  await page.getByTestId("nav-build").click();
  await runScripted(page, "a deployment status screen");
  expect((await scan(page)).violations, "success state").toEqual([]);
  await page.getByTestId("build-prompt").fill("make the title clearer");
  await page.getByTestId("build-refine").click();
  await expect(page.getByTestId("build-canvas-2")).toContainText("(refined)", { timeout: 30_000 });
  expect((await scan(page)).violations, "refinement state").toEqual([]);
});
