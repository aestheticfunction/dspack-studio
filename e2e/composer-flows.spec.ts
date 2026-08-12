import { expect, test, type Page } from "@playwright/test";
import { buildAndAccept, newProject } from "./support/composer-browser";

/**
 * Flows — composition and decomposition, end to end (P4 Phases B + C).
 *
 * The smoke suite already proves the happy path exists. What had no coverage
 * is everything a person actually does around it: editing a proposed plan
 * before committing to it, cancelling out of the flow editor, re-running one
 * step, walking a flow to completion, and what the product says when a step's
 * surface cannot be emitted at all.
 *
 * Every build here runs on the SCRIPTED provider — deterministic replay, zero
 * model calls — and the planner is the deterministic outline, so nothing in
 * this file talks to a model or a gateway.
 */

/** Three sentences → three deterministic steps. */
const THREE_STEP_GOAL =
  "Show one order in full detail. Let people delete their account. Show a table of the remaining accounts.";
const TWO_STEP_GOAL = "Show one order in full detail. Let people delete their account.";

/** Open flow mode and produce the deterministic outline for a goal. */
async function planFlow(page: Page, goal: string): Promise<void> {
  await page.getByTestId("build-model").selectOption("scripted");
  await page.getByTestId("build-mode-flow").click();
  await expect(page.getByTestId("flow-composer")).toBeVisible();
  await page.getByTestId("build-flow-goal").fill(goal);
  await page.getByTestId("flow-plan-run").click();
  await expect(page.getByTestId("flow-plan-editor")).toBeVisible();
}

/** The two-step plan both drive specs build, titled and governed explicitly. */
async function twoStepPlan(page: Page): Promise<void> {
  await planFlow(page, TWO_STEP_GOAL);
  await page.getByTestId("flow-plan-name").fill("Order journey");
  await page.getByTestId("flow-plan-title-0").fill("Review the order");
  await page.getByTestId("flow-plan-intent-0").selectOption("record-detail");
  await page.getByTestId("flow-plan-title-1").fill("Delete the account");
  await page.getByTestId("flow-plan-intent-1").selectOption("destructive-action");
  await expect(page.getByTestId("flow-drive-status")).toContainText("2 steps — builds run one at a time.");
  await page.getByTestId("flow-plan-accept").click();
  await expect(page.getByTestId("build-gate-summary-1")).toContainText("Follows your design-system rules", { timeout: 60_000 });
  await expect(page.getByTestId("build-gate-summary-2")).toContainText("Follows your design-system rules", { timeout: 60_000 });
  await expect(page.getByTestId("flow-drive-status")).toContainText("steps ran — accept each turn below");
}

