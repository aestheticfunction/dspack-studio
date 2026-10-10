/**
 * Interface blocks (docs/BLOCKS.md, Phase 1A) in the EXPERIMENTAL composer
 * artifact (apps/composer/out-experimental), served agent-free. Every spec
 * stubs /api/models and /api/propose: no model is called, and the block-mode
 * request shapes are asserted from what the page actually posts.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

type Json = Record<string, any>;
const sidecar = JSON.parse(readFileSync(fileURLToPath(new URL("../apps/composer/experimental/blocks/shadcn-v3.blocks.json", import.meta.url)), "utf8")) as Json;
const exampleCall = (block: string) => (sidecar.blocks as Json[]).find((b) => b.id === block)!.examples[0].call as Json;

// The scan covers what this phase adds (the Settings section, the Block row,
// the note, the receipt). The rendered surface canvas is excluded: the
// wireframe fallback's annotation chips (data-wire="state", 10-11px at low
// opacity) fail the contrast rule on their own, outside this change.
const scan = (page: Page) =>
  new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).disableRules(["region"]).exclude('[data-testid^="build-canvas-"]').analyze();

async function newProject(page: Page, name: string) {
  await page.getByTestId("nav-projects").click();
  await page.getByTestId("new-project-name").fill(name);
  await page.getByTestId("new-source-shadcn").click();
  await page.getByTestId("new-project-create").click();
  await expect(page.getByTestId("build-prompt")).toBeVisible();
}

const preferenceOn = (page: Page) =>
  page.addInitScript(() => {
    localStorage.setItem("composer.experimental.v1", JSON.stringify({ blocks: true }));
  });

/** The deployed origin offers Hosted; /api/propose answers from `answer` and keeps every body. */
async function stubGateway(page: Page, answer: (body: Json, kind: "plan" | "block" | "generation", n: number) => { status: number; body: unknown }) {
  const bodies: Array<{ kind: "plan" | "block" | "generation"; body: Json }> = [];
  await page.route("**/api/models", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ models: ["scripted", "hosted-ai"] }) }),
  );
  await page.route("**/api/propose", (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as Json;
    const schema = (body.jsonSchema ?? {}) as Json;
    const kind = "$defs" in schema ? "generation" : schema.properties?.block?.const || schema.anyOf ? "block" : "plan";
    bodies.push({ kind, body });
    const reply = answer(body, kind, bodies.length - 1);
    return route.fulfill({ status: reply.status, contentType: "application/json", body: JSON.stringify(reply.body) });
  });
  return bodies;
}
const ok = (json: unknown) => ({ status: 200, body: { json, raw: JSON.stringify(json), model: "claude-haiku-4.5", usage: { inputTokens: 1000, outputTokens: 50 }, calls: [{ inputTokens: 1000, outputTokens: 50, outcome: "ok", durationMs: 400 }] } });
const planFor = (intent: string, block: string | null) => ok({ intent, feasible: true, restated: `A ${intent} surface.`, reason: "it fits", block, blockReason: block ? `the goal is a ${block}` : "nothing fits" });
const providerDown = () => ({ status: 502, body: { error: "provider-unavailable", cause: "provider", message: "The shared generation gateway is busy right now.", usage: null, calls: [{ inputTokens: null, outputTokens: null, outcome: "provider-error", durationMs: 45000 }] } });

test("the Settings preference persists across a reload, and each reference reports its draft blocks", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-settings").click();
  const toggle = page.getByTestId("experimental-blocks");
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(page.getByTestId("experimental-blocks-shadcn")).toContainText(/binding ok/);
  await expect(page.getByTestId("experimental-blocks-shadcn")).toContainText("auth-form (draft)");
  await expect(page.getByTestId("experimental-blocks-astryx")).toContainText("records-table (draft)");
  await page.reload();
  await page.getByTestId("nav-settings").click();
  await expect(page.getByTestId("experimental-blocks")).toBeChecked();
  expect((await scan(page)).violations).toEqual([]);
});

