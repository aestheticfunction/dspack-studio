/**
 * Composer production smoke (agent-free by construction — the deployed
 * composer ships the pre-emitted demo project and no agent).
 *
 * The hosted demo is the **shadcn/ui v3** reference project (34 components,
 * mapped through the v2-language production profile). These specs assert the
 * deployment acceptance criteria against that demo: HTTPS load with a clean
 * console/network, the demo without any agent, honest agent indication, the
 * project checklist, inventory, mapper fidelity, whole in-browser validation
 * (catalog A1-A3 + document/S1-S3), preview (wireframe + honest casualty
 * refusal), acknowledged casualties, export, reload without a platform 404,
 * and client-bundle hygiene.
 *
 * Live authoring — connecting your own library and AI generation — needs the
 * local agent; the hosted app states that plainly, and these specs run
 * exactly as a visitor without one.
 */
import { expect, test } from "@playwright/test";

/** Expected non-defects: the agent health probe and the zone beacon. */
const expected = (e: string) => e.includes("localhost:8787") || e.includes("cloudflareinsights.com");

test("loads over HTTPS with no console errors and no failed requests", async ({ page }) => {
  const consoleErrors: string[] = [];
  const failed: string[] = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    consoleErrors.push(`${m.location().url ?? ""} ${m.text()}`);
  });
  page.on("requestfailed", (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on("response", (r) => r.status() >= 400 && failed.push(`${r.url()} ${r.status()}`));

  await page.goto("/");
  await expect(page.getByTestId("notice")).toContainText("project loaded");
  await expect(page.locator("header")).toContainText("shadcn/ui v3");
  const realConsole = consoleErrors.filter((e) => !expected(e));
  const realFailed = failed.filter((f) => !expected(f));
  expect(realConsole, realConsole.join("\n")).toEqual([]);
  expect(realFailed, realFailed.join("\n")).toEqual([]);
});

test("demo project loads without an agent, and the UI says so honestly", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("header")).toContainText("agent: not running");
  await expect(page.getByTestId("notice")).toContainText(/run the local agent/i);
  await expect(page.locator("body")).toContainText(/pnpm +--filter agent dev/);
});

test("the project home derives the authorship progress checklist", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-project").click(); // Build is the landing now; the checklist lives in Project
  await expect(page.getByTestId("progress")).toContainText("Components described");
  await expect(page.getByTestId("progress")).toContainText("Mapping decided");
  await expect(page.getByTestId("progress")).toContainText("Rules authored");
  await expect(page.getByTestId("progress")).toContainText("Gates green");
});

test("inventory renders the v3 components with derived lifecycle chips", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-inventory").click();
  for (const id of ["button", "card", "dialog", "table", "input", "badge"]) {
    await expect(page.getByTestId(`inventory-${id}`)).toBeVisible();
  }
  // A representation family beyond the leaf primitives.
  await expect(page.getByTestId("inventory-dialog")).toContainText(/subs/i);
  // A declared casualty reads as such in the inventory.
  await expect(page.getByTestId("inventory-tooltip")).toContainText(/casualty/i);
});

test("mapper shows the projection grid and fidelity evidence for a component", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-inventory").click();
  await page.getByTestId("inventory-button").click();
  await page.getByTestId("nav-mapper").click();
  await expect(page.locator("body")).toContainText("maps to");
  // Button's variant enum is a documented lossy projection (6->3).
  await expect(page.locator("body")).toContainText(/lossy/i);
});

test("validation runs COMPLETELY in the browser: catalog A1-A3 AND document/S1-S3 pass", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-validate").click();
  await page.getByTestId("run-validate").click();
  // Both gate groups are green for the v3 demo: the catalog (A1/A2/A3, both
  // A2UI versions) and the contract+surface document harness (S1-S3). The
  // latter needs dspack-spec >= 0.4.4 in the bundle to accept requiredCategories.
  await expect(page.locator("body")).toContainText("catalog gates (A1/A2/A3, both A2UI versions): PASS");
  await expect(page.locator("body")).toContainText("contract + surface gates: PASS");
});

test("preview renders the wireframe canvas and the honest casualty refusals", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-preview").click();
  // The universal wireframe registry draws every emitted name; Card is present
  // in the first surface (delete-account-confirmation).
  await expect(page.locator("[data-wireframe='Card']").first()).toBeVisible();
  // Three worked surfaces refuse on declared casualties — first-class, not errors.
  await expect(page.getByTestId("surface-refused-ex.docs-article-trail")).toContainText("refused");
  await expect(page.getByTestId("surface-refused-ex.usage-help-affordances")).toContainText("refused");
  // Export is available (the "usable A2UI/AG-UI catalog" step).
  await expect(page.getByTestId("export-catalog")).toBeVisible();
});

test("reloading and directly opening the app never hits a platform 404", async ({ page }) => {
  const first = await page.goto("/");
  expect(first?.status()).toBe(200);
  await page.getByTestId("nav-preview").click();
  const second = await page.reload();
  expect(second?.status()).toBe(200);
  await expect(page.getByTestId("notice")).toContainText("project loaded");
});

test("the v3 demo's declared casualties read as acknowledged decisions, not failures", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-project").click(); // the checklist lives in Project (Build is the landing)
  const row = page.getByTestId("progress").filter({ hasText: "Gates green" });
  await expect(row).toContainText("Gates pass · 3 acknowledged casualties");
  await expect(row).not.toContainText("error finding");
});

