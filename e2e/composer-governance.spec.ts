import { expect, test, type Page } from "@playwright/test";
import { newProject } from "./support/composer-browser";

/**
 * Governance authoring — intents and the four typed rules.
 *
 * The spec has no expression language by design, so the forms ARE the editor:
 * every rule is identifiers and value lists. These specs assert that authoring
 * through those forms genuinely changes what the project is checked against —
 * the rule fires, the impact panel names the surfaces it fires on, Checks
 * agrees, and removing it undoes exactly that.
 *
 * Read-only by construction (asserted as PRESENTATION, not as editing):
 * an existing intent row offers no edit or remove control — an intent can only
 * be added, or replaced by re-typing its id — so the intent assertions here
 * cover what the row must SHOW.
 */

const RATIONALE = "Every collection of records must be readable as a table so the columns can be scanned.";

/** "11 intents · 49 rules govern …" → [11, 49]. */
async function counts(page: Page): Promise<[number, number]> {
  const text = await page.getByTestId("governance-summary").innerText();
  const m = /(\d+) intents? · (\d+) rules?/.exec(text)!;
  return [Number(m[1]), Number(m[2])];
}

test("an intent needs a description before it can join the contract, and then it governs Build", async ({ page }) => {
  await page.goto("/");
  await newProject(page, "shadcn", "Intent authoring");
  await page.getByTestId("nav-governance").click();

  const [intentsBefore, rulesBefore] = await counts(page);

  // Every listed intent shows what a person needs to choose one: the name it
  // is called, the canonical id beside it, and what surfaces under it are FOR.
  const existing = page.getByTestId("intent-destructive-action");
  await expect(existing).toContainText("destructive-action");
  await expect(existing).not.toBeEmpty();

  // An id alone is not an intent: the description is structural, not optional.
  await page.getByTestId("intent-id").fill("audit-log");
  await expect(page.getByTestId("add-intent")).toBeDisabled();
  await page.getByTestId("intent-description").fill("too short");
  await expect(page.getByTestId("add-intent")).toBeDisabled();

  await page.getByTestId("intent-description").fill("Read-only records of who changed what, and when.");
  await expect(page.getByTestId("add-intent")).toBeEnabled();
  await page.getByTestId("add-intent").click();

  // It is a governed context now: listed with its description, counted, and
  // offered by Build's context override and the surface editor alike.
  const added = page.getByTestId("intent-audit-log");
  await expect(added).toContainText("audit-log");
  await expect(added).toContainText("Read-only records of who changed what, and when.");
  expect(await counts(page)).toEqual([intentsBefore + 1, rulesBefore]);

  await page.getByTestId("nav-build").click();
  await page.getByTestId("build-intent").selectOption("audit-log");
  await expect(page.getByTestId("build-intent")).toHaveValue("audit-log");
  await page.getByTestId("nav-surfaces").click();
  await page.getByTestId("new-scenario").click();
  await page.getByTestId("scenario-intent").selectOption("audit-log");
  await expect(page.getByTestId("scenario-intent")).toHaveValue("audit-log");
});

test("a rule cannot be saved without its rationale, and once saved it visibly fires on the surfaces it governs", async ({ page }) => {
  await page.goto("/");
  await newProject(page, "shadcn", "Rule authoring");
  await page.getByTestId("nav-governance").click();
  const [, rulesBefore] = await counts(page);

  // A component-choice rule: identifiers only, no expression to write.
  await page.getByTestId("rule-id").fill("require-a-table");
  await page.getByTestId("rule-type").selectOption("component-choice");
  await page.getByTestId("rule-require").getByText("table", { exact: true }).click();

  // The rationale gates the save — "if you cannot say why, it is not yet a rule".
  await expect(page.getByTestId("save-rule")).toBeDisabled();
  await expect(page.getByText("rationale first")).toBeVisible();
  await page.getByTestId("rule-rationale").fill(RATIONALE);
  await expect(page.getByText("rationale first")).toHaveCount(0);
  await expect(page.getByTestId("save-rule")).toBeEnabled();
  await page.getByTestId("save-rule").click();

  // The rule is in the contract, presented with the two things that make it
  // reviewable: what kind of rule it is, and why it exists.
  const row = page.getByTestId("rule-rule.require-a-table");
  await expect(row).toContainText("component-choice · must");
  await expect(row).toContainText(RATIONALE);
  expect((await counts(page))[1]).toBe(rulesBefore + 1);

  // The impact panel is the point of the whole view: every save re-lints every
  // surface, so the author sees what the rule fires on immediately.
  await expect(page.getByTestId("impact-ex.delete-account-confirmation")).toContainText("finding(s)");
  await expect(page.getByTestId("impact-ex.delete-account-confirmation")).toContainText("require-a-table");
  await expect(page.getByTestId("impact-ex.support-ticket-queue")).toContainText("clean");

  // Checks runs the same gates over the same corpus and reaches the same verdict.
  await page.getByTestId("nav-validate").click();
  await page.getByTestId("run-validate").click();
  await expect(page.getByTestId("validate-status")).toContainText("FAIL");
  await expect(page.getByTestId("finding-S3-rule.require-a-table").first()).toContainText(RATIONALE);

  // Removing the rule undoes exactly that, in both places.
  await page.getByTestId("nav-governance").click();
  await page.getByTestId("rule-rule.require-a-table").getByRole("button", { name: "remove" }).click();
  await expect(page.getByTestId("rule-rule.require-a-table")).toHaveCount(0);
  await expect(page.getByTestId("impact-ex.delete-account-confirmation")).toContainText("clean");
  await page.getByTestId("nav-validate").click();
  await page.getByTestId("run-validate").click();
  await expect(page.getByTestId("validate-status")).toContainText("PASS");
  await expect(page.getByTestId("finding-S3-rule.require-a-table")).toHaveCount(0);
});

