/**
 * Hosted generation fails closed (docs/incidents/2026-11-26-hosted-ai-inherited.md):
 *   - the Worker enables it only for the exact string "on": absent, invalid and "off" refuse before any
 *     provider call and offer no hosted model;
 *   - every deploy config declares HOSTED_AI "off", so no deploy inherits "on" from an earlier upload;
 *   - both deploy workflows and CI on main verify the effective configuration and the public API;
 *   - the verification script fails when the active deployment OR the latest upload is not "off".
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import * as worker from "../worker/propose.mjs";
import index from "../worker/index.mjs";
import { readConfig } from "../scripts/check-experimental-deploy.mjs";
import { checkEffectiveConfig, checkPublic, main } from "../scripts/verify-hosted-ai-off.mjs";

const repo = (rel) => fileURLToPath(new URL(`../../../${rel}`, import.meta.url));
const post = () => new Request("https://composer.test/api/propose", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });

const OFF = [
  ["absent", undefined],
  ["empty", ""],
  ["off", "off"],
  ["OFF", "OFF"],
  ["ON (wrong case)", "ON"],
  ["On", "On"],
  ["true", "true"],
  ["1", "1"],
  ["yes", "yes"],
  ["on with a leading space", " on"],
  ["on with a trailing space", "on "],
  ["a boolean true", true],
  ["a JSON object", { on: true }],
];

describe("the HOSTED_AI switch fails closed", () => {
  it.each(OFF)("%s: off, offered nowhere, refused before any provider call", async (_label, value) => {
    const run = vi.fn();
    const env = value === undefined ? { AI: { run } } : { HOSTED_AI: value, AI: { run } };
    expect(worker.hostedAiEnabled(env)).toBe(false);
    const models = await (await index.fetch(new Request("https://composer.test/api/models"), env)).json();
    expect(models.models).toEqual(["scripted"]);
    const res = await worker.handlePropose(post(), env);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("unavailable");
    expect(run).not.toHaveBeenCalled();
  });

  it('exactly "on", with the AI binding: offered', async () => {
    const env = { HOSTED_AI: "on", AI: { run: vi.fn() } };
    expect(worker.hostedAiEnabled(env)).toBe(true);
    expect((await (await index.fetch(new Request("https://composer.test/api/models"), env)).json()).models).toEqual(["scripted", "hosted-ai"]);
  });

  it('"on" without the AI binding: still off', async () => {
    expect((await (await index.fetch(new Request("https://composer.test/api/models"), { HOSTED_AI: "on" })).json()).models).toEqual(["scripted"]);
  });
});

describe("every composer deploy config sets hosted generation off explicitly", () => {
  for (const file of ["wrangler.jsonc", "wrangler.composer-experimental.jsonc"]) {
    it(`${file} declares HOSTED_AI "off" and keeps the dashboard's other switches`, () => {
      const c = readConfig(repo(file));
      expect(c.vars).toEqual({ HOSTED_AI: "off" });
      expect(c.keep_vars).toBe(true);
    });
  }

  it("the exhibit Worker is another Worker and has no hosted generation switch", () => {
    expect(readFileSync(repo("wrangler.exhibit.jsonc"), "utf8")).not.toMatch(/HOSTED_AI/);
  });
});

describe("both deploy paths verify hosted generation is off", () => {
  const yml = (f) => readFileSync(repo(`.github/workflows/${f}`), "utf8");
  it("the dispatched production deploy verifies configuration and public API after deploying", () => {
    const w = yml("deploy-composer.yml");
    const deploy = w.indexOf("wrangler deploy --config wrangler.jsonc");
    const verify = w.indexOf("node apps/composer/scripts/verify-hosted-ai-off.mjs");
    expect(deploy).toBeGreaterThan(-1);
    expect(verify).toBeGreaterThan(deploy);
  });

  it("the dispatched experimental deploy verifies configuration after deploying, with Access in front", () => {
    const w = yml("deploy-composer-experimental.yml");
    expect(w.indexOf("verify-hosted-ai-off.mjs")).toBeGreaterThan(w.indexOf("deploy --config wrangler.composer-experimental.jsonc"));
    expect(w).toMatch(/verify-hosted-ai-off\.mjs[^\n]*--expect-access/);
  });

  it("CI on main watches the public API while Workers Builds deploys the merge", () => {
    const w = yml("ci.yml");
    expect(w).toMatch(/verify-hosted-ai-off\.mjs --public-only --watch \d+/);
  });
});

/** A fake Cloudflare API: deployments, versions by id, and the version list. */
function cloudflare({ active, latest, versions }) {
  return async (url) => {
    const u = String(url);
    const ok = (result) => new Response(JSON.stringify({ success: true, result }), { status: 200 });
    if (u.endsWith("/accounts")) return ok([{ id: "acct" }]);
    if (u.includes("/deployments")) return ok({ deployments: [{ versions: active.map((id) => ({ version_id: id, percentage: 100 / active.length })) }] });
    if (u.includes("/versions?per_page=1")) return ok({ items: [{ id: latest }] });
    const id = u.split("/versions/")[1];
    const v = versions[id];
    return ok({ id, bindings: v === undefined ? [] : [{ type: "plain_text", name: "HOSTED_AI", text: v }] });
  };
}

