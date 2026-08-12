import { expect, test } from "@playwright/test";
import { authorSurface, newProject } from "./support/composer-browser";

/**
 * Surface authoring (the "Surfaces" view) — the second thing a new team does
 * after their first build, and until now covered by nothing.
 *
 * A saved surface IS a contract worked example, so authoring here writes the
 * project's few-shot corpus AND its preview corpus at once. That is what these
 * specs assert: not that the editor renders, but that what a person authors
 * becomes project content they can then see, walk, and check — and that a
 * surface which fails a gate is refused out loud rather than saved quietly.
 *
 * Agent-free by construction (the hosted experience). No model call anywhere:
 * authoring is forms over the contract's vocabulary.
 */

test("author a surface: it lints clean, previews live, saves, and lists under its human title", async ({ page }) => {
  await page.goto("/");
  await newProject(page, "shadcn", "Surface authoring");
  await page.getByTestId("nav-surfaces").click();

  // A fresh project owns nothing yet, and says so — the design system's own
  // surfaces are a separate, clearly-labelled corpus.
  await expect(page.getByTestId("scenarios-none-yet")).toBeVisible();
  await expect(page.getByTestId("scenarios-reference")).toContainText("Reference surfaces");

  await authorSurface(page, {
    id: "save-preferences",
    intent: "preference-settings",
    title: "Save preferences",
    prompt: "a button that saves the person's notification preferences",
    component: "button",
    text: "Save preferences",
  });

  // The gates run on every keystroke, and the preview renders the draft — the
  // two panels that make authoring honest rather than hopeful.
  await expect(page.getByTestId("lint-clean")).toContainText("S1 S2 S3 clean");
  await expect(page.getByTestId("scenario-preview")).toContainText("Save preferences");

  await expect(page.getByTestId("save-scenario")).toBeEnabled();
  await page.getByTestId("save-scenario").click();

  // Back in the listing: the TITLE leads, the canonical id stays beside it for
  // audit, and the project no longer says it owns nothing.
  const row = page.getByTestId("scenario-ex.save-preferences");
  await expect(row).toContainText("Save preferences");
  await expect(row).toContainText("ex.save-preferences");
  await expect(row).toContainText("preference-settings");
  await expect(page.getByTestId("scenarios-none-yet")).toHaveCount(0);

  // It is project content now: Preview offers it among the project's OWN
  // surfaces and renders it through the project's design system.
  await page.getByTestId("nav-preview").click();
  const surface = page.getByTestId("surface-ex.save-preferences");
  await expect(surface).toContainText("Save preferences");
  await surface.click();
  await expect(page.locator("[data-project-canvas]")).toContainText("Save preferences");

  // And it survives a reload — an authored surface is persisted project work,
  // not session scratch.
  await page.reload();
  await expect(page.getByTestId("build-prompt")).toBeVisible();
  await page.getByTestId("nav-surfaces").click();
  await expect(page.getByTestId("scenario-ex.save-preferences")).toContainText("Save preferences");
});

test("a should-level rule warns without blocking, and Checks reports it against the authored surface", async ({ page }) => {
  await page.goto("/");
  await newProject(page, "shadcn", "Warned surface");
  await page.getByTestId("nav-surfaces").click();

  // shadcn's rule.spinner-names-what-is-loading is severity `should`: a spinner
  // with no aria-label is a warning, and a warning must not behave like a bar.
  await authorSurface(page, {
    id: "orders-loading",
    intent: "loading-state",
    title: "Orders are loading",
    component: "spinner",
  });

  const findings = page.getByTestId("lint-findings");
  await expect(findings).toContainText("spinner-names-what-is-loading");
  await expect(page.getByTestId("save-scenario")).toBeEnabled();
  await page.getByTestId("save-scenario").click();
  await expect(page.getByTestId("scenario-ex.orders-loading")).toContainText("Orders are loading");

  // Checks sees the surface the person just authored: the run stays PASS
  // (warnings do not fail the contract) and the finding names the surface.
  await page.getByTestId("nav-validate").click();
  await page.getByTestId("run-validate").click();
  await expect(page.getByTestId("validate-status")).toContainText("PASS");
  const row = page.locator('[data-testid^="finding-S3-"]').filter({ hasText: "ex.orders-loading" });
  await expect(row).toContainText("spinner");
  await expect(row).toContainText("warn");
});

test("a surface that fails a gate is refused out loud, saves nothing, and unblocks when it is fixed", async ({ page }) => {
  await page.goto("/");
  await newProject(page, "shadcn", "Refused surface");
  await page.getByTestId("nav-surfaces").click();

  // rule.button-carries-text is severity `must`, and applies to every intent.
  await authorSurface(page, { id: "unnamed-button", intent: "preference-settings", component: "button" });

  await expect(page.getByTestId("lint-findings")).toContainText("button-carries-text");
  await expect(page.getByTestId("save-scenario")).toBeDisabled();
  await expect(page.getByText("gates first")).toBeVisible();

  // Leaving the editor saves NOTHING — a refusal is a refusal, not a draft
  // quietly written under the person's nose.
  await page.getByRole("button", { name: "← surfaces" }).click();
  await expect(page.getByTestId("scenario-ex.unnamed-button")).toHaveCount(0);
  await expect(page.getByTestId("scenarios-none-yet")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("build-prompt")).toBeVisible();
  await page.getByTestId("nav-surfaces").click();
  await expect(page.getByTestId("scenario-ex.unnamed-button")).toHaveCount(0);

  // Fixing the violation clears the gate and unlocks the save — the gate is
  // live guidance, not a dead end.
  await authorSurface(page, { id: "unnamed-button", intent: "preference-settings", component: "button", text: "Delete workspace" });
  await expect(page.getByTestId("lint-clean")).toBeVisible();
  await expect(page.getByTestId("save-scenario")).toBeEnabled();
  await page.getByTestId("save-scenario").click();
  await expect(page.getByTestId("scenario-ex.unnamed-button")).toContainText("ex.unnamed-button");
});

test("an emitter refusal is stated in the preview panel instead of a blank canvas", async ({ page }) => {
  await page.goto("/");
  await newProject(page, "shadcn", "Emitter refusal");
  await page.getByTestId("nav-surfaces").click();

  // `alert-title` is a declared SUB-component of `alert`; standing alone at the
  // root it violates S2 and the emitter refuses to produce anything for it.
  await authorSurface(page, { id: "stray-alert-title", intent: "preference-settings", component: "alert-title", text: "Stray title" });

  await expect(page.getByTestId("lint-findings")).toContainText("sub-component 'alert-title'");
  await expect(page.getByTestId("preview-refused")).toContainText("emitter refusal");
  await expect(page.getByTestId("scenario-preview")).toHaveCount(0);
  await expect(page.getByTestId("save-scenario")).toBeDisabled();
});