test("the other rule types are form projections too: a required-props rule over a chosen component", async ({ page }) => {
  await page.goto("/");
  await newProject(page, "shadcn", "Typed rules");
  await page.getByTestId("nav-governance").click();

  await page.getByTestId("rule-id").fill("buttons-declare-a-variant");
  await page.getByTestId("rule-type").selectOption("required-props");

  // The type switch reshapes the form: a component picker appears, and the
  // prop rows only exist once a component is chosen.
  await expect(page.getByTestId("rule-component")).toBeVisible();
  await expect(page.getByTestId("add-required-prop")).toHaveCount(0);
  await page.getByTestId("rule-component").selectOption("button");
  await expect(page.getByTestId("add-required-prop")).toBeVisible();

  // The dependent control appears only when the requirement is switched on.
  await expect(page.getByRole("combobox").filter({ hasText: "on the node itself" })).toHaveCount(0);
  await page.getByTestId("rule-required-text").check();
  await expect(page.getByRole("combobox").filter({ hasText: "on the node itself" })).toHaveCount(1);

  // The prop list is the component's OWN declared descriptors — the vocabulary
  // constrains the rule, not free text.
  await page.getByTestId("add-required-prop").click();
  await page.getByTestId("rule-prop-0").selectOption("variant");
  await expect(page.getByTestId("rule-prop-0")).toHaveValue("variant");

  await page.getByTestId("rule-rationale").fill("A button's tone must be declared so destructive actions never read as ordinary ones.");
  await page.getByTestId("save-rule").click();

  const row = page.getByTestId("rule-rule.buttons-declare-a-variant");
  await expect(row).toContainText("required-props · must");
  await expect(row).toContainText("destructive actions never read as ordinary ones");

  // And it genuinely governs: surfaces whose buttons declare no variant now
  // carry a finding naming this rule.
  const impacted = page.locator('[data-testid^="impact-ex."]').filter({ hasText: "buttons-declare-a-variant" });
  await expect(impacted.first()).toContainText("finding(s)");
});

test("governance edits in a browser project are session-scoped, and the view says so", async ({ page }) => {
  await page.goto("/");
  await newProject(page, "shadcn", "Session scope");
  await page.getByTestId("nav-governance").click();
  const [intentsBefore, rulesBefore] = await counts(page);

  // The honesty this pins is the view's own: a browser project has no
  // repository to write governance into, and it does not pretend otherwise.
  await expect(page.getByText("connect the local agent to save them to your repository")).toBeVisible();

  await page.getByTestId("intent-id").fill("audit-log");
  await page.getByTestId("intent-description").fill("Read-only records of who changed what, and when.");
  await page.getByTestId("add-intent").click();
  expect(await counts(page)).toEqual([intentsBefore + 1, rulesBefore]);

  await page.reload();
  await expect(page.getByTestId("build-prompt")).toBeVisible();
  await page.getByTestId("nav-governance").click();
  expect(await counts(page)).toEqual([intentsBefore, rulesBefore]);
  await expect(page.getByTestId("intent-audit-log")).toHaveCount(0);
});
