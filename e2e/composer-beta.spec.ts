/**
 * The beta's runtime switch (docs/blocks/PHASE-2-RELEASE-PLAN.md, §6, layer 4)
 * in the EXPERIMENTAL composer artifact, served agent-free. Before every build
 * the page reads the switch from /api/models. These specs stub that reply as
 * the beta Worker sends it (apps/composer/worker/blocks-beta.mjs) and stub
 * /api/propose, so no model is called. With blocks off, or on a reference the
 * switch does not list, the page posts today's bytes: planning bodies hash to
 * the request goldens in packages/block-bench/results.json, and so do
 * generation bodies wherever the planner restates the goal verbatim (a fresh
 * build generates for the restatement).
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

type Json = Record<string, any>;
const read = (rel: string) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")) as Json;
const results = read("../packages/block-bench/results.json");
const astryxSidecar = read("../apps/composer/experimental/blocks/astryx.blocks.json");
const exampleCall = (block: string) => (astryxSidecar.blocks as Json[]).find((b) => b.id === block)!.examples[0].call as Json;
const sha256 = (body: string) => createHash("sha256").update(body, "utf8").digest("hex");
const goldens = (reference: string) => results.references.find((r: Json) => r.reference === reference).requests as Json;
const planGolden = (reference: string, goal: string) => (goldens(reference).planning as Json[]).find((g) => g.kind === "plan" && g.goal === goal)!.bodySha256 as string;
const generationGolden = (reference: string, intent: string, prompt: string) =>
  (goldens(reference).generation as Json[]).find((g) => g.mode === "fresh" && g.intent === intent && g.prompt === prompt)!.bodySha256 as string;

const BLOCKS = ["records-table", "auth-form", "guide-steps"];
/** The owner's switch, as the beta Worker reports it. */
const OWNER = { enabled: true, references: ["astryx"], blocks: BLOCKS };
const MODELS = ["scripted", "hosted-ai"];
const TICKETS = "a queue of open support tickets with status and priority";
const TRIAGE = "a triage view of open support tickets with status and priority";

type Reply = { status: number; body: string; contentType?: string };
const json = (body: unknown, status = 200): Reply => ({ status, body: JSON.stringify(body) });
const ok = (out: unknown) => json({ json: out, raw: JSON.stringify(out), model: "claude-haiku-4.5", usage: { inputTokens: 1000, outputTokens: 50 }, calls: [{ inputTokens: 1000, outputTokens: 50, outcome: "ok", durationMs: 400 }] });
/** A fresh build generates for the plan's restatement, so a golden-checked generation needs the goal restated verbatim. */
const planFor = (intent: string, block: string | null, restated = `A ${intent} surface.`) =>
  ok({ intent, feasible: true, restated, reason: "it fits", block, blockReason: block ? `the goal is a ${block}` : "nothing fits" });
const providerDown = () =>
  json({ error: "provider-unavailable", cause: "provider", message: "down", usage: null, calls: [{ inputTokens: null, outputTokens: null, outcome: "provider-error", durationMs: 45000 }] }, 502);

const preferenceOn = (page: Page) =>
  page.addInitScript(() => {
    localStorage.setItem("composer.experimental.v1", JSON.stringify({ blocks: true }));
  });

/**
 * /api/models answers `models.current`, read again on every request, so a
 * spec can change the switch between builds. /api/propose answers from
 * `answer` and keeps every body exactly as posted.
 */
async function stubBeta(page: Page, initial: Reply, answer: (kind: "plan" | "block" | "generation", n: number) => Reply) {
  const models = { current: initial };
  const posts: Array<{ kind: "plan" | "block" | "generation"; raw: string; body: Json }> = [];
  await page.route("**/api/models", (route) => route.fulfill({ status: models.current.status, contentType: models.current.contentType ?? "application/json", body: models.current.body }));
  await page.route("**/api/propose", (route) => {
    const raw = route.request().postData() ?? "";
    const body = JSON.parse(raw || "{}") as Json;
    const schema = (body.jsonSchema ?? {}) as Json;
    const kind = "$defs" in schema ? "generation" : schema.properties?.block?.const || schema.anyOf ? "block" : "plan";
    posts.push({ kind, raw, body });
    const reply = answer(kind, posts.length - 1);
    return route.fulfill({ status: reply.status, contentType: "application/json", body: reply.body });
  });
  return { models, posts };
}

async function newProject(page: Page, name: string, source: "astryx" | "shadcn") {
  await page.getByTestId("nav-projects").click();
  await page.getByTestId("new-project-name").fill(name);
  await page.getByTestId(`new-source-${source}`).click();
  await page.getByTestId("new-project-create").click();
  await expect(page.getByTestId("build-prompt")).toBeVisible();
}