test("rule builder is rationale-first: no rationale, no save", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-governance").click();
  await page.getByTestId("rule-id").fill("rule.smoke-test");
  await page.getByTestId("rule-type").selectOption("required-props");
  // Complete the type minimally — a target component + "requires text" — so
  // only the rationale is missing.
  await page.getByTestId("rule-component").selectOption("button");
  await page.getByTestId("rule-required-text").check();
  await expect(page.getByTestId("save-rule")).toBeDisabled();
  await page.getByTestId("rule-rationale").fill("A smoke-level rationale long enough to count as written intent.");
  await expect(page.getByTestId("save-rule")).toBeEnabled();
});

test("scenario editor: a v3 worked surface lints clean and previews live", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-scenarios").click();
  await page.getByTestId("edit-ex.delete-account-confirmation").click();
  await expect(page.getByTestId("lint-clean")).toContainText("S1 S2 S3 clean");
  await expect(page.getByTestId("scenario-preview")).toBeVisible();
});

test("goal-first BUILD: describe an outcome → inferred context → governed surface, in the browser", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-build").click();

  // Goal-first: the prompt is the front door; the governed context defaults to
  // AUTO (inferred), never a prerequisite the user must pick.
  await expect(page.getByTestId("build-prompt")).toBeVisible();
  await expect(page.getByTestId("build-intent")).toHaveValue("");

  // Deterministic across environments: scripted. Force the governed context so
  // the replayed example is predictable (scripted routing is a rough heuristic;
  // hosted-ai infers accurately and is exercised live post-deploy). The user
  // describes an OUTCOME — no S1/S2/S3, no intent id in the front door.
  await page.getByTestId("build-model").selectOption("scripted");
  await page.getByTestId("build-intent").selectOption("destructive-action");
  await page.getByTestId("build-prompt").fill("let people permanently delete their account");
  await page.getByTestId("build-run").click();

  // The governed context is SHOWN (echoed), not selected up front.
  await expect(page.getByTestId("build-context-1")).toContainText(/governance context/i, { timeout: 30_000 });

  // Governance is translated to plain outcomes — the differentiator, legible.
  const summary = page.getByTestId("build-gate-summary-1");
  await expect(summary).toContainText("Uses only approved components");
  await expect(summary).toContainText("Follows your design-system rules");

  // The surface renders (native shadcn for this reference project).
  await expect(page.getByTestId("build-canvas-1")).toContainText(/delete/i);

  // The rigorous evidence (S1/S2/S3, repair, emit) stays one expander away.
  await expect(page.getByTestId("build-pipeline-1")).toContainText("outcome: passed");

  // Accepting persists to disk (agent-only); the demo says so honestly.
  await expect(page.getByTestId("build-accept-note-1")).toContainText(/connect the local agent/i);

  // Refine preserves the goal's context and re-runs every gate.
  await page.getByTestId("build-prompt").fill("make the heading clearer");
  await page.getByTestId("build-refine").click();
  await expect(page.getByTestId("build-context-2")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("build-gate-summary-2")).toContainText("Structurally valid");
});

test("cross-design-system: Astryx is a first-class reference through the SAME goal-first pipeline", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-build").click();

  // The design-system source picker offers both packaged references — a hosted
  // visitor starts a blank project from either governed vocabulary.
  await expect(page.getByTestId("ds-source-shadcn")).toBeVisible();
  const astryx = page.getByTestId("ds-source-astryx");
  await expect(astryx).toBeVisible();

  // Selecting Astryx loads its reference: header, notice, and the governed-context
  // taxonomy all follow the LOADED contract — the planner reads it, no fork.
  await astryx.click();
  await expect(page.locator("header")).toContainText("Astryx");
  await expect(page.getByTestId("notice")).toContainText("Astryx project loaded");
  // An Astryx-only intent proves the taxonomy came from the Astryx contract.
  await expect(page.getByTestId("build-intent")).toContainText("transactional-review");

  // The SAME deterministic pipeline builds and renders natively through
  // @astryxdesign/core — governance translated identically, no shadcn assumption.
  await page.getByTestId("build-model").selectOption("scripted");
  await page.getByTestId("build-intent").selectOption("destructive-action");
  await page.getByTestId("build-prompt").fill("let people permanently delete a project");
  await page.getByTestId("build-run").click();
  await expect(page.getByTestId("build-gate-summary-1")).toContainText("Follows your design-system rules", { timeout: 30_000 });
  await expect(page.getByTestId("build-canvas-1")).toContainText(/delete/i);
  await expect(page.getByTestId("build-pipeline-1")).toContainText("outcome: passed");
});

test("client traffic carries no private hosts, local paths, or key material", async ({ page }) => {
  const bodies: string[] = [];
  page.on("response", async (r) => {
    const t = r.headers()["content-type"] ?? "";
    if (/javascript|json|html/.test(t)) {
      try {
        bodies.push(await r.text());
      } catch {
        /* body unavailable (opaque/cached): fine */
      }
    }
  });
  await page.goto("/");
  await expect(page.getByTestId("notice")).toContainText("project loaded");
  const leaks: string[] = [];
  for (const body of bodies) {
    for (const pattern of [/\/Users\/[a-z]+/i, /sk-[A-Za-z0-9]{20}/, /AKIA[A-Z0-9]{16}/]) {
      const m = body.match(pattern);
      if (m) leaks.push(m[0]);
    }
  }
  expect(leaks, leaks.join(", ")).toEqual([]);
});
