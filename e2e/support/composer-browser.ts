/**
 * Shared moves for the AGENT-FREE composer suites (playwright.composer-smoke
 * config, project "composer-product"): the hosted experience a first-time
 * visitor gets — the real static export, no agent, the scripted provider.
 *
 * Every helper drives the product the way a person does (hub → source →
 * create), never by seeding storage: the point of these suites is that the
 * paths a new team takes first actually work, so the setup has to be one of
 * those paths too.
 *
 * No helper here makes a model call. `scriptedBuild` pins the provider to
 * "scripted" before every run — the deterministic replay adapter — so the
 * suites stay CI-safe and repeatable by construction.
 *
 * `authorSurface` is the one MODE-NEUTRAL helper here: the surface editor is
 * the same view in a browser project and a connected repository, which is
 * exactly what composer-parity.spec.ts relies on.
 */
import { expect, type Page } from "@playwright/test";

/** Start a fresh project from a governed reference and land in Build. */
export async function newProject(page: Page, source: "shadcn" | "astryx", name: string): Promise<void> {
  await page.getByTestId("nav-projects").click();
  await page.getByTestId("new-project-name").fill(name);
  await page.getByTestId(`new-source-${source}`).click();
  await page.getByTestId("new-project-create").click();
  await expect(page.getByTestId("build-prompt")).toBeVisible();
  await expect(page.getByTestId("project-context")).toContainText(name);
}

/**
 * One deterministic scripted build, waited on by its OUTCOME rather than a
 * timer. `turn` is the 1-based turn number the run will produce (the thread
 * numbers turns in order), so a caller building twice waits on the right one.
 */
export async function scriptedBuild(page: Page, intent: string, goal: string, turn = 1): Promise<void> {
  await page.getByTestId("build-model").selectOption("scripted");
  await page.getByTestId("build-intent").selectOption(intent);
  await page.getByTestId("build-prompt").fill(goal);
  await page.getByTestId("build-run").click();
  await expect(page.getByTestId(`build-gate-summary-${turn}`)).toContainText("Follows your design-system rules", { timeout: 30_000 });
}

/** Build one surface and accept it into the project, returning its minted id. */
export async function buildAndAccept(page: Page, intent: string, goal: string, turn = 1): Promise<string> {
  await scriptedBuild(page, intent, goal, turn);
  await page.getByTestId(`build-accept-${turn}`).click();
  const accepted = page.getByTestId(`build-accepted-${turn}`);
  await expect(accepted).toContainText(/ex\.chat-\d+/);
  return (await accepted.innerText()).match(/ex\.chat-\d+/)![0];
}

/**
 * Open the surface editor on a NEW surface and fill it in. The root node is a
 * single component — enough to exercise the vocabulary constraint, the live
 * gates, and the live preview, which is what these specs are about.
 */
export async function authorSurface(
  page: Page,
  fields: { id: string; intent: string; title?: string; prompt?: string; component: string; text?: string },
): Promise<void> {
  await page.getByTestId("new-scenario").click();
  await page.getByTestId("scenario-id").fill(fields.id);
  await page.getByTestId("scenario-intent").selectOption(fields.intent);
  if (fields.title !== undefined) await page.getByLabel("Surface title").fill(fields.title);
  if (fields.prompt !== undefined) await page.getByTestId("scenario-prompt").fill(fields.prompt);
  await page.getByTestId("node-component-0").selectOption(fields.component);
  if (fields.text !== undefined) await page.getByTestId("node-text-0").fill(fields.text);
}