test("the proposed plan is editable — renamed, retitled, reordered, extended, trimmed — and builds nothing until it is accepted", async ({
  page,
}) => {
  await page.goto("/");
  await newProject(page, "shadcn", "Flow planning");

  // Flow mode replaces the single-surface composer; it is a mode, not an extra
  // control bolted beside the ordinary prompt.
  await planFlow(page, THREE_STEP_GOAL);
  await expect(page.getByTestId("build-prompt")).toHaveCount(0);
  await expect(page.getByTestId("flow-plan-source")).toContainText(/deterministic/i);

  // The planner names the flow from the goal; the person can overrule it.
  const name = page.getByTestId("flow-plan-name");
  await expect(name).toHaveValue("Show one order in full detail");
  await name.fill("Order journey");
  await expect(name).toHaveValue("Order journey");

  // One step per sentence, each pre-titled from its own sentence.
  await expect(page.getByTestId("flow-plan-title-0")).toHaveValue("Show one order in full detail");
  await expect(page.getByTestId("flow-plan-title-2")).toHaveValue("Show a table of the remaining");
  await expect(page.getByTestId("flow-plan-title-3")).toHaveCount(0);

  // Retitle in place.
  await page.getByTestId("flow-plan-title-0").fill("Review the order");
  await expect(page.getByTestId("flow-plan-title-0")).toHaveValue("Review the order");

  // Reorder: the two rows genuinely swap, and the ends cannot move past them.
  await expect(page.getByTestId("flow-plan-up-0")).toBeDisabled();
  await expect(page.getByTestId("flow-plan-down-2")).toBeDisabled();
  const second = await page.getByTestId("flow-plan-title-1").inputValue();
  await page.getByTestId("flow-plan-down-0").click();
  await expect(page.getByTestId("flow-plan-title-0")).toHaveValue(second);
  await expect(page.getByTestId("flow-plan-title-1")).toHaveValue("Review the order");
  await page.getByTestId("flow-plan-up-1").click();
  await expect(page.getByTestId("flow-plan-title-0")).toHaveValue("Review the order");

  // Extend and trim.
  await page.getByTestId("flow-plan-add").click();
  await expect(page.getByTestId("flow-plan-title-3")).toHaveValue("Step 4");
  await page.getByTestId("flow-plan-remove-3").click();
  await expect(page.getByTestId("flow-plan-title-3")).toHaveCount(0);
  await page.getByTestId("flow-plan-remove-2").click();
  await expect(page.getByTestId("flow-plan-title-2")).toHaveCount(0);

  // The driver states its contract up front: sequential, and (on scripted) not
  // artificially spaced.
  await expect(page.getByTestId("flow-drive-status")).toContainText("2 steps — builds run one at a time.");

  // Planning creates NOTHING. The flow only exists once the plan is accepted.
  await page.getByTestId("nav-flows").click();
  await expect(page.getByTestId("flows-empty")).toBeVisible();
});

test("accepting a plan creates the flow immediately with pending steps, and Preview and Checks say so honestly", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await newProject(page, "shadcn", "Flow drive");
  await twoStepPlan(page);

  // The plan froze when the drive started: reorder and add are gone, and each
  // row now offers a rebuild instead.
  await expect(page.getByTestId("flow-plan-remove-0")).toHaveCount(0);
  await expect(page.getByTestId("flow-plan-add")).toHaveCount(0);
  await expect(page.getByTestId("flow-build-step-0")).toBeVisible();
  await expect(page.getByTestId("flow-build-step-1")).toBeVisible();

  // The flow exists ALREADY, with both steps pending: an outline you can walk,
  // not a crash and not a dangling reference.
  await page.getByTestId("nav-flows").click();
  await expect(page.getByTestId("flow-flow.flow-1")).toContainText("Order journey");
  await expect(page.getByTestId("flow-navigator")).toBeVisible();
  await expect(page.getByTestId("flow-step-step.review-the-order")).toContainText("pending");
  await expect(page.getByTestId("flow-step-step.review-the-order")).toBeDisabled();
  await expect(page.getByTestId("flow-step-pending")).toContainText("isn’t built yet");
  await expect(page.getByTestId("flow-step-pending")).toContainText("build it from Build and accept into this step");
  await expect(page.locator("[data-project-canvas]")).toHaveCount(0);

  // Flow lint agrees, in the same words, and calls it a warning — planned-but-
  // unbuilt is a state of the work, not a failure of the project.
  await page.getByTestId("nav-validate").click();
  await page.getByTestId("run-validate").click();
  await expect(page.getByTestId("flows-summary")).toContainText("1 flow · 2 steps · flow checks PASS");
  const pending = page.getByTestId("finding-flow-pending-step").first();
  await expect(pending).toContainText("warn");
  await expect(pending).toContainText("is not built yet");
});

