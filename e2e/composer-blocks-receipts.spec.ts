/**
 * Phase 2, step 5 (docs/blocks/PHASE-2-RELEASE-PLAN.md, §9) in the
 * EXPERIMENTAL composer artifact: the beta's receipt (block and surface
 * calls apart, the exact call budget, the refinement mode in words, each
 * call's served model) and the user-initiated diagnostics export. Agent-free:
 * /api/models and /api/propose are stubbed, and no model is called.
 *
 * The export is shapes only. Each test feeds the page sensitive-looking text
 * (the prompt, the planner's reasons, the model's output, which the surface
 * then shows) and proves none of it reaches the file, and that saving the
 * file sends nothing anywhere.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

type Json = Record<string, any>;
const sidecar = JSON.parse(readFileSync(fileURLToPath(new URL("../apps/composer/experimental/blocks/shadcn-v3.blocks.json", import.meta.url)), "utf8")) as Json;
const exampleCall = (block: string) => (sidecar.blocks as Json[]).find((b) => b.id === block)!.examples[0].call as Json;
const HAIKU = "claude-haiku-4-5-20251001";
const SWITCH_ON = { enabled: true, references: ["shadcn", "astryx"], blocks: ["records-table", "auth-form", "guide-steps"] };

const scanOf = (page: Page, selector: string) =>
  new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).disableRules(["region"]).include(selector).analyze();

async function newProject(page: Page, name: string) {
  await page.getByTestId("nav-projects").click();
  await page.getByTestId("new-project-name").fill(name);
  await page.getByTestId("new-source-shadcn").click();
  await page.getByTestId("new-project-create").click();
  await expect(page.getByTestId("build-prompt")).toBeVisible();
}

const preferenceOn = (page: Page) => page.addInitScript(() => localStorage.setItem("composer.experimental.v1", JSON.stringify({ blocks: true })));

async function scriptedBuild(page: Page, turn: number, prompt: string, refine = false) {
  await page.getByTestId("build-prompt").fill(prompt);
  await page.getByTestId(refine ? "build-refine" : "build-run").click();
  await expect(page.getByTestId(`build-gate-summary-${turn}`)).toContainText("Follows your design-system rules", { timeout: 30_000 });
}

test("scripted: the beta receipt states each turn's split, exact budget and refinement mode, and reaches no model", async ({ page }) => {
  await preferenceOn(page);
  await page.route("**/api/models", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ models: ["scripted"], blocks: SWITCH_ON }) }));
  await page.goto("/");
  await newProject(page, "Receipts scripted");
  await page.getByTestId("build-model").selectOption("scripted");
  await page.getByTestId("build-intent").selectOption("structured-input");

  await scriptedBuild(page, 1, "a sign-in form with email and password");
  const first = page.getByTestId("build-beta-receipt-1");
  await expect(first).toHaveText("block 1 request reached no model · surface no calls · budget 1 of 3 calls, 1 reached no model");

  await scriptedBuild(page, 2, "make the title say Welcome", true);
  await expect(page.getByTestId("build-beta-receipt-2")).toContainText("compact refinement: the block's call was revised");
  await expect(page.getByTestId("build-beta-receipt-2")).toContainText("budget 1 of 3 calls, 1 reached no model");

  await scriptedBuild(page, 3, "add a phone number field", true);
  await expect(page.getByTestId("build-beta-receipt-3")).toContainText("switched to a full-surface refinement: the reply said the block cannot express the change");
  await expect(page.getByTestId("build-beta-receipt-3")).toContainText("budget 2 of 3 calls, 2 reached no model");

  // The default receipt is unchanged, beside it.
  await expect(page.getByTestId("build-receipt-1")).toContainText("no model calls (scripted)");
  expect((await scanOf(page, '[data-testid^="build-beta-receipt-"]')).violations).toEqual([]);
});

test("hosted: the receipt splits provider-reported tokens and names each call's served model; every request names its operation", async ({ page }) => {
  await preferenceOn(page);
  const sent: Array<{ operation: string | undefined; body: Json }> = [];
  await page.route("**/api/models", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ models: ["scripted", "hosted-ai"], blocks: SWITCH_ON }) }));
  await page.route("**/api/propose", (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as Json;
    const plan = !body.jsonSchema?.properties?.block?.const;
    sent.push({ operation: route.request().headers()["x-composer-operation"], body });
    const json = plan
      ? { intent: "record-collection", feasible: true, restated: "A queue.", reason: "it fits", block: "records-table", blockReason: "a table of records" }
      : exampleCall("records-table");
    // The plan's reply names its model only at the top level (an older Worker); the block call names its own.
    const calls = plan ? [{ inputTokens: 2000, outputTokens: 30, outcome: "ok", durationMs: 300 }] : [{ inputTokens: 1000, outputTokens: 50, outcome: "ok", durationMs: 400, model: HAIKU }];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ json, raw: JSON.stringify(json), model: "claude-haiku-4.5", calls }) });
  });
  await page.goto("/");
  await newProject(page, "Receipts hosted");
  await page.getByTestId("build-model").selectOption("hosted-ai");
  await page.getByTestId("build-prompt").fill("a queue of open support tickets with status and priority");
  await page.getByTestId("build-run").click();
  await expect(page.getByTestId("build-gate-summary-1")).toContainText("Follows your design-system rules", { timeout: 30_000 });

  expect(sent.map((s) => s.operation)).toEqual(["plan", "block"]);
  for (const s of sent) expect(Object.keys(s.body)).not.toContain("operation");
  await expect(page.getByTestId("build-beta-receipt-1")).toHaveText(
    `block 1 model call: 1,000 input + 50 output tokens · surface no calls · budget 1 of 3 model calls · served by claude-haiku-4.5 (1 call), ${HAIKU} (1 call)`,
  );
  await expect(page.getByTestId("build-receipt-1")).toContainText("2 model calls (plan 1, block 1)");
});