describe("the verification script", () => {
  it("passes when the active version and the latest upload are both off", async () => {
    const r = await checkEffectiveConfig({ fetchImpl: cloudflare({ active: ["a"], latest: "b", versions: { a: "off", b: "off" } }), token: "t" });
    expect(r.problems).toEqual([]);
  });

  it("fails when the latest upload is on although the active version is off: the incident's pattern", async () => {
    const r = await checkEffectiveConfig({ fetchImpl: cloudflare({ active: ["a"], latest: "pilot", versions: { a: "off", pilot: "on" } }), token: "t" });
    expect(r.problems.join("\n")).toMatch(/latest upload.*pilot.*"on"/);
  });

  it("fails when the active version is on, absent or misspelled", async () => {
    for (const v of ["on", undefined, "OFF"]) {
      const r = await checkEffectiveConfig({ fetchImpl: cloudflare({ active: ["a"], latest: "a", versions: { a: v } }), token: "t" });
      expect(r.problems.length, String(v)).toBe(1);
    }
  });

  it("checks every version of a split deployment", async () => {
    const r = await checkEffectiveConfig({ fetchImpl: cloudflare({ active: ["a", "b"], latest: "a", versions: { a: "off", b: "on" } }), token: "t" });
    expect(r.problems.join("\n")).toMatch(/b has HOSTED_AI "on"/);
  });

  const site = (models, propose) => async (url) =>
    String(url).endsWith("/api/models") ? new Response(JSON.stringify({ models }), { status: 200 }) : new Response(JSON.stringify(propose.body), { status: propose.status });

  it("public: passes on scripted only and a 503 unavailable; fails when hosted-ai is offered or propose reaches the request", async () => {
    expect((await checkPublic({ fetchImpl: site(["scripted"], { status: 503, body: { error: "unavailable" } }) })).problems).toEqual([]);
    expect((await checkPublic({ fetchImpl: site(["scripted", "hosted-ai"], { status: 503, body: { error: "unavailable" } }) })).problems).toHaveLength(1);
    expect((await checkPublic({ fetchImpl: site(["scripted"], { status: 400, body: { error: "bad-request" } }) })).problems).toHaveLength(1);
  });

  it("with --expect-access, only Cloudflare Access may answer", async () => {
    const access = async () => new Response("", { status: 302, headers: { location: "https://team.cloudflareaccess.com/login" } });
    expect((await checkPublic({ fetchImpl: access, expectAccess: true })).problems).toEqual([]);
    expect((await checkPublic({ fetchImpl: site(["scripted"], { status: 503, body: { error: "unavailable" } }), expectAccess: true })).problems).toHaveLength(2);
  });

  it("main: exit 1 on a problem, 2 without a token, 0 when all is off; --watch repeats until its deadline", async () => {
    const lines = [];
    const log = (l) => lines.push(l);
    const api = cloudflare({ active: ["a"], latest: "b", versions: { a: "off", b: "on" } });
    expect(await main(["--config-only"], { CLOUDFLARE_API_TOKEN: "t" }, { fetchImpl: api, log })).toBe(1);
    expect(await main(["--config-only"], {}, { fetchImpl: api, log })).toBe(2);
    let calls = 0;
    const counting = async (url) => (calls++, site(["scripted"], { status: 503, body: { error: "unavailable" } })(url));
    let clock = 0;
    const realNow = Date.now;
    Date.now = () => clock;
    try {
      expect(await main(["--public-only", "--watch", "90"], {}, { fetchImpl: counting, log, sleep: async (ms) => void (clock += ms) })).toBe(0);
    } finally {
      Date.now = realNow;
    }
    expect(calls).toBe(8); // rounds at 0, 30, 60 and 90 s, two requests each
  });
});
