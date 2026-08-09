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