async function build(page: Page, goal: string) {
  await page.getByTestId("build-prompt").fill(goal);
  await page.getByTestId("build-run").click();
}

test("the owner's switch: an Astryx project is offered every approved block, and records-table expands from one named block call", async ({ page }) => {
  await preferenceOn(page);
  const { posts } = await stubBeta(page, json({ models: MODELS, blocks: OWNER }), (kind) =>
    kind === "plan" ? planFor("record-collection", "records-table") : kind === "block" ? ok(exampleCall("records-table")) : providerDown(),
  );
  await page.goto("/");
  await newProject(page, "Beta Astryx", "astryx");
  await page.getByTestId("build-model").selectOption("hosted-ai");
  await build(page, TICKETS);
  await expect(page.getByTestId("build-gate-summary-1")).toContainText("Follows your design-system rules", { timeout: 30_000 });

  expect(posts.map((p) => p.kind)).toEqual(["plan", "block"]);
  expect(posts[0]!.body.jsonSchema.properties.block.enum).toEqual([...BLOCKS, null]);
  expect(posts[0]!.body).not.toHaveProperty("maxCalls");
  expect(posts[1]!.body.maxCalls).toBe(1);
  expect(posts[1]!.body.jsonSchema.properties.block.const).toBe("records-table");
  expect(posts[1]!.body.jsonSchema.properties).not.toHaveProperty("b");
  await expect(page.getByTestId("build-block-1")).toContainText("block records-table v1 · 1 model call");
  await expect(page.getByTestId("build-pipeline-1")).toContainText("outcome: passed");
});

test("the owner's switch: a shadcn/ui v3 project gets no blocks, the note says why, and the page posts today's bytes", async ({ page }) => {
  await preferenceOn(page);
  const { posts } = await stubBeta(page, json({ models: MODELS, blocks: OWNER }), (kind) => (kind === "plan" ? planFor("record-collection", null, TICKETS) : providerDown()));
  await page.goto("/");
  await newProject(page, "Beta shadcn", "shadcn");
  await page.getByTestId("build-model").selectOption("hosted-ai");
  await build(page, TICKETS);
  await expect(page.getByTestId("build-failure-1")).toBeVisible({ timeout: 30_000 });

  expect(posts.map((p) => p.kind)).toEqual(["plan", "generation"]);
  expect(sha256(posts[0]!.raw)).toBe(planGolden("shadcn-v3", TICKETS));
  expect(sha256(posts[1]!.raw)).toBe(generationGolden("shadcn-v3", "record-collection", TICKETS));
  const note = page.getByTestId("build-block-note-1");
  await expect(note).toContainText("reference-not-in-beta");
  await expect(note).toContainText("shadcn/ui v3 blocks are withheld from this beta: their evaluation remains inconclusive");
  await expect(page.getByTestId("build-block-1")).toHaveCount(0);
});

/** [reason, how, the reply at load, the reply at the build when it differs] */
const OFF: Array<[string, string, Reply, Reply | null]> = [
  ["missing", "production's reply, with no switch", json({ models: MODELS }), null],
  ["malformed", "the Worker could not read its variable", json({ models: MODELS, blocks: { enabled: false, reason: "malformed" } }), null],
  ["malformed", "a reply that names an unknown reference", json({ models: MODELS, blocks: { ...OWNER, references: ["material"] } }), null],
  ["disabled", "switched off", json({ models: MODELS, blocks: { enabled: false, reason: "disabled" } }), null],
  ["unreadable", "the read fails", json({ models: MODELS, blocks: OWNER }), json({ error: "unavailable" }, 500)],
  ["unreadable", "the static host's HTML page", json({ models: MODELS, blocks: OWNER }), { status: 200, contentType: "text/html", body: "<!doctype html><html></html>" }],
];

for (const [reason, how, initial, atBuild] of OFF) {
  test(`a ${reason} switch (${how}) offers no blocks on Astryx: today's bytes, and the note says why`, async ({ page }) => {
    await preferenceOn(page);
    const { models, posts } = await stubBeta(page, initial, (kind) => (kind === "plan" ? planFor("record-collection", null) : providerDown()));
    await page.goto("/");
    await newProject(page, `Beta off ${reason}`, "astryx");
    await page.getByTestId("build-model").selectOption("hosted-ai");
    // The model list is read once, at load; the switch, at every build.
    if (atBuild) models.current = atBuild;
    await build(page, TICKETS);
    await expect(page.getByTestId("build-failure-1")).toBeVisible({ timeout: 30_000 });

    expect(posts.map((p) => p.kind)).toEqual(["plan", "generation"]);
    expect(sha256(posts[0]!.raw)).toBe(planGolden("astryx", TICKETS));
    for (const post of posts) expect(post.body).not.toHaveProperty("maxCalls");
    await expect(page.getByTestId("build-block-note-1")).toContainText(`beta-switch-${reason}`);
    await expect(page.getByTestId("build-block-1")).toHaveCount(0);
  });
}

