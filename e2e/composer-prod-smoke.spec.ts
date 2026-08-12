import { test, expect, type Page } from "@playwright/test";

/**
 * Hosted/demo smoke for the Composer product (served from the static export).
 *
 * Exercises the product a first-time visitor actually meets: the Projects hub,
 * creating a named project from a governed design system, the goal-first Build
 * (scripted, deterministic — no model calls in CI), design-system neutrality
 * across shadcn and Astryx, the provider Settings, and client hygiene (no
 * private hosts, local paths, or key material in any response body).
 *
 * Everything runs in-browser against the shipped references; the only network
 * call is the static assets. `/api/*` and the local agent are absent here, so
 * the model list is scripted-only and hosted-ai/agent are exercised live
 * post-deploy.
 */

/** Start a fresh project from a governed reference and land in Build. */
async function newProject(page: Page, source: "shadcn" | "astryx", name: string) {
  await page.getByTestId("nav-projects").click();
  await page.getByTestId("new-project-name").fill(name);
  await page.getByTestId(`new-source-${source}`).click();
  await page.getByTestId("new-project-create").click();
  await expect(page.getByTestId("build-prompt")).toBeVisible();
  await expect(page.getByTestId("project-context")).toContainText(name);
}

/** A deterministic scripted build for an intent that has a worked example. */
async function scriptedBuild(page: Page, intent: string, goal: string) {
  await page.getByTestId("build-model").selectOption("scripted");
  await page.getByTestId("build-intent").selectOption(intent);
  await page.getByTestId("build-prompt").fill(goal);
  await page.getByTestId("build-run").click();
  await expect(page.getByTestId("build-gate-summary-1")).toContainText("Follows your design-system rules", { timeout: 30_000 });
}

