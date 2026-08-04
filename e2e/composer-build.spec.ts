/**
 * Build (chat-driven creation) — the Phase 3 slice, end to end against the
 * real static export + real agent + real project files, zero model calls
 * (scripted is the deterministic twin). DOM-first per the #35 lesson: every
 * requirement here is asserted on the rendered app, with the file on disk
 * as the second witness.
 */
import { expect, test, type Page } from "@playwright/test";
import { connect, demoProject, type DemoProject } from "./support/agent-project";

async function ready(page: Page): Promise<DemoProject> {
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

test("Build is disabled with the exact setup reason when readiness fails", async ({ page }) => {
  const project = demoProject();
  // Break readiness for real: strip the intents the owner authored.
  const doc = project.contract();
  doc.intents = [];
  doc.examples = [];
  doc.rules = [];
  project.writeContract(doc);
  await connect(page, project.root);

  const nav = page.getByTestId("nav-build");
  await expect(nav).toBeDisabled();
  await expect(nav).toHaveAttribute("aria-label", /no intents authored/);
  await page.getByTestId("nav-project").click();
  await expect(page.getByTestId("start-building")).toHaveCount(0);
});

test("Build unlocks when readiness passes, becomes the default view, and the home gains Start building", async ({ page }) => {
  const project = demoProject();
  await connect(page, project.root);
  // Ready project: Build-first framing auto-opens the Build view.
  await expect(page.getByTestId("nav-build")).toBeEnabled();
  await expect(page.getByTestId("build-prompt")).toBeVisible();
  await expect(page.getByTestId("build-privacy")).toContainText("nothing leaves this machine");
  await page.getByTestId("nav-project").click();
  await expect(page.getByTestId("start-building")).toBeVisible();
  await page.getByTestId("start-building").click();
  await expect(page.getByTestId("build-prompt")).toBeVisible();
});

test("a scripted run streams the pipeline: attempts, gates, a visible repair, emit, outcome, and a rendered surface", async ({ page }) => {
  const project = await ready(page);
  await runScripted(page, "a deployment status screen");

  const pipeline = page.getByTestId("build-pipeline-1");
  await expect(pipeline).toContainText("attempt 1");
  await expect(pipeline).toContainText("S2 FAIL"); // the scripted violation
  await expect(pipeline).toContainText("repair sent"); // the visible repair turn
  await expect(pipeline).toContainText("attempt 2");
  await expect(pipeline).toContainText("S3 PASS");
  await expect(page.getByTestId("build-outcome-1")).toContainText("passed");
  // The surface renders through the trusted registry (wireframe for the demo).
  await expect(page.getByTestId("build-canvas-1")).toContainText("Deployment status");
  expect(project.contract().examples).toHaveLength(1); // nothing saved yet
});

test("Refine sends the prior surface and the refined result visibly differs; unresolved turns persist in the thread", async ({ page }) => {
  await ready(page);
  await runScripted(page, "a deployment status screen");
  await expect(page.getByTestId("build-canvas-1")).toContainText("Deployment status");

  await page.getByTestId("build-prompt").fill("make the title clearer");
  await page.getByTestId("build-refine").click();
  await expect(page.getByTestId("build-status")).toContainText(/latest outcome/, { timeout: 30_000 });

  // The refined surface differs in the deterministic, requested way…
  await expect(page.getByTestId("build-canvas-2")).toContainText("Deployment status (refined)");
  // …and the prior turn remains visible for comparison and audit.
  await expect(page.getByTestId("build-canvas-1")).toBeVisible();
  await expect(page.getByTestId("build-canvas-1")).not.toContainText("(refined)");
  await expect(page.getByTestId("build-turn-2")).toContainText("refine ·");
});

test("Accept persists the worked example, survives reload, and the next run receives it (scripted plays the accepted corpus)", async ({ page }) => {
  const project = await ready(page);
  await runScripted(page, "a deployment status screen");
  await page.getByTestId("build-prompt").fill("make the title clearer");
  await page.getByTestId("build-refine").click();
  await expect(page.getByTestId("build-canvas-2")).toContainText("(refined)", { timeout: 30_000 });

  await page.getByTestId("build-accept-2").click();
  await expect(page.getByTestId("build-accepted-2")).toContainText("ex.chat-2");

  // Persisted on disk with the ledger intact.
  const doc = project.contract();
  const saved = doc.examples.find((e: any) => e.id === "ex.chat-2");
  expect(saved.intent).toBe("status-report");
  expect(JSON.stringify(saved.surface)).toContain("(refined)");
  expect(doc.metadata["x-bootstrap"]).toBeDefined();

  // Survives a full reload + reconnect.
  await page.reload();
  await connect(page, project.root);
  await page.getByTestId("nav-scenarios").click();
  await expect(page.locator("body")).toContainText("ex.chat-2");

  // Few-shot round-trip, user-visible: a fresh scripted run now converges on
  // the LATEST accepted example — the accepted result feeds the next run.
  await page.getByTestId("nav-build").click();
  await runScripted(page, "the status screen again");
  await expect(page.getByTestId("build-canvas-1")).toContainText("(refined)");
});

test("an ask beyond the approved vocabulary is a named gap, never silently invented", async ({ page }) => {
  const project = await ready(page);
  // Make the scripted violation stand: cut the repair budget by deleting the
  // worked example AFTER connect? No — drive the real thing: a surface with
  // an unapproved component comes from the scripted first attempt; the gap
  // panel appears when the FINAL attempt still fails S2. Force that by
  // asking under an intent whose example we sabotage on disk first.
  const doc = project.contract();
  const example = doc.examples[0];
  example.surface.root.children[0].component = "not-a-component"; // corpus now violates
  project.writeContract(doc);
  await page.getByTestId("nav-project").click();
  await page.getByTestId("nav-build").click();

  await page.getByTestId("build-prompt").fill("a screen needing something unapproved");
  await page.getByTestId("build-run").click();
  await expect(page.getByTestId("build-status")).toContainText(/latest outcome/, { timeout: 30_000 });
  await expect(page.getByTestId("build-outcome-1")).toContainText("failed");
  const gap = page.getByTestId("build-gap-1");
  await expect(gap).toContainText("not-a-component");
  await expect(gap).toContainText(/never invents components/i);
  await expect(page.getByTestId("build-accept-1")).toHaveCount(0); // nothing acceptable
});

test("invalid output cannot be accepted through direct route invocation (server-side fail-closed)", async ({ page }) => {
  const project = await ready(page);
  const bad = structuredClone(project.contract().examples[0].surface);
  bad.root.children[0].component = "not-a-component";
  const status = await page.evaluate(
    async ([root, surface]) => {
      const res = await fetch("http://localhost:8787/project/save-example", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: root, example: { id: "ex.smuggled", intent: "status-report", prompt: "p", surface } }),
      });
      return res.status;
    },
    [project.root, bad] as const,
  );
  expect(status).toBe(422);
  expect(project.contract().examples.some((e: any) => e.id === "ex.smuggled")).toBe(false);
});

test("double submission and double acceptance are locked", async ({ page }) => {
  const project = await ready(page);
  await page.getByTestId("build-prompt").fill("a deployment status screen");
  const run = page.getByTestId("build-run");
  await run.click();
  await expect(run).toBeDisabled(); // streaming locks submission
  await expect(page.getByTestId("build-refine")).toBeDisabled();
  await expect(page.getByTestId("build-status")).toContainText(/latest outcome/, { timeout: 30_000 });
  await expect(page.getByTestId("build-turn-2")).toHaveCount(0); // one turn, not two

  // Accept locks itself while the save round-trips.
  await page.route("**/project/save-example", async (route) => {
    await new Promise((r) => setTimeout(r, 400));
    await route.continue();
  });
  const accept = page.getByTestId("build-accept-1");
  await accept.dispatchEvent("click");
  await expect(accept).toBeDisabled();
  await accept.dispatchEvent("click").catch(() => undefined);
  await expect(page.getByTestId("build-accepted-1")).toBeVisible();
  const doc = project.contract();
  expect(doc.examples.filter((e: any) => e.id === "ex.chat-1")).toHaveLength(1); // exactly once
});
