/**
 * The beta deploy path (docs/blocks/PHASE-2-RELEASE-PLAN.md, §6, layer 2;
 * docs/deployment.md, "The beta composer"). The beta is a second Worker on its
 * own hostname, serving the experimental artifact behind Cloudflare Access,
 * deployed only by a dispatched workflow. These tests hold the configs, the
 * artifact check, the Access check and the workflows to that, so a change that
 * would deploy the wrong artifact, expose the beta or touch production fails.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { WRANGLER, checkAccess, checkArtifact, checkConfigs, readConfig } from "../scripts/check-beta-deploy.mjs";

const repo = (rel) => fileURLToPath(new URL(`../../../${rel}`, import.meta.url));
const production = () => readConfig(repo("wrangler.jsonc"));
const beta = () => readConfig(repo("wrangler.composer-beta.jsonc"));
const problems = (overrides = {}) => checkConfigs({ production: overrides.production ?? production(), beta: overrides.beta ?? beta() });

describe("the configs", () => {
  it("the committed production and beta configs pass", () => {
    expect(problems()).toEqual([]);
  });

  it("readConfig reads JSONC, comments included, and refuses what does not parse", () => {
    const dir = mkdtempSync(join(tmpdir(), "beta-config-"));
    try {
      writeFileSync(join(dir, "ok.jsonc"), '// a comment\n{ "name": "x", /* inline */ "main": "y", }\n');
      expect(readConfig(join(dir, "ok.jsonc"))).toEqual({ name: "x", main: "y" });
      writeFileSync(join(dir, "bad.jsonc"), '{ "name": ');
      expect(() => readConfig(join(dir, "bad.jsonc"))).toThrow(/bad\.jsonc/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  describe("production's wrangler.jsonc stays production's", () => {
    it.each([
      ["serves the experimental artifact", (c) => ({ ...c, assets: { ...c.assets, directory: "./apps/composer/out-experimental" } }), /wrangler\.jsonc.*\.\/apps\/composer\/out/],
      ["is renamed", (c) => ({ ...c, name: "dspack-studio-composer-beta" }), /wrangler\.jsonc.*name/],
      ["moves to another hostname", (c) => ({ ...c, routes: [{ pattern: "composer-beta.aesthetic-function.com", custom_domain: true }] }), /wrangler\.jsonc.*route/],
      ["declares the beta switch", (c) => ({ ...c, vars: { ...c.vars, BLOCKS_BETA: '{"enabled":true}' } }), /wrangler\.jsonc.*BLOCKS_BETA/],
    ])("a production config that %s is refused", (_name, mutate, message) => {
      const found = problems({ production: mutate(production()) });
      expect(found.join("\n")).toMatch(message);
    });
  });

  describe("the beta config", () => {
    it("is its own Worker on its own hostname, serving the experimental artifact through the same Worker code", () => {
      const c = beta();
      expect(c.name).toBe("dspack-studio-composer-beta");
      expect(c.name).not.toBe(production().name);
      expect(c.main).toBe(production().main);
      expect(c.routes).toEqual([{ pattern: "composer-beta.aesthetic-function.com", custom_domain: true }]);
      expect(c.assets).toEqual({ directory: "./apps/composer/out-experimental", not_found_handling: "404-page", binding: "ASSETS", run_worker_first: ["/api/*"] });
      expect(c.ai).toEqual({ binding: "AI" });
    });

    it("has no URL that bypasses Access, and keeps the switches set in the dashboard", () => {
      const c = beta();
      expect(c.workers_dev).toBe(false);
      expect(c.preview_urls).toBe(false);
      expect(c.keep_vars).toBe(true);
      expect(c).not.toHaveProperty("vars");
    });

    it.each([
      ["shares production's name", (c) => ({ ...c, name: "dspack-studio-composer" }), /name/],
      ["serves the default artifact", (c) => ({ ...c, assets: { ...c.assets, directory: "./apps/composer/out" } }), /out-experimental/],
      ["takes production's hostname", (c) => ({ ...c, routes: [{ pattern: "composer.aesthetic-function.com", custom_domain: true }] }), /route/],
      ["adds a second route", (c) => ({ ...c, routes: [...c.routes, { pattern: "beta.aesthetic-function.com", custom_domain: true }] }), /route/],
      ["routes without a custom domain", (c) => ({ ...c, routes: [{ pattern: "composer-beta.aesthetic-function.com/*", zone_name: "aesthetic-function.com" }] }), /route/],
      ["turns on workers.dev", (c) => ({ ...c, workers_dev: true }), /workers_dev/],
      ["leaves workers.dev to the default", ({ workers_dev: _w, ...c }) => c, /workers_dev/],
      ["turns on preview URLs", (c) => ({ ...c, preview_urls: true }), /preview_urls/],
      ["leaves preview URLs to the default", ({ preview_urls: _p, ...c }) => c, /preview_urls/],
      ["drops the dashboard's variables on deploy", (c) => ({ ...c, keep_vars: false }), /keep_vars/],
      ["declares HOSTED_AI, which would reset the kill switch on every deploy", (c) => ({ ...c, vars: { HOSTED_AI: "on" } }), /vars/],
      ["declares the block switch, which would override the dashboard", (c) => ({ ...c, vars: { BLOCKS_BETA: '{"enabled":true}' } }), /vars/],
      ["adds an environment", (c) => ({ ...c, env: { staging: { routes: [] } } }), /env/],
      ["runs other Worker code", (c) => ({ ...c, main: "apps/composer/worker/other.mjs" }), /main/],
      ["lets the Worker answer more than the API", (c) => ({ ...c, assets: { ...c.assets, run_worker_first: true } }), /run_worker_first/],
      ["drops the AI binding", ({ ai: _a, ...c }) => c, /ai/],
      ["shares production's rate-limit namespace", (c) => ({ ...c, ratelimits: production().ratelimits }), /ratelimits/],
      ["runs on another compatibility date", (c) => ({ ...c, compatibility_date: "2026-10-01" }), /compatibility_date/],
    ])("a beta config that %s is refused", (_name, mutate, message) => {
      const found = problems({ beta: mutate(beta()) });
      expect(found.length).toBeGreaterThan(0);
      expect(found.join("\n")).toMatch(message);
    });
  });
});