test("first run is the Projects hub, and it loads clean", async ({ page }) => {
  const consoleErrors: string[] = [];
  const failed: string[] = [];
  const expected = (s: string) => /\/api\/models|localhost:8787|ERR_CONNECTION_REFUSED|favicon/.test(s);
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("requestfailed", (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on("response", (r) => r.status() >= 400 && failed.push(`${r.url()} ${r.status()}`));

  await page.goto("/");
  // Editorial masthead + the new-project affordance — a welcome, not an error.
  await expect(page.getByTestId("new-project")).toBeVisible();
  await expect(page.getByTestId("new-source-shadcn")).toBeVisible();
  await expect(page.getByTestId("new-source-astryx")).toBeVisible();
  await expect(page.getByTestId("projects-empty")).toBeVisible();

  expect(consoleErrors.filter((e) => !expected(e))).toEqual([]);
  expect(failed.filter((f) => !expected(f))).toEqual([]);
});

test("create a named project from shadcn, then goal-first BUILD renders a governed surface", async ({ page }) => {
  await page.goto("/");
  await newProject(page, "shadcn", "Billing settings");

  // The governed context is INFERRED — the front door is a goal, not a taxonomy.
  await expect(page.getByTestId("build-intent")).toHaveValue("");
  await scriptedBuild(page, "destructive-action", "let people permanently delete their account");

  // Governance translated to plain outcomes.
  const summary = page.getByTestId("build-gate-summary-1");
  await expect(summary).toContainText("Uses only approved components");
  // The surface renders natively (shadcn) and the rigorous evidence stays one expander away.
  await expect(page.getByTestId("build-canvas-1")).toContainText(/delete/i);
  await expect(page.getByTestId("build-pipeline-1")).toContainText("outcome: passed");
});

test("the saved project appears on the hub and reopens", async ({ page }) => {
  await page.goto("/");
  await newProject(page, "shadcn", "Reopen me");
  await page.getByTestId("nav-projects").click();
  await expect(page.getByTestId("projects-grid")).toContainText("Reopen me");
  // A reload restores the last-opened project straight into Build.
  await page.reload();
  await expect(page.getByTestId("build-prompt")).toBeVisible();
  await expect(page.getByTestId("project-context")).toContainText("Reopen me");
});

test("a project exports to a portable file and imports back, ready to keep building", async ({ page }) => {
  await page.goto("/");
  await newProject(page, "shadcn", "Portable project");

  // Export the open project — capture the download and confirm it's the
  // dedicated project artifact, not a catalog.
  await page.getByTestId("nav-projects").click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('[data-testid^="project-export-"]').first().click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.composerproject\.json$/);
  const file = await download.path();

  // Import the same file: a NEW project is created and opens straight into Build.
  await page.getByTestId("import-project-input").setInputFiles(file!);
  await expect(page.getByTestId("build-prompt")).toBeVisible();
  await expect(page.getByTestId("project-context")).toContainText("Portable project");

  // Continue working: a governed build runs on the imported vocabulary.
  await scriptedBuild(page, "destructive-action", "let people delete their account");
  await expect(page.getByTestId("build-gate-summary-1")).toContainText("Uses only approved components");

  // The hub now shows the imported project, distinctly labelled from a reference.
  await page.getByTestId("nav-projects").click();
  await expect(page.getByTestId("projects-grid")).toContainText("Imported");
});

test("a built surface becomes first-class project content: accept → Preview default → Surfaces → reload → export", async ({ page }) => {
  await page.goto("/");
  await newProject(page, "shadcn", "Ownership");
  await scriptedBuild(page, "destructive-action", "let people permanently delete their account");

  // Accept in the BROWSER — no agent required to own browser-authored work.
  await page.getByTestId("build-accept-1").click();
  await expect(page.getByTestId("build-accepted-1")).toContainText(/ex\.chat-\d+/);

  // Preview opens on the project's OWN surface, with the reference corpus
  // clearly separated — never one anonymous list.
  await page.getByTestId("nav-preview").click();
  await expect(page.getByTestId("surface-ex.chat-1")).toBeVisible();
  await expect(page.getByTestId("surface-ex.chat-1")).toHaveClass(/st-btn--active/); // the default
  await expect(page.getByTestId("preview-reference-surfaces")).toContainText("Reference surfaces");
  await expect(page.getByTestId("preview-no-project-surfaces")).toHaveCount(0);

  // Honest wireframe fallback: a reference surface using Switch/Separator
  // renders through wireframe stand-ins under the native registry — never
  // raw [unimplemented:] text, and never a serialized props dump — and the
  // caption says so plainly.
  await page.getByTestId("registry-shadcn").click();
  await page.getByTestId("surface-ex.notification-preferences").click();
  await expect(page.getByTestId("registry-coverage")).toContainText("render as wireframe");
  await expect(page.locator('[data-project-canvas] [data-wireframe]').first()).toBeVisible();
  await expect(page.locator('[data-project-canvas]')).not.toContainText("[unimplemented:");
  await expect(page.locator("[data-project-canvas]")).not.toContainText('columns=["');

  // Surfaces: project-owned content separate from the reference corpus.
  await page.getByTestId("nav-surfaces").click();
  await expect(page.getByTestId("scenario-ex.chat-1")).toBeVisible();
  await expect(page.getByTestId("scenarios-reference")).toContainText("Reference surfaces");

  // The authored surface SURVIVES a reload (the persisted delta).
  await page.reload();
  await expect(page.getByTestId("build-prompt")).toBeVisible();
  await page.getByTestId("nav-preview").click();
  await expect(page.getByTestId("surface-ex.chat-1")).toBeVisible();

  // Export without leaving the work — and the export carries the surface.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("project-export").click()]);
  expect(download.suggestedFilename()).toMatch(/\.composerproject\.json$/);
  const fs = await import("node:fs/promises");
  const exported = await fs.readFile((await download.path())!, "utf8");
  expect(exported).toContain("ex.chat-1");
});

test("a fresh project's Preview is honest: no project surfaces yet, references labeled as references", async ({ page }) => {
  await page.goto("/");
  await newProject(page, "shadcn", "Fresh");
  await page.getByTestId("nav-preview").click();
  await expect(page.getByTestId("preview-no-project-surfaces")).toBeVisible();
  await expect(page.getByTestId("preview-reference-surfaces")).toContainText("Reference surfaces");
  // Inspecting a reference surface states what it is.
  await page.getByTestId("surface-ex.delete-account-confirmation").click();
  await expect(page.locator("body")).toContainText("teaching material, not part of your project");
});

/**
 * B5/B7/B8/C9 — the FIRST IMPRESSION, end to end. One scripted build and one
 * accept is the whole journey a newcomer takes; everything asserted here is
 * what they see immediately afterwards.
 */
test("first run: the project previews as ITSELF, the user's work leads with a human label, and Flows is one click away", async ({ page }) => {
  await page.goto("/");
  await newProject(page, "shadcn", "First impression");
  await scriptedBuild(page, "destructive-action", "let people permanently delete their account");
  await page.getByTestId("build-accept-1").click();
  await expect(page.getByTestId("build-accepted-1")).toContainText(/ex\.chat-\d+/);

  await page.getByTestId("nav-preview").click();

  // B5 — Preview opens on the project's OWN design system, not the wireframe.
  await expect(page.getByTestId("registry-shadcn")).toHaveClass(/st-btn--active/);
  await expect(page.getByTestId("registry-wireframe")).not.toHaveClass(/st-btn--active/);
  await expect(page.locator('[data-project-canvas][data-design-system="shadcn"]')).toBeVisible();

  // B8 — the user's own surface is the FIRST surface in the picker.
  const own = page.getByTestId("surface-ex.chat-1");
  await expect(page.locator('[data-testid^="surface-ex."]').first()).toHaveAttribute("data-testid", "surface-ex.chat-1");
  await expect(own).toHaveClass(/st-btn--active/);

  // B7 — it reads as what the person asked for; the canonical id stays beside
  // it as metadata, never as the headline.
  await expect(own).toContainText("let people permanently delete their account");
  await expect(own).toContainText("ex.chat-1");
  await expect(page.getByTestId("preview-your-surfaces")).toContainText("Your surfaces");

  // B8 — the three reference surfaces the emitter refuses are DEMOTED, not
  // hidden: one honest disclosure instead of three red rows at first contact.
  await expect(page.getByTestId("preview-reference-refused")).toContainText("3 reference surfaces");
  await expect(page.getByTestId("surface-refused-ex.docs-article-trail")).toBeHidden();
  await page.getByTestId("preview-reference-refused").click();
  await expect(page.getByTestId("surface-refused-ex.docs-article-trail")).toBeVisible();

  // C9 — Flows is in the primary navigation, one click from anywhere.
  await page.getByTestId("nav-flows").click();
  await expect(page.getByTestId("preview-flows")).toBeVisible();
  await expect(page.getByTestId("flows-empty")).toBeVisible();
});

test("Examples are teaching material: separate section, ephemeral read-only workspace, duplicate to keep", async ({ page }) => {
  await page.goto("/");
  // The hub separates Examples from Your projects.
  await expect(page.getByTestId("examples-section")).toBeVisible();
  await expect(page.getByTestId("example-shadcn")).toContainText("read-only");

  // Opening an example is labeled, and never becomes "your" project.
  await page.getByTestId("example-open-shadcn").click();
  await expect(page.getByTestId("example-banner")).toContainText("read-only reference");
  await expect(page.getByTestId("project-context")).toContainText("Example");
  await page.getByTestId("nav-projects").click();
  await expect(page.getByTestId("projects-empty")).toBeVisible(); // not in Your projects

  // A reload does NOT resurrect the example (no lastOpened) — the hub, honestly.
  await page.reload();
  await expect(page.getByTestId("projects-empty")).toBeVisible();
  await expect(page.getByTestId("example-banner")).toHaveCount(0);

  // Duplicate makes it yours, as a normal project.
  await page.getByTestId("example-open-shadcn").click();
  await expect(page.getByTestId("example-banner")).toBeVisible();
  await page.getByTestId("example-duplicate").click();
  await expect(page.getByTestId("project-context")).toContainText("My shadcn/ui project");
  await expect(page.getByTestId("example-banner")).toHaveCount(0);
  await page.getByTestId("nav-projects").click();
  await expect(page.getByTestId("projects-grid")).toContainText("My shadcn/ui project");
});

test("project lifecycle: rename, duplicate, switch, and remove — as first-class objects", async ({ page }) => {
  await page.goto("/");
  await newProject(page, "shadcn", "Lifecycle");
  await page.getByTestId("nav-projects").click();
  const grid = page.getByTestId("projects-grid");

  // Target every action by the project's exact id, read from its card.
  const firstCard = grid.locator(".af-card").first();
  await expect(firstCard).toContainText(/shadcn/i); // a user project shows its governed source
  const id = (await firstCard.getAttribute("data-testid"))!.replace("project-", "");

  // Rename
  await page.getByTestId(`project-rename-${id}`).click();
  await page.getByTestId(`project-rename-input-${id}`).fill("Lifecycle renamed");
  await page.getByTestId(`project-rename-input-${id}`).press("Enter");
  await expect(grid).toContainText("Lifecycle renamed");

  // Duplicate
  await page.getByTestId(`project-duplicate-${id}`).click();
  await expect(grid).toContainText("Lifecycle renamed copy");

  // Switch into the original, confirm it's active, return to the hub
  await page.getByTestId(`project-build-${id}`).click();
  await expect(page.getByTestId("project-context")).toContainText("Lifecycle renamed");
  await page.getByTestId("nav-projects").click();

  // Remove the duplicate (two-step confirm), original survives
  const copyId = (await grid.locator(".af-card").filter({ hasText: "Lifecycle renamed copy" }).first().getAttribute("data-testid"))!.replace(
    "project-",
    "",
  );
  await page.getByTestId(`project-delete-${copyId}`).click();
  await page.getByTestId(`project-delete-confirm-${copyId}`).click();
  await expect(grid).not.toContainText("Lifecycle renamed copy");
  await expect(grid).toContainText("Lifecycle renamed");
});

test("design-system neutrality: Astryx traverses the SAME product with its own vocabulary", async ({ page }) => {
  await page.goto("/");
  await newProject(page, "astryx", "Scheduling");
  // Astryx's own governed intents drive the planner, not shadcn's.
  await expect(page.getByTestId("build-intent")).toContainText("scheduling");
  await scriptedBuild(page, "destructive-action", "a confirmation for deleting a project");
  await expect(page.getByTestId("build-canvas-1")).toContainText(/delete/i);
  await expect(page.getByTestId("build-pipeline-1")).toContainText("outcome: passed");

  // Preview offers wireframe + the project's OWN native registry (Astryx).
  await page.getByTestId("nav-preview").click();
  await expect(page.getByTestId("registry-astryx")).toBeVisible();
});

test("Settings states provider options honestly and the appearance control applies", async ({ page }) => {
  await page.goto("/");
  await newProject(page, "shadcn", "Settings check");
  await page.getByTestId("nav-settings").click();
  // Provider choice is understandable; onboarding is honest when nothing local is running.
  await expect(page.getByTestId("provider-model-scripted")).toBeVisible();
  await expect(page.getByTestId("agent-status")).toContainText(/not running|connected/i);
  await expect(page.getByTestId("local-onboarding")).toBeVisible();
  // Appearance is a real preference.
  await page.getByTestId("theme-ember").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "ember");
  await page.getByTestId("theme-default").click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "ember");
});

