/**
 * Build (chat-driven creation) — the Phase 3 slice, end to end against the
 * real static export + real agent + real project files, zero model calls
 * (scripted is the deterministic twin). DOM-first per the #35 lesson: every
 * requirement here is asserted on the rendered app, with the file on disk
 * as the second witness.
 */
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { connect, demoProject, type DemoProject } from "./support/agent-project";

async function ready(page: Page): Promise<DemoProject> {
  const project = demoProject();
  await connect(page, project.root);
  await expect(page.getByTestId("nav-build")).toBeEnabled();
  await page.getByTestId("nav-build").click();
  // Wait for the Build surface itself: readiness is derived from the live
  // browser emit, so the view can briefly render its not-ready panel. If it
  // never opens, report WHY rather than timing out on a missing locator.
  const prompt = page.getByTestId("build-prompt");
  const notReady = page.getByTestId("build-not-ready");
  const needsAgent = page.getByTestId("build-needs-agent");
  await expect
    .poll(async () => {
      if (await prompt.count()) return "ready";
      if (await notReady.count()) return `not ready: ${await notReady.innerText()}`;
      if (await needsAgent.count()) return "needs agent (demo mode)";
      return "no build panel rendered";
    }, { timeout: 20_000 })
    .toBe("ready");
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
  await page.getByTestId("nav-repository").click();
  await expect(page.getByTestId("start-building")).toHaveCount(0);
});

test("Build unlocks when readiness passes, becomes the default view, and the home gains Start building", async ({ page }) => {
  const project = demoProject();
  await connect(page, project.root);
  // Ready project: Build-first framing auto-opens the Build view.
  await expect(page.getByTestId("nav-build")).toBeEnabled();
  await expect(page.getByTestId("build-prompt")).toBeVisible();
  await expect(page.getByTestId("build-privacy")).toContainText("nothing leaves this machine");
  await page.getByTestId("nav-repository").click();
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
  await expect(page.getByTestId("build-accepted-2")).toContainText(/ex\.chat-\d+/);

  // Persisted on disk with the ledger intact.
  const doc = project.contract();
  const saved = doc.examples.find((e: any) => /^ex\.chat-\d+$/.test(e.id));
  expect(saved.intent).toBe("status-report");
  // Truthful provenance: the ORIGINAL ask leads, the refinement is recorded.
  expect(saved.prompt).toBe("a deployment status screen — refined: make the title clearer");
  expect(JSON.stringify(saved.surface)).toContain("(refined)");
  expect(doc.metadata["x-bootstrap"]).toBeDefined();

  // Survives a full reload + reconnect.
  await page.reload();
  await connect(page, project.root);
  await page.getByTestId("nav-scenarios").click();
  await expect(page.locator("body")).toContainText(saved.id);

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
  await page.getByTestId("nav-repository").click();
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
  expect(doc.examples.filter((e: any) => /^ex\.chat-\d+$/.test(e.id))).toHaveLength(1); // exactly once
});


test("an S3 governance failure shows the exact rule and the owner's rationale (#41)", async ({ page }) => {
  const project = demoProject();
  // A governed violation the contract's OWN rule catches: the demo's rule
  // set is authored, so we drive the corpus into violating it.
  const doc = project.contract();
  // A GOVERNANCE-only violation (rule.status-report.info-card-required,
  // severity must, with the owner's authored rationale): a status-report
  // surface whose root is not the required InfoCard. Emit stays clean, so
  // Build remains open — S3 is what rejects it.
  const rule = doc.rules.find((r: any) => r.id === "rule.status-report.info-card-required");
  expect(rule?.rationale, "the demo contract must ship an authored rationale").toBeTruthy();
  doc.examples[0].surface = {
    dspackSurface: "0.1",
    system: doc.name,
    intent: "status-report",
    root: { component: "note-field", id: "notes", props: { label: "Operator notes", resizable: true } },
  };
  project.writeContract(doc);
  await connect(page, project.root);
  await expect(page.getByTestId("nav-build")).toBeEnabled();
  await page.getByTestId("nav-build").click();
  await expect(page.getByTestId("build-prompt")).toBeVisible();
  await page.getByTestId("build-prompt").fill("a status screen");
  await page.getByTestId("build-run").click();
  await expect(page.getByTestId("build-outcome-1")).toContainText("failed", { timeout: 30_000 });

  const failure = page.getByTestId("build-failure-1");
  await expect(failure).toBeVisible();
  await expect(failure).toContainText("stopped at");
  // The exact rule id, its message, and the OWNER'S rationale, verbatim.
  await expect(failure).toContainText("rule.status-report.info-card-required");
  await expect(page.getByTestId("build-rationale-1")).toContainText(rule.rationale);
  // The full report stays available for inspection.
  await expect(failure.getByText("full audit report")).toBeVisible();
  // Neither action is offered for a turn without a valid surface.
  await expect(page.getByTestId("build-accept-1")).toHaveCount(0);
  await expect(page.getByTestId("build-refine")).toBeDisabled();
});