test("a driven step rebuilds in place, and each accepted turn binds to the step it was built for", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await newProject(page, "shadcn", "Flow rebuild");
  await twoStepPlan(page);

  // Accepting a driven turn binds its step — the driver pre-targeted it, so
  // the confirmation names the step rather than just the surface.
  await page.getByTestId("build-accept-1").click();
  await expect(page.getByTestId("build-accepted-1")).toContainText("Review the order");

  // Re-run just the second step, then accept THAT turn into its step.
  await page.getByTestId("flow-build-step-1").click();
  await expect(page.getByTestId("build-gate-summary-3")).toContainText("Follows your design-system rules", { timeout: 60_000 });
  await page.getByTestId("build-accept-3").click();
  await expect(page.getByTestId("build-accepted-3")).toContainText("Delete the account");

  // Both steps now render their bound surfaces through the ordinary canvas,
  // and flow lint has nothing left to report.
  await page.getByTestId("nav-flows").click();
  await expect(page.getByTestId("flow-step-step.review-the-order")).toBeEnabled();
  await expect(page.getByTestId("flow-step-step.review-the-order")).not.toContainText("pending");
  await expect(page.locator("[data-project-canvas]")).toContainText(/order/i);
  await page.getByTestId("flow-next").click();
  await expect(page.locator("[data-project-canvas]")).toContainText(/delete/i);
  await page.getByTestId("nav-validate").click();
  await page.getByTestId("run-validate").click();
  await expect(page.getByTestId("flows-summary")).toContainText("flow checks PASS");
  await expect(page.getByTestId("finding-flow-pending-step")).toHaveCount(0);
});

test("leaving Build and coming back keeps the in-progress plan — and never mints a second flow", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await newProject(page, "shadcn", "Flow round trip");
  await twoStepPlan(page);

  // The product's own pending-step copy sends people to Flows and back:
  // "build it from Build and accept into this step". That round trip used to
  // unmount the Build view and take the plan with it — mode, plan, and
  // per-step build state all gone, per-step rebuild unreachable, and the only
  // way forward was to re-plan, which mints a SECOND flow beside the first.
  await page.getByTestId("nav-flows").click();
  await expect(page.getByTestId("flow-flow.flow-1")).toContainText("Order journey");
  await page.getByTestId("nav-build").click();

  // Back exactly as it was left: still in flow mode, the same plan, the same
  // frozen drive, and per-step rebuild still reachable.
  await expect(page.getByTestId("flow-composer")).toBeVisible();
  await expect(page.getByTestId("build-prompt")).toHaveCount(0);
  await expect(page.getByTestId("flow-plan-editor")).toBeVisible();
  await expect(page.getByTestId("flow-plan-name")).toHaveValue("Order journey");
  await expect(page.getByTestId("flow-plan-title-0")).toHaveValue("Review the order");
  await expect(page.getByTestId("flow-plan-title-1")).toHaveValue("Delete the account");
  await expect(page.getByTestId("flow-build-step-1")).toBeVisible();
  await expect(page.getByTestId("flow-plan-add")).toHaveCount(0); // still frozen, not a fresh plan

  // And the round trip created nothing: one flow, the one the plan made.
  await page.getByTestId("nav-flows").click();
  await expect(page.getByTestId("flow-flow.flow-1")).toBeVisible();
  await expect(page.getByTestId("flow-flow.flow-2")).toHaveCount(0);

  // The surviving plan still DRIVES: rebuild step 2 after the round trip and
  // accept it into the step it was built for.
  await page.getByTestId("nav-build").click();
  await page.getByTestId("flow-build-step-1").click();
  await expect(page.getByTestId("build-gate-summary-3")).toContainText("Follows your design-system rules", { timeout: 60_000 });
  await page.getByTestId("build-accept-3").click();
  await expect(page.getByTestId("build-accepted-3")).toContainText("Delete the account");
  await page.getByTestId("nav-flows").click();
  await expect(page.getByTestId("flow-flow.flow-2")).toHaveCount(0);
});