/**
 * With no agent running, "Local AI" is unreachable — and that is a setup step,
 * not a product failure. This is the agent-ABSENT half of provider
 * configuration; the configured-and-connected half needs a real agent and a
 * real endpoint, and lives in composer-settings.spec.ts (agent config).
 *
 * The agent probe is blocked outright rather than assumed absent, so the
 * assertion means the same thing on a developer machine that happens to have
 * the agent running as it does in CI and on the deployed site.
 */
test("with no agent running, Local AI is honestly unavailable rather than a dead-looking form", async ({ page }) => {
  await page.route((url) => url.hostname === "localhost" && url.port === "8787", (route) => route.abort());
  await page.goto("/");
  await page.getByTestId("nav-settings").click();

  await expect(page.getByTestId("agent-status")).toContainText("Agent not running");

  // Onboarding names the two real steps, in order: a runner, then the bridge.
  const onboarding = page.getByTestId("local-onboarding");
  await expect(onboarding).toContainText("Ollama");
  await expect(onboarding).toContainText("pnpm --filter agent dev");

  // Nothing pretends to be configurable: both provider forms are inert, so a
  // person cannot type an endpoint that could never be reached.
  await expect(page.getByTestId("provider-ollama")).toBeVisible();
  await expect(page.getByTestId("provider-openai")).toBeVisible();
  for (const id of ["ollama-url", "ollama-test", "openai-url", "openai-key", "openai-test"]) {
    await expect(page.getByTestId(id)).toBeDisabled();
  }

  // And the path that DOES work here is offered plainly.
  await expect(page.getByTestId("provider-model-scripted")).toBeEnabled();
  await expect(page.getByTestId("active-provider")).not.toBeEmpty();
});

