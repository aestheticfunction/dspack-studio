import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { authorSurface, newProject } from "./support/composer-browser";

const REFERENCE = fileURLToPath(new URL("../apps/composer/shadcn-v3-project/", import.meta.url));

/**
 * An exportable project carrying ONE surface the emitter refuses: the shipped
 * shadcn vocabulary, plus a root Card with no children. Import is not
 * emit-gated (a project file is vocabulary, not a build), so this is how a
 * refused surface legitimately arrives in someone's browser — inherited from a
 * teammate, or hand-edited — and it is the state Build has to explain.
 */
function unrenderableProject(): Record<string, unknown> {
  const contract = JSON.parse(readFileSync(`${REFERENCE}shadcn-ui.dspack.json`, "utf8")) as Record<string, any>;
  const profile = JSON.parse(readFileSync(`${REFERENCE}shadcn-v3.profile.json`, "utf8")) as Record<string, unknown>;
  contract.examples = [
    ...(contract.examples ?? []),
    {
      id: "ex.empty-card",
      intent: "preference-settings",
      name: "A card with nothing in it",
      prompt: "a card with nothing in it",
      surface: { dspackSurface: "0.1", system: contract.name, intent: "preference-settings", root: { component: "card", id: "root" } },
    },
  ];
  return {
    composerProjectExport: "0.1",
    exportedAt: new Date(0).toISOString(),
    name: "Inherited project",
    description: "A project that arrived with a surface this design system cannot draw.",
    previewRegistry: "shadcn",
    contract,
    profile,
  };
}

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

test("a surface the emitter refuses cannot be saved, and saves as soon as it can render", async ({ page }) => {
  await page.goto("/");
  await newProject(page, "shadcn", "Unrenderable surface");
  await page.getByTestId("nav-surfaces").click();

  // A root Card with no children breaks NO rule the contract authored — every
  // S-gate passes — and the emitter still refuses it: Card's `child` prop is
  // required and fed by children. The gate strip and the preview disagree, and
  // Save has been following the gate strip. It must follow the refusal too:
  // a surface the design system cannot render is not project work.
  await authorSurface(page, { id: "empty-card", intent: "preference-settings", component: "card" });

  await expect(page.getByTestId("lint-clean")).toContainText("S1 S2 S3 clean");
  await expect(page.getByTestId("preview-refused")).toContainText("required prop 'child' has no value");
  await expect(page.getByTestId("save-scenario")).toBeDisabled();
  // The reason beside Save is the EMITTER's own words, not a generic apology.
  await expect(page.getByTestId("save-blocked-emit")).toContainText("required prop 'child' has no value");

  // Nothing is written: not on leaving the editor, and not across a reload.
  await page.getByRole("button", { name: "← surfaces" }).click();
  await expect(page.getByTestId("scenario-ex.empty-card")).toHaveCount(0);
  await expect(page.getByTestId("scenarios-none-yet")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("build-prompt")).toBeVisible();
  await page.getByTestId("nav-surfaces").click();
  await expect(page.getByTestId("scenario-ex.empty-card")).toHaveCount(0);

  // And Build is not quietly blocked by work that was never saved.
  await page.getByTestId("nav-build").click();
  await expect(page.getByTestId("build-not-ready")).toHaveCount(0);
  await page.getByTestId("nav-surfaces").click();

  // Give the Card something to hold and the SAME surface saves — the emitter's
  // refusal is live guidance, exactly like the gates.
  await authorSurface(page, { id: "empty-card", intent: "preference-settings", component: "card" });
  await page.getByTestId("add-child-0").click();
  await page.getByTestId("node-component-1").selectOption("button");
  await page.getByTestId("node-text-1").fill("Save preferences");
  await expect(page.getByTestId("preview-refused")).toHaveCount(0);
  await expect(page.getByTestId("save-blocked-emit")).toHaveCount(0);
  await expect(page.getByTestId("save-scenario")).toBeEnabled();
  await page.getByTestId("save-scenario").click();
  await expect(page.getByTestId("scenario-ex.empty-card")).toContainText("ex.empty-card");
});

test("Build blocked by a finding names the surface that is blocking it", async ({ page }) => {
  await page.goto("/");
  // A project that arrives with a surface this design system cannot emit — a
  // teammate's exported file, a hand-edited contract. Readiness refuses to
  // build, and until now said only "gates not green — 1 error finding": true,
  // and useless. It must name the surface, by id AND by the title a person
  // reads, and offer the way to it.
  await page.getByTestId("nav-projects").click();
  await page.getByTestId("import-project-input").setInputFiles({
    name: "inherited.composerproject.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(unrenderableProject()), "utf8"),
  });
  await expect(page.getByTestId("project-context")).toContainText("Inherited project");

  await page.getByTestId("nav-build").click();
  const notReady = page.getByTestId("build-not-ready");
  await expect(notReady).toContainText("gates not green");

  const blocker = page.getByTestId("build-blocker-ex.empty-card");
  await expect(blocker).toContainText("A card with nothing in it");
  await expect(blocker).toContainText("ex.empty-card");
  await expect(blocker).toContainText("required prop 'child' has no value");

  // And it is a way out, not a dead end: the offending surface is one click away.
  await page.getByTestId("build-blocker-open-ex.empty-card").click();
  await expect(page.getByTestId("scenario-ex.empty-card")).toContainText("A card with nothing in it");
});

test("the Catalog and the surface editor read the contract's enum values the same way", async ({ page }) => {
  await page.goto("/");
  await newProject(page, "shadcn", "Enum vocabulary");

  // The shipped contract declares Button's `variant` as VALUE DESCRIPTORS
  // ({ value, description }) — one of dspack's two spec-valid enum shapes, and
  // the one this design system uses. The Catalog page joined the raw array, so
  // the page a person opens to learn the vocabulary showed [object Object] ten
  // times over.
  await page.getByTestId("nav-inventory").click();
  await page.getByTestId("inventory-button").click();
  const variant = page.getByTestId("prop-variant");
  await expect(variant).toContainText("destructive");
  await expect(variant).toContainText("ghost");
  await expect(variant).not.toContainText("[object Object]");
  // The per-value description the rich form exists to carry is not thrown away.
  await expect(variant.locator('[title*="irreversible"]')).toContainText("destructive");

  // The surface editor offers the SAME values from the SAME reader — the
  // vocabulary a person browses and the vocabulary they author with agree.
  await page.getByTestId("nav-surfaces").click();
  await authorSurface(page, { id: "variant-check", intent: "preference-settings", component: "button", text: "Delete workspace" });
  const select = page.getByTestId("node-prop-variant");
  await expect(select.locator("option", { hasText: "destructive" })).toHaveCount(1);
  await expect(select).not.toContainText("[object Object]");
  await select.selectOption("destructive");
  await expect(page.getByTestId("save-scenario")).toBeEnabled();
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