describe("the artifact", () => {
  const dirs = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const artifact = (files) => {
    const dir = mkdtempSync(join(tmpdir(), "beta-artifact-"));
    dirs.push(dir);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    return dir;
  };

  it("an experimental build that carries the blocks and the switch passes", () => {
    const dir = artifact({ "index.html": "<html></html>", "_next/static/chunks/a.js": 'x="blocksSidecar"', "_next/static/chunks/b.js": 'y="reference-not-in-beta"' });
    expect(checkArtifact(dir)).toEqual([]);
  });

  it("a missing artifact, or one without index.html, is refused", () => {
    expect(checkArtifact(join(tmpdir(), "no-such-beta-artifact")).join("\n")).toMatch(/missing/);
    const dir = artifact({ "_next/static/chunks/a.js": 'x="blocksSidecar" y="reference-not-in-beta"' });
    expect(checkArtifact(dir).join("\n")).toMatch(/index\.html/);
  });

  it("a default build, which carries no block code, is refused", () => {
    const dir = artifact({ "index.html": "<html></html>", "_next/static/chunks/a.js": "x=1" });
    expect(checkArtifact(dir).join("\n")).toMatch(/blocksSidecar/);
  });

  it("an experimental build without the beta switch is refused", () => {
    const dir = artifact({ "index.html": "<html></html>", "_next/static/chunks/a.js": 'x="blocksSidecar"' });
    expect(checkArtifact(dir).join("\n")).toMatch(/reference-not-in-beta/);
  });
});