test("flows: create, walk, advance, persist, and round-trip through export/import", async ({ page }) => {
  await page.goto("/");
  await newProject(page, "shadcn", "Flow walkthrough");

  // Two accepted surfaces to compose: a record detail whose buttons carry
  // known emitted actions, then a destructive confirmation.
  await scriptedBuild(page, "record-detail", "show one order in full detail");
  await page.getByTestId("build-accept-1").click();
  await expect(page.getByTestId("build-accepted-1")).toContainText("ex.chat-1");
  await page.getByTestId("build-intent").selectOption("destructive-action");
  await page.getByTestId("build-prompt").fill("let people permanently delete their account");
  await page.getByTestId("build-run").click();
  await expect(page.getByTestId("build-gate-summary-2")).toContainText("Follows your design-system rules", { timeout: 30_000 });
  await page.getByTestId("build-accept-2").click();
  await expect(page.getByTestId("build-accepted-2")).toContainText("ex.chat-2");

  // Author a flow over the two surfaces, in Preview ("Your flows" — a
  // first-class concept, distinct from a single Surface).
  await page.getByTestId("nav-preview").click();
  await expect(page.getByTestId("preview-flows")).toBeVisible();
  await page.getByTestId("new-flow").click();
  await page.getByTestId("flow-name").fill("Order walkthrough");
  await page.getByTestId("flow-step-surface").selectOption("ex.chat-1");
  await page.getByTestId("flow-add-step").click();
  await page.getByTestId("flow-step-title-0").fill("Review the order");
  await page.getByTestId("flow-step-advance-0").fill("download_invoice");
  await page.getByTestId("flow-step-surface").selectOption("ex.chat-2");
  await page.getByTestId("flow-add-step").click();
  await page.getByTestId("flow-step-title-1").fill("Delete the account");
  await page.getByTestId("flow-save").click();

  // Walk it: the navigator shows ordered steps, the CURRENT step's surface
  // renders through the identical single-surface canvas path.
  await page.getByTestId("flow-flow.flow-1").click();
  await expect(page.getByTestId("flow-step-step.review-the-order")).toHaveClass(/st-btn--active/);
  await expect(page.getByTestId("flow-prev")).toBeDisabled();
  await expect(page.locator("[data-project-canvas]")).toContainText(/order/i);
  await page.getByTestId("flow-next").click();
  await expect(page.getByTestId("flow-step-step.delete-the-account")).toHaveClass(/st-btn--active/);
  await expect(page.locator("[data-project-canvas]")).toContainText(/delete/i);
  await expect(page.getByTestId("flow-next")).toBeDisabled();
  await page.getByTestId("flow-prev").click();
  await expect(page.getByTestId("flow-step-step.review-the-order")).toHaveClass(/st-btn--active/);

  // advanceOn (F2): clicking the surface's OWN emitted action advances the
  // step — view-state only — and the action log keeps receiving everything.
  // The record-detail surface's first Button dispatches download_invoice; it
  // carries its label as a CHILD Text node, which the shadcn ButtonRender
  // does not compose into an accessible name yet (an existing renderer-parity
  // gap, not a flows concern), so the click targets the first enabled canvas
  // button and the advance + action log prove which action fired.
  await page.getByTestId("registry-shadcn").click();
  await page.locator("[data-project-canvas] button:not([disabled])").first().click();
  await expect(page.getByTestId("flow-step-step.delete-the-account")).toHaveClass(/st-btn--active/);
  await expect(page.getByTestId("action-log")).toContainText("download_invoice");

  // The flow persists (project data); the walk position does not (view state).
  await page.reload();
  await expect(page.getByTestId("build-prompt")).toBeVisible();
  await page.getByTestId("nav-preview").click();
  await expect(page.getByTestId("flow-flow.flow-1")).toBeVisible();

  // Checks: the flow gate joins the findings plumbing with a one-line summary.
  await page.getByTestId("nav-validate").click();
  await page.getByTestId("run-validate").click();
  await expect(page.getByTestId("flows-summary")).toContainText("1 flow · 2 steps");
  await expect(page.getByTestId("flows-summary")).toContainText("PASS");

  // Export carries the flows field (version stays 0.1)…
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("project-export").click()]);
  const file = (await download.path())!;
  const fs = await import("node:fs/promises");
  const exported = JSON.parse(await fs.readFile(file, "utf8"));
  expect(exported.composerProjectExport).toBe("0.1");
  expect(exported.flows).toHaveLength(1);
  expect(exported.flows[0].id).toBe("flow.flow-1");
  expect(exported.flows[0].steps.map((s: { surfaceId: string }) => s.surfaceId)).toEqual(["ex.chat-1", "ex.chat-2"]);

  // …and a fresh browser state restores the flow from the file alone.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("projects-empty")).toBeVisible();
  await page.getByTestId("import-project-input").setInputFiles(file);
  await expect(page.getByTestId("build-prompt")).toBeVisible();
  await page.getByTestId("nav-preview").click();
  await page.getByTestId("flow-flow.flow-1").click();
  await expect(page.getByTestId("flow-step-step.review-the-order")).toHaveClass(/st-btn--active/);

  // Accept-into-step (Phase B): in the restored project, build once more and
  // target the flow's SECOND step at accept time — the step re-binds to the
  // freshly minted surface, the confirmation says so, and the walk shows it.
  await page.getByTestId("nav-build").click();
  await page.getByTestId("build-model").selectOption("scripted");
  await page.getByTestId("build-intent").selectOption("record-detail");
  await page.getByTestId("build-prompt").fill("a refreshed order detail");
  await page.getByTestId("build-run").click();
  await expect(page.getByTestId("build-gate-summary-1")).toContainText("Follows your design-system rules", { timeout: 30_000 });
  await page.getByTestId("build-flow-step").selectOption("flow.flow-1/step.delete-the-account");
  await page.getByTestId("build-accept-1").click();
  await expect(page.getByTestId("build-accepted-1")).toContainText(/ex\.chat-\d+/);
  await expect(page.getByTestId("build-accepted-1")).toContainText("Delete the account"); // the binding, in the confirmation copy
  await page.getByTestId("nav-preview").click();
  await page.getByTestId("flow-flow.flow-1").click();
  await page.getByTestId("flow-next").click();
  await expect(page.getByTestId("flow-step-step.delete-the-account")).toHaveClass(/st-btn--active/);
  await expect(page.locator("[data-project-canvas]")).toContainText(/order/i); // step 2 now renders the re-bound surface
});

