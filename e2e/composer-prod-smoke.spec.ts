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
  await expect(page.getByTestId("notice")).toContainText("Demo project loaded");
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
  await expect(page.getByTestId("notice")).toContainText("Demo project loaded");
});

test("the v3 demo's declared casualties read as acknowledged decisions, not failures", async ({ page }) => {
  await page.goto("/");
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

test("hosted BUILD generates a governed surface entirely in the browser — no agent, no install", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-build").click();

  // The hosted demo runs the governed pipeline IN THIS BROWSER and says so.
  // (The pre-gateway dead-end showed build-needs-agent and no prompt at all,
  // so this test cannot pass without the in-browser generation path.)
  await expect(page.getByTestId("build-hosted-note")).toContainText(/entirely in this browser/i);
  await expect(page.getByTestId("build-prompt")).toBeVisible();
  await expect(page.getByTestId("build-privacy")).toContainText("nothing leaves this machine");

  // Generate. Scripted replays destructive-action's worked example behind ONE
  // deliberately-violating attempt, so the governance is visible: S2 catches the
  // bad component, bounded repair re-proposes, the clean surface passes S1/S2/S3
  // and emit. Every gate here is AJV compiling validators via new Function in the
  // browser — the exact thing Cloudflare Workers ban, which is why the pipeline
  // runs client-side, not in a Worker.
  await page.getByTestId("build-prompt").fill("a confirm dialog to delete my account");
  await page.getByTestId("build-run").click();
  await expect(page.getByTestId("build-outcome-1")).toContainText("passed", { timeout: 30_000 });

  const pipeline = page.getByTestId("build-pipeline-1");
  await expect(pipeline).toContainText("attempt 1");
  await expect(pipeline).toContainText("S2 FAIL"); // the caught vocabulary violation
  await expect(pipeline).toContainText("repair sent");
  await expect(pipeline).toContainText("attempt 2");
  await expect(pipeline).toContainText("emit: A-gates reported");

  // The generated surface renders through the trusted (wireframe) registry.
  await expect(page.getByTestId("build-canvas-1")).toContainText("Danger zone");

  // Accepting a result as a reusable worked example writes to a project on disk
  // — an agent capability. The demo says so honestly instead of dead-ending on a
  // button that cannot work without the agent.
  await expect(page.getByTestId("build-accept-note-1")).toContainText(/connect the local agent/i);
  await expect(page.getByTestId("build-accept-1")).toHaveCount(0);

  // Refine seeds the prior surface and re-runs every gate — monotonic (never a
  // byte-identical no-op), also entirely in-browser.
  await page.getByTestId("build-prompt").fill("make the title clearer");
  await page.getByTestId("build-refine").click();
  await expect(page.getByTestId("build-outcome-2")).toContainText("passed", { timeout: 30_000 });
  await expect(page.getByTestId("build-canvas-2")).toContainText("Danger zone (refined)");
  await expect(page.getByTestId("build-canvas-1")).not.toContainText("(refined)");
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
  await expect(page.getByTestId("notice")).toContainText("Demo project loaded");
  const leaks: string[] = [];
  for (const body of bodies) {
    for (const pattern of [/\/Users\/[a-z]+/i, /sk-[A-Za-z0-9]{20}/, /AKIA[A-Z0-9]{16}/]) {
      const m = body.match(pattern);
      if (m) leaks.push(m[0]);
    }
  }
  expect(leaks, leaks.join(", ")).toEqual([]);
});