test("scripted: a sign-in goal on shadcn expands auth-form at attempt 0, passes, costs no model call, and accepts with provenance", async ({ page }) => {
  await preferenceOn(page);
  await page.goto("/");
  await newProject(page, "Blocks scripted");
  await page.getByTestId("build-model").selectOption("scripted");
  await page.getByTestId("build-intent").selectOption("structured-input");
  await page.getByTestId("build-prompt").fill("a sign-in form with email and password");
  await page.getByTestId("build-run").click();
  await expect(page.getByTestId("build-gate-summary-1")).toContainText("Follows your design-system rules", { timeout: 30_000 });

  const row = page.getByTestId("build-block-1");
  await expect(row).toContainText("block auth-form v1");
  await expect(row).toContainText("expanded");
  await expect(page.getByTestId("build-block-note-1")).toContainText("Interface block: auth-form");
  await expect(page.getByTestId("build-pipeline-1")).toContainText("outcome: passed");
  await expect(page.getByTestId("build-receipt-1")).toContainText("no model calls (scripted)");
  await expect(page.getByTestId("build-canvas-1")).toContainText(/sign in/i);
  expect((await scan(page)).violations).toEqual([]);

  await page.getByTestId("build-accept-1").click();
  await expect(page.getByTestId("build-accepted-1")).toContainText(/ex\.chat-\d+/);
  const provenance = await page.evaluate(() => {
    const out: Record<string, unknown> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      if (key.startsWith("composer.project.blocks.")) out[key] = JSON.parse(localStorage.getItem(key)!);
    }
    return out;
  });
  const maps = Object.values(provenance) as Json[];
  expect(maps).toHaveLength(1);
  const entry = Object.values(maps[0]!)[0] as Json;
  expect(entry).toMatchObject({ v: 1, block: "auth-form", version: 1, intent: "structured-input", encoding: "named" });
  expect(entry.expansionDigest).toMatch(/^[0-9a-f]{64}$/);
  expect(Object.keys(entry.call).every((k) => ["block", "version", "mode", "title", "fields", "intro", "providers", "recovery"].includes(k))).toBe(true);
  await expect(row).toContainText(String(entry.expansionDigest).slice(0, 12));
});

test("hosted: the planner is asked which block; one block call with maxCalls 1 expands records-table, and nothing else is posted", async ({ page }) => {
  await preferenceOn(page);
  const bodies = await stubGateway(page, (_body, kind) => (kind === "plan" ? planFor("record-collection", "records-table") : kind === "block" ? ok(exampleCall("records-table")) : providerDown()));
  await page.goto("/");
  await newProject(page, "Blocks hosted");
  await page.getByTestId("build-model").selectOption("hosted-ai");
  await page.getByTestId("build-prompt").fill("a queue of open support tickets with status and priority");
  await page.getByTestId("build-run").click();
  await expect(page.getByTestId("build-gate-summary-1")).toContainText("Follows your design-system rules", { timeout: 30_000 });

  expect(bodies.map((b) => b.kind)).toEqual(["plan", "block"]);
  expect(bodies[0]!.body.jsonSchema.required).toEqual(expect.arrayContaining(["block", "blockReason"]));
  expect(bodies[0]!.body.jsonSchema.properties.block.enum).toEqual(["records-table", "auth-form", "guide-steps", null]);
  expect(bodies[0]!.body).not.toHaveProperty("maxCalls");
  expect(bodies[1]!.body.maxCalls).toBe(1);
  expect(bodies[1]!.body.jsonSchema.properties.block.const).toBe("records-table");
  expect(bodies[1]!.body.jsonSchema).not.toHaveProperty("$defs");
  await expect(page.getByTestId("build-block-1")).toContainText("block records-table v1 · 1 model call");
  await expect(page.getByTestId("build-pipeline-1")).toContainText("outcome: passed");
  await expect(page.getByTestId("build-receipt-1")).toContainText("2 model calls (plan 1, block 1)");
});