describe("the Access check", () => {
  const URL_ = "https://composer-beta.aesthetic-function.com";
  const LOGIN = "https://aesthetic-function.cloudflareaccess.com/cdn-cgi/access/login/composer-beta.aesthetic-function.com?kid=abc";
  const respond = (byPath) => {
    const seen = [];
    const fetchImpl = async (url, init) => {
      seen.push({ url: String(url), init });
      const answer = byPath(new URL(url).pathname);
      if (answer instanceof Error) throw answer;
      return answer;
    };
    return { seen, fetchImpl };
  };
  const redirect = (location, status = 302) => new Response(null, { status, headers: { location } });
  const noWait = async () => {};

  it("an anonymous request redirected to the Access login passes, for the page and the API alike", async () => {
    const { seen, fetchImpl } = respond(() => redirect(LOGIN));
    expect(await checkAccess(URL_, { phase: "after", fetchImpl, wait: noWait })).toEqual([]);
    expect(seen.map((s) => new URL(s.url).pathname)).toEqual(["/", "/api/models", "/_next/static/access-probe"]);
    for (const s of seen) {
      expect(s.init.redirect).toBe("manual");
      // A browser's navigation, so Access answers with its login redirect; and anonymous.
      expect(s.init.headers).toEqual({ accept: "text/html" });
      expect(s.init.credentials).toBe("omit");
      expect(s.init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("a redirect to Access's own path on the beta hostname passes", async () => {
    const { fetchImpl } = respond(() => redirect(`${URL_}/cdn-cgi/access/login?redirect_url=%2F`));
    expect(await checkAccess(URL_, { phase: "after", fetchImpl, wait: noWait })).toEqual([]);
  });

  it("a bare 401 or 403 is no proof of Access: a WAF rule or bot challenge may stop the runner and let others through", async () => {
    for (const status of [401, 403]) {
      const { fetchImpl } = respond(() => new Response("forbidden", { status }));
      const found = await checkAccess(URL_, { phase: "after", fetchImpl, wait: noWait });
      expect(found.join("\n")).toMatch(new RegExp(`answered ${status}.*not the Cloudflare Access login`));
    }
    const { fetchImpl } = respond(() => new Response("challenge", { status: 403, headers: { "cf-mitigated": "challenge" } }));
    expect((await checkAccess(URL_, { phase: "before", fetchImpl, wait: noWait })).join("\n")).toMatch(/cf-mitigated: challenge/);
  });

  it("a redirect to the Access team domain outside its login path is refused", async () => {
    const { fetchImpl } = respond(() => redirect("https://aesthetic-function.cloudflareaccess.com/elsewhere"));
    expect((await checkAccess(URL_, { phase: "after", fetchImpl, wait: noWait })).length).toBeGreaterThan(0);
  });

  it.each([
    ["the page served to anyone", () => new Response("<html>", { status: 200 })],
    ["the API served to anyone", (path) => (path === "/api/models" ? new Response("{}", { status: 200 }) : redirect(LOGIN))],
    ["the static assets answered by the Worker, not Access", (path) => (path.startsWith("/_next/") ? new Response("not found", { status: 404 }) : redirect(LOGIN))],
    ["a redirect elsewhere", () => redirect("https://example.com/login")],
    ["a redirect to a look-alike host", () => redirect("https://aesthetic-function.cloudflareaccess.com.example.net/login")],
    ["a redirect to the hostname itself", () => redirect(`${URL_}/index.html`)],
    ["a 404", () => new Response("not found", { status: 404 })],
    ["a 500", () => new Response("error", { status: 500 })],
  ])("%s is refused, before or after the deploy", async (_name, answer) => {
    for (const phase of ["before", "after"]) {
      const { fetchImpl } = respond(answer);
      const found = await checkAccess(URL_, { phase, fetchImpl, wait: noWait });
      expect(found.length).toBeGreaterThan(0);
    }
  });

  it("a hostname that does not resolve yet passes before the first deploy, and fails after the deploy once the retries are spent", async () => {
    const offline = () => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }) });
    const before = respond(offline);
    expect(await checkAccess(URL_, { phase: "before", fetchImpl: before.fetchImpl, wait: noWait })).toEqual([]);
    expect(before.seen).toHaveLength(1);
    let waits = 0;
    const after = respond(offline);
    const found = await checkAccess(URL_, { phase: "after", fetchImpl: after.fetchImpl, wait: async () => void waits++, attempts: 4 });
    expect(found.join("\n")).toMatch(/could not be reached/);
    expect(waits).toBe(3);
  });

  it.each([
    ["a reset connection", "ECONNRESET"],
    ["a refused connection", "ECONNREFUSED"],
    ["a connect timeout", "UND_ERR_CONNECT_TIMEOUT"],
    ["a TLS certificate error", "ERR_TLS_CERT_ALTNAME_INVALID"],
    ["a temporary DNS failure", "EAI_AGAIN"],
  ])("before the deploy, only an unresolved hostname passes: %s is refused", async (_name, code) => {
    const failing = () => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(code), { code }) });
    const { seen, fetchImpl } = respond(failing);
    const found = await checkAccess(URL_, { phase: "before", fetchImpl, wait: noWait });
    expect(found.join("\n")).toMatch(new RegExp(code));
    expect(seen).toHaveLength(1);
  });

  it("before the deploy, a probe that never answers is refused when its timeout fires", async () => {
    const { fetchImpl } = respond(() => new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    expect((await checkAccess(URL_, { phase: "before", fetchImpl, wait: noWait })).join("\n")).toMatch(/TimeoutError|timed? ?out/i);
  });

  it("after the deploy, a new hostname gets about five minutes to resolve and take its certificate", async () => {
    let waited = 0;
    const { seen, fetchImpl } = respond(() => new TypeError("fetch failed"));
    await checkAccess(URL_, { phase: "after", fetchImpl, wait: async (ms) => void (waited += ms) });
    expect(seen.length).toBe(50);
    expect(waited).toBeGreaterThanOrEqual(4 * 60_000);
    expect(waited).toBeLessThanOrEqual(6 * 60_000);
  });

  it("after the deploy, a hostname that starts resolving within the retries passes", async () => {
    let n = 0;
    const { fetchImpl } = respond(() => (n++ < 2 ? new TypeError("fetch failed") : redirect(LOGIN)));
    expect(await checkAccess(URL_, { phase: "after", fetchImpl, wait: noWait, attempts: 5 })).toEqual([]);
  });
});