test("with blocks off, an Astryx generation request is today's, byte for byte", async ({ page }) => {
  await preferenceOn(page);
  const { posts } = await stubBeta(page, json({ models: MODELS, blocks: { enabled: false, reason: "disabled" } }), (kind) => (kind === "plan" ? planFor("record-collection", null, TRIAGE) : providerDown()));
  await page.goto("/");
  await newProject(page, "Beta off generation", "astryx");
  await page.getByTestId("build-model").selectOption("hosted-ai");
  await build(page, TRIAGE);
  await expect(page.getByTestId("build-failure-1")).toBeVisible({ timeout: 30_000 });
  expect(posts.map((p) => p.kind)).toEqual(["plan", "generation"]);
  expect(posts[0]!.body.jsonSchema.properties).not.toHaveProperty("block");
  expect(sha256(posts[1]!.raw)).toBe(generationGolden("astryx", "record-collection", TRIAGE));
});

test("an imported Astryx project under the owner's switch gets no blocks, the note says why, and the page posts today's bytes", async ({ page }) => {
  await preferenceOn(page);
  const { posts } = await stubBeta(page, json({ models: MODELS, blocks: OWNER }), (kind) => (kind === "plan" ? planFor("record-collection", null, TRIAGE) : providerDown()));
  const contract = read("../apps/composer/astryx-project/astryx.dspack.json");
  const profile = read("../apps/composer/astryx-project/astryx.profile.json");
  const file = { composerProjectExport: "0.1", exportedAt: "2026-10-16T00:00:00.000Z", name: "Imported Astryx", description: "", previewRegistry: "astryx", contract, profile };
  await page.goto("/");
  await page.getByTestId("nav-projects").click();
  await page.getByTestId("import-project-input").setInputFiles({ name: "imported.composerproject.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });
  await expect(page.getByTestId("build-prompt")).toBeVisible();
  await page.getByTestId("build-model").selectOption("hosted-ai");
  await build(page, TRIAGE);
  await expect(page.getByTestId("build-failure-1")).toBeVisible({ timeout: 30_000 });

  expect(posts.map((p) => p.kind)).toEqual(["plan", "generation"]);
  expect(posts[0]!.body.jsonSchema.properties).not.toHaveProperty("block");
  expect(sha256(posts[1]!.raw)).toBe(generationGolden("astryx", "record-collection", TRIAGE));
  await expect(page.getByTestId("build-block-note-1")).toContainText("imported-project");
  await expect(page.getByTestId("build-block-1")).toHaveCount(0);
});

test("opted in and eligible, a null selection still posts today's generation bytes", async ({ page }) => {
  await preferenceOn(page);
  const { posts } = await stubBeta(page, json({ models: MODELS, blocks: OWNER }), (kind) => (kind === "plan" ? planFor("record-collection", null, TRIAGE) : providerDown()));
  await page.goto("/");
  await newProject(page, "Beta null selection", "astryx");
  await page.getByTestId("build-model").selectOption("hosted-ai");
  await build(page, TRIAGE);
  await expect(page.getByTestId("build-failure-1")).toBeVisible({ timeout: 30_000 });

  expect(posts.map((p) => p.kind)).toEqual(["plan", "generation"]);
  // The planning request asks the block question, by design; the generation request does not change.
  expect(posts[0]!.body.jsonSchema.properties.block.enum).toEqual([...BLOCKS, null]);
  expect(sha256(posts[1]!.raw)).toBe(generationGolden("astryx", "record-collection", TRIAGE));
  await expect(page.getByTestId("build-block-1")).toHaveCount(0);
});

test("a switch turned off applies to the next build, with no reload", async ({ page }) => {
  await preferenceOn(page);
  const { models, posts } = await stubBeta(page, json({ models: MODELS, blocks: OWNER }), (kind, n) =>
    kind === "plan" ? planFor("record-collection", n === 0 ? "records-table" : null) : kind === "block" ? ok(exampleCall("records-table")) : providerDown(),
  );
  await page.goto("/");
  await newProject(page, "Beta switch off", "astryx");
  await page.getByTestId("build-model").selectOption("hosted-ai");
  await build(page, TICKETS);
  await expect(page.getByTestId("build-gate-summary-1")).toContainText("Follows your design-system rules", { timeout: 30_000 });
  await expect(page.getByTestId("build-block-1")).toContainText("block records-table v1");

  models.current = json({ models: MODELS, blocks: { enabled: false, reason: "disabled" } });
  await build(page, TICKETS);
  await expect(page.getByTestId("build-failure-2")).toBeVisible({ timeout: 30_000 });
  expect(posts.map((p) => p.kind)).toEqual(["plan", "block", "plan", "generation"]);
  expect(sha256(posts[2]!.raw)).toBe(planGolden("astryx", TICKETS));
  await expect(page.getByTestId("build-block-note-2")).toContainText("beta-switch-disabled");
  await expect(page.getByTestId("build-block-2")).toHaveCount(0);
});

test("a block surface accepted after the switch goes off still records its provenance", async ({ page }) => {
  await preferenceOn(page);
  const { models } = await stubBeta(page, json({ models: MODELS, blocks: OWNER }), (kind) =>
    kind === "plan" ? planFor("record-collection", "records-table") : kind === "block" ? ok(exampleCall("records-table")) : providerDown(),
  );
  await page.goto("/");
  await newProject(page, "Beta accept after off", "astryx");
  await page.getByTestId("build-model").selectOption("hosted-ai");
  await build(page, TICKETS);
  await expect(page.getByTestId("build-gate-summary-1")).toContainText("Follows your design-system rules", { timeout: 30_000 });
  await expect(page.getByTestId("build-block-1")).toContainText("block records-table v1");

  models.current = json({ models: MODELS, blocks: { enabled: false, reason: "disabled" } });
  await page.getByTestId("build-accept-1").click();
  await expect(page.getByTestId("build-accepted-1")).toContainText(/ex\.chat-\d+/);
  const provenance = () =>
    page.evaluate(() => {
      const entries: unknown[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)!;
        if (key.startsWith("composer.project.blocks.")) entries.push(...Object.values(JSON.parse(localStorage.getItem(key)!) as Record<string, unknown>));
      }
      return entries as Array<Record<string, unknown>>;
    });
  await expect.poll(async () => (await provenance()).length, { timeout: 10_000 }).toBe(1);
  expect((await provenance())[0]).toMatchObject({ v: 1, block: "records-table", version: 1, encoding: "named" });
});

test("a switch that lists two blocks offers only those, in sidecar order", async ({ page }) => {
  await preferenceOn(page);
  const { posts } = await stubBeta(page, json({ models: MODELS, blocks: { ...OWNER, blocks: ["guide-steps", "records-table"] } }), (kind) =>
    kind === "plan" ? planFor("record-collection", null) : providerDown(),
  );
  await page.goto("/");
  await newProject(page, "Beta two blocks", "astryx");
  await page.getByTestId("build-model").selectOption("hosted-ai");
  await build(page, TICKETS);
  await expect(page.getByTestId("build-failure-1")).toBeVisible({ timeout: 30_000 });
  expect(posts[0]!.body.jsonSchema.properties.block.enum).toEqual(["records-table", "guide-steps", null]);
});

test("the preference is off on a fresh origin: the owner's switch alone offers nothing, and the page posts today's bytes", async ({ page }) => {
  const { posts } = await stubBeta(page, json({ models: MODELS, blocks: OWNER }), (kind) => (kind === "plan" ? planFor("record-collection", null) : providerDown()));
  await page.goto("/");
  await page.getByTestId("nav-settings").click();
  await expect(page.getByTestId("experimental-blocks")).not.toBeChecked();
  await newProject(page, "Beta preference off", "astryx");
  await page.getByTestId("build-model").selectOption("hosted-ai");
  await build(page, TICKETS);
  await expect(page.getByTestId("build-failure-1")).toBeVisible({ timeout: 30_000 });
  expect(posts.map((p) => p.kind)).toEqual(["plan", "generation"]);
  expect(sha256(posts[0]!.raw)).toBe(planGolden("astryx", TICKETS));
  await expect(page.getByTestId("build-block-note-1")).toHaveCount(0);
});

test("positive control: the experimental artifact carries the beta switch", () => {
  const chunks = fileURLToPath(new URL("../apps/composer/out-experimental/_next/static/chunks/", import.meta.url));
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${dir}${entry.name}/`);
      else if (entry.name.endsWith(".js")) files.push(`${dir}${entry.name}`);
    }
  };
  walk(chunks);
  expect(files.filter((file) => readFileSync(file, "utf8").includes("reference-not-in-beta")).length).toBeGreaterThan(0);
});