test("an emit refusal shows the emitter's verbatim evidence, not a bare failed-gate (#41)", async ({ page }) => {
  const project = await ready(page);
  // The demo's authored casualty: a surface using it is lint-clean but the
  // emitter refuses it with its written reason.
  const doc = project.contract();
  const casualty = JSON.parse(readFileSync(`${project.root}/surfaces/uses-casualty.dsurface.json`, "utf8"));
  doc.examples[0].surface = casualty;
  project.writeContract(doc);
  await page.getByTestId("build-prompt").fill("a screen using the casualty");
  await page.getByTestId("build-run").click();
  await expect(page.getByTestId("build-outcome-1")).toContainText("failed-gate", { timeout: 30_000 });

  const failure = page.getByTestId("build-failure-1");
  await expect(failure).toContainText(/declared casualty/i);
  await expect(failure).toContainText(/steps is an array prop/); // the authored reason, verbatim
  await expect(page.getByTestId("build-accept-1")).toHaveCount(0);
});

test("an adapter failure explains itself actionably (#41)", async ({ page }) => {
  const project = demoProject();
  await connect(page, project.root);
  await page.getByTestId("nav-build").click();
  // Select a model ref the agent will try to reach and fail on.
  await page.getByTestId("build-model").selectOption({ index: 0 }).catch(() => undefined);
  await page.evaluate(() => {
    const select = document.querySelector('[data-testid="build-model"]') as HTMLSelectElement;
    const option = document.createElement("option");
    option.value = "ollama:definitely-not-a-model";
    option.textContent = "ollama:definitely-not-a-model";
    select.appendChild(option);
    select.value = "ollama:definitely-not-a-model";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.getByTestId("build-prompt").fill("anything");
  await page.getByTestId("build-run").click();
  await expect(page.getByTestId("build-failure-1")).toBeVisible({ timeout: 60_000 });
  const failure = page.getByTestId("build-failure-1");
  await expect(failure).toContainText(/model provider|stream ended/i);
  const text = await failure.innerText();
  expect(text).not.toMatch(/^outcome: failed-adapter$/m);
});

test("a refused Accept renders the agent's findings, not an HTTP status (#41)", async ({ page }) => {
  const project = await ready(page);
  await runScripted(page, "a deployment status screen");
  // Sabotage the corpus AFTER generating: the accept gate re-lints and refuses.
  const doc = project.contract();
  doc.components["not-approved-anymore"] = undefined;
  delete doc.components["tag-pill"]; // the generated surface now references unknown vocabulary
  project.writeContract(doc);

  await page.getByTestId("build-accept-1").click();
  const findings = page.getByTestId("build-accept-findings-1");
  await expect(findings).toBeVisible();
  await expect(findings).toContainText(/S2|S1|document/);
  await expect(page.getByTestId("notice")).not.toContainText("agent replied");
  await expect(page.getByTestId("notice")).toContainText(/refused/i);
});

test("two accepts across a reload mint distinct ids and preserve both examples (#42)", async ({ page }) => {
  const project = await ready(page);
  const before = project.contract().examples.map((e: any) => e.id);
  await runScripted(page, "a deployment status screen");
  await page.getByTestId("build-accept-1").click();
  await expect(page.getByTestId("build-accepted-1")).toBeVisible();
  const first = project.contract().examples.at(-1).id;

  // A reload resets every page-local counter — identity must not depend on it.
  await page.reload();
  await connect(page, project.root);
  await page.getByTestId("nav-build").click();
  await runScripted(page, "another status screen");
  await page.getByTestId("build-accept-1").click();
  await expect(page.getByTestId("build-accepted-1")).toBeVisible();

  const ids = project.contract().examples.map((e: any) => e.id);
  const second = ids.at(-1);
  expect(second).not.toBe(first);
  expect(ids).toEqual(expect.arrayContaining([...before, first, second]));
  expect(new Set(ids).size).toBe(ids.length); // no duplicates
});

test("an explicit id collision is refused, never an overwrite (#42)", async ({ page }) => {
  const project = await ready(page);
  const existing = project.contract().examples[0];
  const before = JSON.stringify(existing);
  await runScripted(page, "a deployment status screen");
  await page.getByTestId("build-example-id-1").fill(existing.id);
  await page.getByTestId("build-accept-1").click();

  await expect(page.getByTestId("build-accept-findings-1")).toContainText(existing.id);
  await expect(page.getByTestId("build-accepted-1")).toHaveCount(0);
  expect(JSON.stringify(project.contract().examples[0])).toBe(before); // byte-identical
});

test("an intent with no example cannot borrow another intent's (#43)", async ({ page }) => {
  const project = await ready(page);
  const doc = project.contract();
  doc.intents = [...doc.intents, { id: "onboarding", description: "Welcome a new operator." }];
  project.writeContract(doc);
  // Reconnect so the view sees the new intent, then force it via the advanced
  // governance-context override (goal-first infers by default; catalog authors
  // can pin a context). 'onboarding' has no worked example.
  await connect(page, project.root);
  await page.getByTestId("nav-build").click();
  await page.getByTestId("build-intent").selectOption("onboarding");

  await page.getByTestId("build-prompt").fill("an onboarding screen");
  await page.getByTestId("build-run").click();
  await expect(page.getByTestId("build-status")).toContainText(/latest outcome|turn/, { timeout: 30_000 });
  // Honest refusal, and nothing from the other intent was rendered.
  await expect(page.getByTestId("build-canvas-1")).toHaveCount(0);
  await expect(page.locator("body")).toContainText(/worked example/i);
});

test("two consecutive refinements each use the immediately prior surface, non-vacuously (#43)", async ({ page }) => {
  const project = await ready(page);
  await runScripted(page, "a deployment status screen");
  const first = await page.getByTestId("build-canvas-1").innerText();

  await page.getByTestId("build-prompt").fill("make the title clearer");
  await page.getByTestId("build-refine").click();
  await expect(page.getByTestId("build-canvas-2")).toBeVisible({ timeout: 30_000 });
  const second = await page.getByTestId("build-canvas-2").innerText();

  await page.getByTestId("build-prompt").fill("and say it once more");
  await page.getByTestId("build-refine").click();
  await expect(page.getByTestId("build-canvas-3")).toBeVisible({ timeout: 30_000 });
  const third = await page.getByTestId("build-canvas-3").innerText();

  // Turn 3 built on turn 2 — and is NOT a byte-identical no-op reported as success.
  expect(second).not.toBe(first);
  expect(third, "the second refinement must not be a silent no-op").not.toBe(second);
  await expect(page.getByTestId("build-outcome-3")).toContainText("passed");
  // All three remain in the thread for comparison and audit.
  await expect(page.getByTestId("build-canvas-1")).toBeVisible();
});

test("with the agent up, a chosen Hosted survives and stays selectable alongside a local model (adoption follow-up #1)", async ({ page }) => {
  // Regression: once the agent became reachable, buildModels was set to the
  // AGENT's list ALONE, so "hosted-ai" — advertised only by the deployed ORIGIN
  // via /api/models — dropped out. Settings read "Unavailable", Build's provider
  // switch lost it, and the auto-select effect then clobbered a deliberately
  // chosen Hosted down to scripted. The fix UNIONS the origin's answer with the
  // agent's (regardless of agent state) and refuses to correct against the
  // pre-fetch placeholder. The static export ships no /api/models route, so
  // stand in for a deployed origin that offers hosted; seed a configured local
  // provider so a local model is present without a live Ollama (the "configured
  // local providers" path), with Hosted as the deliberately-active choice.
  await page.route("**/api/models", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ models: ["scripted", "hosted-ai"] }),
    }),
  );
  await page.addInitScript(() => {
    localStorage.setItem(
      "composer.providers.v1",
      JSON.stringify({
        ollama: { baseUrl: "http://localhost:11434", model: "llama3.1" },
        openai: null,
        active: "hosted-ai",
      }),
    );
  });

  // A hosted/reference project (mode = demo) with the local agent genuinely
  // running beside it — the exact "hosted demo, agent detected" situation.
  await page.goto("/");
  await page.getByTestId("nav-projects").click();
  await page.getByTestId("new-project-name").fill("Provider coexistence");
  await page.getByTestId("new-source-shadcn").click();
  await page.getByTestId("new-project-create").click();
  await expect(page.getByTestId("build-prompt")).toBeVisible();

  // Settings: the agent is connected AND Hosted still reads Available, remains
  // the active choice (never clobbered), and its control is live.
  await page.getByTestId("nav-settings").click();
  await expect(page.getByTestId("agent-status")).toContainText("Agent connected");
  await expect(page.getByTestId("hosted-availability")).toHaveText("Available");
  const useHosted = page.getByTestId("provider-use-hosted");
  await expect(useHosted).toBeEnabled();
  await expect(useHosted).toHaveText("In use"); // the deliberate Hosted choice survived the agent coming up
  await expect(page.getByTestId("active-provider")).toContainText("Hosted");

  // Build: both Hosted and the configured local model are offered in the one
  // provider switch, and each actually selects.
  await page.getByTestId("nav-build").click();
  const values = await page
    .locator('[data-testid="build-model"]')
    .evaluate((sel) => Array.from((sel as HTMLSelectElement).options).map((o) => o.value));
  expect(values).toContain("hosted-ai");
  expect(values).toContain("ollama:llama3.1");
  expect(values).toContain("scripted");

  await page.getByTestId("build-model").selectOption("ollama:llama3.1");
  await expect(page.getByTestId("build-model")).toHaveValue("ollama:llama3.1");
  await page.getByTestId("build-model").selectOption("hosted-ai");
  await expect(page.getByTestId("build-model")).toHaveValue("hosted-ai");
});