test("the diagnostics export is user-initiated, holds shapes only, and sends nothing: no prompt, reason, output or surface text reaches the file", async ({ page }) => {
  await preferenceOn(page);
  const PROMPT = "SENTINEL-PROMPT: a queue of open support tickets for jane@example.com, password hunter2";
  await page.route("**/api/models", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ models: ["scripted", "hosted-ai"], blocks: SWITCH_ON }) }));
  await page.route("**/api/propose", (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as Json;
    const plan = !body.jsonSchema?.properties?.block?.const;
    const json = plan
      ? { intent: "record-collection", feasible: true, restated: "SENTINEL-RESTATED", reason: "SENTINEL-PLAN-REASON", block: "records-table", blockReason: "SENTINEL-BLOCK-REASON" }
      : { ...exampleCall("records-table"), title: "SENTINEL-OUTPUT-TITLE for jane@example.com" };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      // As the Worker replies: its usage, and each call with its own.
      body: JSON.stringify({ json, raw: JSON.stringify(json), model: HAIKU, usage: { inputTokens: 1000, outputTokens: 50 }, calls: [{ inputTokens: 1000, outputTokens: 50, outcome: "ok", durationMs: 400, model: HAIKU }] }),
    });
  });
  await page.goto("/");
  await newProject(page, "Diagnostics");
  await page.getByTestId("build-model").selectOption("hosted-ai");
  await page.getByTestId("build-prompt").fill(PROMPT);
  await page.getByTestId("build-run").click();
  await expect(page.getByTestId("build-gate-summary-1")).toContainText("Follows your design-system rules", { timeout: 30_000 });
  // The model's text really is on the page: the surface shows the title it wrote.
  await expect(page.getByTestId("build-canvas-1")).toContainText("SENTINEL-OUTPUT-TITLE");

  await page.getByTestId("nav-settings").click();
  const section = page.getByTestId("diagnostics");
  await expect(section).toContainText("never ADR-B3 decision evidence");
  const requests: string[] = [];
  page.on("request", (r) => requests.push(`${r.method()} ${r.url()}`));
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("diagnostics-export").click()]);
  await page.waitForTimeout(500);
  expect(requests).toEqual([]);
  expect(download.suggestedFilename()).toMatch(/^composer-beta-diagnostics-\d{8}T\d{6}Z\.json$/);

  const text = readFileSync((await download.path())!, "utf8");
  for (const forbidden of ["SENTINEL", "jane@example.com", "hunter2", "support tickets"]) expect(text, forbidden).not.toContain(forbidden);
  const file = JSON.parse(text) as Json;
  expect(Object.keys(file)).toEqual(["format", "version", "exportedAt", "notice", "turns"]);
  expect(file.format).toBe("composer-beta-diagnostics");
  expect(file.turns).toHaveLength(1);
  const turn = file.turns[0] as Json;
  expect(turn).toMatchObject({ modelRef: "hosted-ai", status: "finished", outcome: "passed", refinement: null, budget: { used: 1, limit: 3, reissues: 0, noModel: 0 } });
  expect(turn.calls.map((c: Json) => [c.operation, c.source, c.outcome, c.inputTokens, c.outputTokens, c.model])).toEqual([
    ["plan", "provider", "ok", 1000, 50, HAIKU],
    ["block", "provider", "ok", 1000, 50, HAIKU],
  ]);
  expect(turn.block).toMatchObject({ id: "records-table", version: 1, outcome: "block", providerCalls: 1 });
  // An attempt's figures can be a re-issue's sum; the file keeps each call's own instead.
  expect(Object.keys(turn.block.attempts[0]).sort()).toEqual(["b1Issues", "b2Issues", "durationMs", "index", "outcome"]);
  expect(typeof turn.timings.totalMs).toBe("number");
  expect((await scanOf(page, '[data-testid="diagnostics"]')).violations).toEqual([]);
});

test("with no builds yet, the export says so and saves nothing", async ({ page }) => {
  await preferenceOn(page);
  await page.goto("/");
  await page.getByTestId("nav-settings").click();
  await expect(page.getByTestId("diagnostics-export")).toBeDisabled();
  await expect(page.getByTestId("diagnostics")).toContainText("There are no builds listed in Build yet.");
  // What the file covers is the list Build shows, which opening, closing or importing a project starts afresh.
  await expect(page.getByTestId("diagnostics")).toContainText("the builds listed in Build");
});