test("build a flow: plan deterministically, edit the plan, create the pending flow, build steps, walk it (P4 Phase C)", async ({ page }) => {
  await page.goto("/");
  await newProject(page, "shadcn", "Flow composer");

  // Flow mode is opt-in: the DEFAULT Build render carries no flow-mode
  // elements — the single-surface path is untouched until the toggle.
  await expect(page.getByTestId("build-flow-goal")).toHaveCount(0);
  await expect(page.getByTestId("flow-plan-run")).toHaveCount(0);
  await expect(page.getByTestId("flow-plan-accept")).toHaveCount(0);

  await page.getByTestId("build-model").selectOption("scripted");
  await page.getByTestId("build-mode-flow").click();
  await page
    .getByTestId("build-flow-goal")
    .fill("Show one order in full detail. Let people delete their account. Show a table of the remaining accounts.");
  await page.getByTestId("flow-plan-run").click();

  // Scripted planning is the labeled deterministic outline — and editable.
  await expect(page.getByTestId("flow-plan-editor")).toBeVisible();
  await expect(page.getByTestId("flow-plan-source")).toContainText(/deterministic/i);
  await expect(page.getByTestId("flow-plan-title-2")).toBeVisible(); // 3 sentences → 3 steps
  await page.getByTestId("flow-plan-remove-2").click();
  await expect(page.getByTestId("flow-plan-title-2")).toHaveCount(0);
  await page.getByTestId("flow-plan-title-0").fill("Review the order");
  await page.getByTestId("flow-plan-intent-0").selectOption("record-detail");
  await page.getByTestId("flow-plan-title-1").fill("Delete the account");
  await page.getByTestId("flow-plan-intent-1").selectOption("destructive-action");

  // Create flow & build steps: the flow exists immediately with PENDING
  // steps, then each step runs as an ORDINARY sequential scripted build.
  await page.getByTestId("flow-plan-accept").click();
  await expect(page.getByTestId("build-gate-summary-1")).toContainText("Follows your design-system rules", { timeout: 30_000 });
  await expect(page.getByTestId("build-gate-summary-2")).toContainText("Follows your design-system rules", { timeout: 30_000 });

  // Accept turn 1 — PRE-TARGETED to its step by the driver (Phase B binding).
  await page.getByTestId("build-accept-1").click();
  await expect(page.getByTestId("build-accepted-1")).toContainText(/ex\.chat-\d+/);
  await expect(page.getByTestId("build-accepted-1")).toContainText("Review the order");

  // Half-built flow: step 2 is visibly PENDING in Preview — an outline state,
  // never a crash, never a dangling error.
  await page.getByTestId("nav-preview").click();
  await page.getByTestId("flow-flow.flow-1").click();
  await expect(page.getByTestId("flow-step-step.review-the-order")).toHaveClass(/st-btn--active/);
  await expect(page.getByTestId("flow-step-step.delete-the-account")).toBeDisabled();
  await expect(page.getByTestId("flow-step-step.delete-the-account")).toContainText(/pending/i);
  await page.getByTestId("flow-next").click();
  await expect(page.getByTestId("flow-step-pending")).toBeVisible();
  await expect(page.getByTestId("flow-step-pending")).toContainText(/not built yet/i);

  // Back in Build, accept turn 2 into ITS step; the flow completes.
  await page.getByTestId("nav-build").click();
  await page.getByTestId("build-accept-2").click();
  await expect(page.getByTestId("build-accepted-2")).toContainText("Delete the account");
  await page.getByTestId("nav-preview").click();
  await page.getByTestId("flow-flow.flow-1").click();
  await expect(page.locator("[data-project-canvas]")).toContainText(/order/i);
  await page.getByTestId("flow-next").click();
  await expect(page.getByTestId("flow-step-step.delete-the-account")).toHaveClass(/st-btn--active/);
  await expect(page.locator("[data-project-canvas]")).toContainText(/delete/i);
});

test("client traffic carries no private hosts, local paths, or key material", async ({ page }) => {
  const bodies: string[] = [];
  page.on("response", async (r) => {
    const ct = r.headers()["content-type"] ?? "";
    if (/text|javascript|json|html/.test(ct)) {
      try {
        bodies.push(await r.text());
      } catch {
        /* opaque/streamed body: nothing to scan */
      }
    }
  });
  await page.goto("/");
  await newProject(page, "shadcn", "Hygiene");
  await scriptedBuild(page, "destructive-action", "delete a workspace");

  for (const body of bodies) {
    for (const pattern of [/\/Users\/[a-z]+/i, /sk-[A-Za-z0-9]{20}/, /AKIA[A-Z0-9]{16}/]) {
      expect(body).not.toMatch(pattern);
    }
  }
});