/**
 * The keys of a top-level mapping in a block-style workflow file, read by
 * indentation: the lines indented two spaces under `key:`, up to the next
 * top-level line. Null when the key is missing or not written as a block.
 */
function topLevelKeys(yml, key) {
  const lines = yml.split("\n").filter((l) => !/^\s*(#|$)/.test(l));
  const start = lines.indexOf(`${key}:`);
  if (start < 0) return null;
  const keys = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const match = /^ {2}([^\s:#][^:]*):/.exec(line);
    if (match) keys.push(match[1]);
  }
  return keys;
}

describe("the workflows", () => {
  const text = (rel) => readFileSync(repo(rel), "utf8");
  const beta = () => text(".github/workflows/deploy-composer-beta.yml");
  const lines = (yml) => yml.split("\n").filter((l) => !l.trim().startsWith("#"));

  it("topLevelKeys reads a workflow's triggers, and refuses any other way of writing them", () => {
    expect(topLevelKeys("name: x\non:\n  workflow_dispatch:\n    inputs:\n      confirm:\n  push:\n    tags: ['*']\njobs:\n  a:\n", "on")).toEqual(["workflow_dispatch", "push"]);
    expect(topLevelKeys("name: x\non: [push, workflow_dispatch]\njobs:\n", "on")).toBeNull();
    expect(topLevelKeys("name: x\non: workflow_dispatch\njobs:\n", "on")).toBeNull();
  });

  it("the beta deploys only by a dispatch from main, through the protected composer-beta environment", () => {
    const yml = beta();
    expect(topLevelKeys(yml, "on")).toEqual(["workflow_dispatch"]);
    expect(topLevelKeys(yml, "jobs")).toEqual(["deploy"]);
    expect(yml).toMatch(/if: \$\{\{ inputs\.confirm == 'deploy-composer-beta' && github\.ref == 'refs\/heads\/main' \}\}/);
    expect(yml).toMatch(/\n    environment: composer-beta\n/);
    expect(yml).toMatch(/\n    permissions:\n      contents: read\n    steps:/);
  });

  it("the beta authenticates with its own credential only, and refuses to run without it", () => {
    const yml = beta();
    expect(yml).toMatch(/CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN_BETA \}\}/);
    expect(yml).not.toMatch(/secrets\.CLOUDFLARE_API_TOKEN \}\}/);
    // A token scoped to the one Worker cannot look the account up, so wrangler is told it.
    expect(yml).toMatch(/CLOUDFLARE_ACCOUNT_ID: \$\{\{ vars\.CLOUDFLARE_ACCOUNT_ID \}\}/);
    expect(yml).toMatch(/test -n "\$\{CLOUDFLARE_ACCOUNT_ID:-\}"/);
    // Reserved for a later authenticated smoke: named in the comments, never used.
    expect(lines(yml).join("\n")).not.toMatch(/CF_ACCESS_CLIENT_(ID|SECRET)/);
    expect(yml).toMatch(/test -n "\$\{CLOUDFLARE_API_TOKEN:-\}"/);
  });

  it("every wrangler command names the beta config and the pinned wrangler", () => {
    const commands = lines(beta()).filter((l) => /\bwrangler\b/.test(l) && !/^\s*-?\s*name:/.test(l) && !/^\s*echo /.test(l));
    expect(commands.length).toBeGreaterThanOrEqual(4);
    for (const command of commands) {
      expect(command).toContain(`npx --yes ${WRANGLER} `);
      if (!command.includes(`${WRANGLER} --version`)) expect(command).toContain("--config wrangler.composer-beta.jsonc");
    }
    expect(beta()).not.toMatch(/--config wrangler\.jsonc/);
  });

  /** The `run: |` script of the step named `name`, dedented, as the runner executes it. */
  const stepScript = (yml, name) => {
    const lines = yml.split("\n");
    const start = lines.findIndex((l) => l.trim() === `- name: ${name}`);
    expect(start, name).toBeGreaterThan(-1);
    const run = lines.findIndex((l, i) => i > start && /^ {8}run: \|$/.test(l));
    const body = [];
    for (const line of lines.slice(run + 1)) {
      if (line.trim() !== "" && !line.startsWith(" ".repeat(10))) break;
      body.push(line.slice(10));
    }
    return body.join("\n");
  };

  it("a deploy needs a recorded rollback anchor; only a dispatch marked first_deploy may go ahead without one", () => {
    const yml = beta();
    expect(yml).toMatch(/\n      first_deploy:\n        description: [^\n]+\n        type: boolean\n        default: false\n/);
    const name = "Record the rollback anchor (currently active version)";
    expect(yml).toMatch(/FIRST_DEPLOY: \$\{\{ inputs\.first_deploy \}\}/);
    const script = stepScript(yml, name);
    expect(script).not.toMatch(/\$\{\{/);
    const dir = mkdtempSync(join(tmpdir(), "beta-anchor-"));
    try {
      writeFileSync(join(dir, "npx"), '#!/bin/sh\necho "listing: $*"\necho "${FAKE_NPX_ERROR:-}"\nexit "${FAKE_NPX_EXIT:-0}"\n');
      chmodSync(join(dir, "npx"), 0o755);
      // wrangler 4.146.0 prints an API error as "<message> [code: <n>]"; 10007 is its WORKER_NOT_FOUND_ERR_CODE.
      const NOT_FOUND = "✘ [ERROR] A request to the Cloudflare API failed. This Worker does not exist on your account. [code: 10007]";
      const AUTH = "✘ [ERROR] A request to the Cloudflare API failed. Authentication error [code: 10000]";
      const run = (listing, firstDeploy) => {
        const summary = join(dir, `summary-${listing}-${firstDeploy}`);
        writeFileSync(summary, "");
        const error = { ok: "", missing: NOT_FOUND, auth: AUTH, outage: "✘ [ERROR] fetch failed" }[listing];
        // A run step with no shell set runs under `bash -e`, without pipefail.
        const result = spawnSync("bash", ["--noprofile", "--norc", "-e", "-c", script], {
          env: { PATH: `${dir}:${process.env.PATH}`, FAKE_NPX_EXIT: listing === "ok" ? "0" : "1", FAKE_NPX_ERROR: error, FIRST_DEPLOY: String(firstDeploy), GITHUB_STEP_SUMMARY: summary, GITHUB_SHA: "abc123" },
          encoding: "utf8",
        });
        return { status: result.status, summary: readFileSync(summary, "utf8") };
      };
      const listed = run("ok", false);
      expect(listed.status).toBe(0);
      expect(listed.summary).toMatch(/listing: --yes wrangler@4\.146\.0 deployments list --config wrangler\.composer-beta\.jsonc/);
      for (const failure of ["missing", "auth", "outage"]) expect(run(failure, false).status, failure).not.toBe(0);
      // first_deploy goes ahead only on wrangler's own "this Worker does not exist" (code 10007).
      const first = run("missing", true);
      expect(first.status).toBe(0);
      expect(first.summary).toMatch(/first deploy/i);
      for (const failure of ["auth", "outage"]) expect(run(failure, true).status, failure).not.toBe(0);
      // A first deploy only: once the Worker exists, first_deploy is refused, so it can never skip the pre-deploy check.
      expect(run("ok", true).status).not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /** Each step of the one job: its name and its full text. */
  const steps = (yml) => {
    const body = yml.slice(yml.indexOf("\n    steps:\n"));
    return body.split(/\n(?=      - )/).slice(1).map((text) => ({ name: (/- (?:name|uses): (.+)/.exec(text) ?? [])[1] ?? "", text }));
  };

  it("the token reaches only the steps that need it: never an install, wrangler's included, or the build", () => {
    const yml = beta();
    const job = yml.slice(yml.indexOf("\n  deploy:\n"), yml.indexOf("\n    steps:\n"));
    expect(job).not.toMatch(/CLOUDFLARE_/);
    const all = steps(yml);
    expect(all.length).toBeGreaterThan(8);
    for (const step of all) {
      const code = step.text.replace(/^\s*#.*$/gm, "");
      const callsCloudflare = /\bwrangler@\S+ (deployments|deploy|rollback)\b/.test(code);
      const checksCredential = step.name === "The beta deploys only with its own credential";
      const hasToken = /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN_BETA \}\}/.test(step.text);
      expect(hasToken, step.name).toBe(callsCloudflare || checksCredential);
      if (hasToken) expect(step.text, step.name).toMatch(/CLOUDFLARE_ACCOUNT_ID: \$\{\{ vars\.CLOUDFLARE_ACCOUNT_ID \}\}/);
    }
    for (const name of ["Frozen-lockfile install", "Build the experimental artifact (apps/composer/out-experimental)"]) {
      expect(all.find((s) => s.name === name)?.text, name).not.toMatch(/CLOUDFLARE_/);
    }
    // wrangler's own install runs its dependencies' install scripts: that happens first, with no credentials.
    const warm = all.findIndex((s) => new RegExp(`npx --yes ${WRANGLER.replace(/[.@]/g, "\\$&")} --version`).test(s.text));
    const anchor = all.findIndex((s) => s.name === "Record the rollback anchor (currently active version)");
    expect(warm).toBeGreaterThan(-1);
    expect(warm).toBeLessThan(anchor);
    expect(all[warm].text).not.toMatch(/CLOUDFLARE_/);
  });

  it("a first deploy skips the pre-deploy Access check, which would only cache the hostname's absence on the runner", () => {
    const pre = steps(beta()).find((s) => /--access=before/.test(s.text));
    expect(pre?.text).toMatch(/\n        if: \$\{\{ !inputs\.first_deploy \}\}\n/);
  });

  it("builds the experimental artifact and runs every guard before the deploy, and the Access check after it", () => {
    const yml = lines(beta()).join("\n");
    const at = (needle) => {
      const i = yml.indexOf(needle);
      expect(i, needle).toBeGreaterThan(-1);
      return i;
    };
    const deploy = at(`npx --yes ${WRANGLER} deploy --config wrangler.composer-beta.jsonc`);
    expect(at("pnpm install --frozen-lockfile")).toBeLessThan(at("pnpm --filter composer build:experimental"));
    expect(at("pnpm --filter composer build:experimental")).toBeLessThan(at("node apps/composer/scripts/check-beta-deploy.mjs\n"));
    expect(at("node apps/composer/scripts/check-beta-deploy.mjs\n")).toBeLessThan(deploy);
    expect(at("node apps/composer/scripts/check-beta-deploy.mjs --access=before")).toBeLessThan(deploy);
    expect(at(`npx --yes ${WRANGLER} deployments list --config wrangler.composer-beta.jsonc`)).toBeLessThan(deploy);
    expect(at("node apps/composer/scripts/check-beta-deploy.mjs --access=after")).toBeGreaterThan(deploy);
  });

  it("production's workflow still deploys only the default artifact, with production's credential", () => {
    const yml = text(".github/workflows/deploy-composer.yml");
    expect(yml).toMatch(/CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
    expect(yml).toMatch(/test -z "\$\{NEXT_PUBLIC_COMPOSER_EXPERIMENTAL:-\}"/);
    expect(yml).toMatch(/npx wrangler deploy --config wrangler\.jsonc/);
    expect(yml).not.toMatch(/composer-beta|out-experimental|CLOUDFLARE_API_TOKEN_BETA/);
  });

  it("production's workflow comments describe the deploy paths as they are", () => {
    const yml = text(".github/workflows/deploy-composer.yml");
    expect(yml).not.toMatch(/integration\/validation environment/);
    expect(yml).not.toMatch(/not a side effect of merging/);
    expect(yml).not.toMatch(/exhibit Worker \(wrangler\.jsonc\)/);
    expect(yml).toMatch(/Workers Builds/);
    expect(text("wrangler.jsonc")).not.toMatch(/integration\/validation environment/);
  });
});