test("hosted: a provider failure on the block repair ends as failed-adapter, the Block row and a budget-aware failure stay visible, and no further call is made", async ({ page }) => {
  await preferenceOn(page);
  const bodies = await stubGateway(page, (_body, kind, n) => (kind === "plan" ? planFor("record-collection", "records-table") : n === 1 ? ok({ block: "records-table", version: 1, title: "Tickets" }) : providerDown()));
  await page.goto("/");
  await newProject(page, "Blocks failure");
  await page.getByTestId("build-model").selectOption("hosted-ai");
  await page.getByTestId("build-prompt").fill("a queue of open support tickets with status and priority");
  await page.getByTestId("build-run").click();
  await expect(page.getByTestId("build-failure-1")).toBeVisible({ timeout: 30_000 });

  expect(bodies.map((b) => b.kind)).toEqual(["plan", "block", "block"]);
  await expect(page.getByTestId("build-failure-1")).toContainText("during the block call");
  await expect(page.getByTestId("build-failure-1")).toContainText("2 block calls preceded this run");
  await expect(page.getByTestId("build-block-1")).toContainText("provider failure");
  await expect(page.getByTestId("build-block-1")).toContainText("call 1 invalid · B1");
  await expect(page.getByTestId("build-pipeline-1")).toContainText("outcome: failed-adapter");
  await expect(page.getByTestId("build-receipt-1")).toContainText("3 model calls (plan 1, block 1, block-repair 1)");
});

test("with the preference off, a hosted build posts today's plan request and shows no Block row", async ({ page }) => {
  const bodies = await stubGateway(page, (_body, kind) => (kind === "plan" ? planFor("record-collection", null) : providerDown()));
  await page.goto("/");
  await newProject(page, "Blocks off");
  await page.getByTestId("build-model").selectOption("hosted-ai");
  await page.getByTestId("build-prompt").fill("a queue of open support tickets with status and priority");
  await page.getByTestId("build-run").click();
  await expect(page.getByTestId("build-failure-1")).toBeVisible({ timeout: 30_000 });
  expect(bodies.map((b) => b.kind)).toEqual(["plan", "generation"]);
  expect(bodies[0]!.body.jsonSchema.properties).not.toHaveProperty("block");
  expect(bodies[0]!.body).not.toHaveProperty("maxCalls");
  expect(bodies[1]!.body).not.toHaveProperty("maxCalls");
  await expect(page.getByTestId("build-block-1")).toHaveCount(0);
  await expect(page.getByTestId("build-block-note-1")).toHaveCount(0);
});

test("an imported project is never offered blocks: no block question in the plan request, no Block row, and the note says why", async ({ page }) => {
  await preferenceOn(page);
  const bodies = await stubGateway(page, (_body, kind) => (kind === "plan" ? planFor("record-collection", null) : providerDown()));
  const contract = JSON.parse(readFileSync(fileURLToPath(new URL("../apps/composer/shadcn-v3-project/shadcn-ui.dspack.json", import.meta.url)), "utf8"));
  const profile = JSON.parse(readFileSync(fileURLToPath(new URL("../apps/composer/shadcn-v3-project/shadcn-v3.profile.json", import.meta.url)), "utf8"));
  const file = { composerProjectExport: "0.1", exportedAt: "2026-10-10T00:00:00.000Z", name: "Imported", description: "", previewRegistry: "shadcn", contract, profile };
  await page.goto("/");
  await page.getByTestId("nav-projects").click();
  await page.getByTestId("import-project-input").setInputFiles({ name: "imported.composerproject.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });
  await expect(page.getByTestId("build-prompt")).toBeVisible();
  await page.getByTestId("build-model").selectOption("hosted-ai");
  await page.getByTestId("build-prompt").fill("a queue of open support tickets with status and priority");
  await page.getByTestId("build-run").click();
  await expect(page.getByTestId("build-failure-1")).toBeVisible({ timeout: 30_000 });
  expect(bodies.map((b) => b.kind)).toEqual(["plan", "generation"]);
  expect(bodies[0]!.body.jsonSchema.properties).not.toHaveProperty("block");
  expect(bodies[0]!.body).not.toHaveProperty("maxCalls");
  await expect(page.getByTestId("build-block-1")).toHaveCount(0);
  await expect(page.getByTestId("build-block-note-1")).toContainText("imported-project");
});

test("positive control: the experimental artifact really carries the block code the default build must not", () => {
  const chunks = fileURLToPath(new URL("../apps/composer/out-experimental/_next/static/chunks/", import.meta.url));
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${dir}${entry.name}/`);
      else if (entry.name.endsWith(".js")) files.push(`${dir}${entry.name}`);
    }
  };
  walk(chunks);
  const carrying = files.filter((file) => readFileSync(file, "utf8").includes("blocksSidecar"));
  expect(carrying.length).toBeGreaterThan(0);
});