test("the flow editor: cancelling creates nothing, and a saved flow walks to completion on its own emitted action", async ({ page }) => {
  await page.goto("/");
  await newProject(page, "shadcn", "Flow editor");
  await buildAndAccept(page, "record-detail", "show one order in full detail");

  await page.getByTestId("nav-preview").click();
  await expect(page.getByTestId("flows-empty")).toBeVisible();

  // Cancel abandons the draft: no flow, no editor, nothing persisted.
  await page.getByTestId("new-flow").click();
  await expect(page.getByTestId("flow-editor")).toBeVisible();
  await page.getByTestId("flow-name").fill("Abandoned");
  await page.getByTestId("flow-cancel").click();
  await expect(page.getByTestId("flow-editor")).toHaveCount(0);
  await expect(page.getByTestId("flow-flow.flow-1")).toHaveCount(0);
  await expect(page.getByTestId("flows-empty")).toBeVisible();

  // Compose a one-step flow that advances on the surface's OWN emitted action.
  await page.getByTestId("new-flow").click();
  await page.getByTestId("flow-name").fill("Order walkthrough");
  await page.getByTestId("flow-step-surface").selectOption("ex.chat-1");
  await page.getByTestId("flow-add-step").click();
  await page.getByTestId("flow-step-title-0").fill("Review the order");
  await page.getByTestId("flow-step-advance-0").fill("download_invoice");
  await page.getByTestId("flow-save").click();

  await expect(page.getByTestId("flow-editor")).toHaveCount(0);
  await expect(page.getByTestId("flow-navigator")).toBeVisible();
  await expect(page.getByTestId("flow-prev")).toBeDisabled();
  await expect(page.getByTestId("flow-next")).toBeDisabled();
  await expect(page.locator("[data-project-canvas]")).toContainText(/order/i);

  // The last step's advance action walks PAST the end: "flow complete" is a
  // quiet, named state, not an empty canvas. (The record-detail surface's first
  // button dispatches download_invoice; the shadcn renderer does not yet
  // compose its child Text into an accessible name, so the click targets the
  // first enabled canvas button and the action log proves which fired.)
  await page.getByTestId("registry-shadcn").click();
  await page.locator("[data-project-canvas] button:not([disabled])").first().click();
  await expect(page.getByTestId("action-log")).toContainText("download_invoice");
  const complete = page.getByTestId("flow-complete");
  await expect(complete).toContainText("Flow complete");
  await expect(complete).toContainText("Order walkthrough");

  // A completed flow is revisitable — picking a step re-enters the walk.
  await page.getByTestId("flow-step-step.review-the-order").click();
  await expect(page.getByTestId("flow-complete")).toHaveCount(0);
  await expect(page.locator("[data-project-canvas]")).toContainText(/order/i);
});

test("a step over a surface the emitter refuses shows the refusal, not a blank canvas", async ({ page }) => {
  await page.goto("/");
  await newProject(page, "shadcn", "Unrenderable step");
  await page.getByTestId("nav-preview").click();

  // The step picker offers refused surfaces too, labelled as such — a flow may
  // legitimately name a screen the design system cannot draw yet.
  await page.getByTestId("new-flow").click();
  await page.getByTestId("flow-name").fill("Wayfinding");
  const picker = page.getByTestId("flow-step-surface");
  await expect(picker.locator('option[value="ex.docs-article-trail"]')).toContainText("can't be emitted");
  await picker.selectOption("ex.docs-article-trail");
  await page.getByTestId("flow-add-step").click();
  await page.getByTestId("flow-step-title-0").fill("Docs trail");
  await page.getByTestId("flow-save").click();

  const refusal = page.getByTestId("flow-step-unrenderable");
  await expect(refusal).toContainText("This step’s surface can’t render");
  // The EMITTER's own reason travels to the step — not a generic apology, and
  // not the dangling-reference wording (the reference resolves fine).
  await expect(refusal.locator(".af-empty__body")).not.toBeEmpty();
  await expect(refusal).not.toContainText("which is not in this project's surfaces");
  await expect(page.locator("[data-project-canvas]")).toHaveCount(0);

  // The flow itself is well-formed: the reference resolves, so flow-lint has
  // nothing to say — the refusal belongs to the surface, not to the flow.
  await page.getByTestId("nav-validate").click();
  await page.getByTestId("run-validate").click();
  await expect(page.getByTestId("flows-summary")).toContainText("1 flow · 1 step · flow checks PASS");
});
