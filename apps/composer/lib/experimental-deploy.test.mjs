/**
 * The experimental deploy path under the owner's single-host amendment
 * (docs/blocks/BETA-DEPLOY-PLAN.md; docs/deployment.md, "The invite-only
 * beta"). The beta is the existing composer Worker on its existing hostname,
 * behind Cloudflare Access, serving the experimental artifact once a dispatched
 * workflow deploys it, and only after Access already sends anonymous requests
 * to its login. Workers Builds keeps deploying the block-free default artifact
 * through wrangler.jsonc. These tests hold the two configs, the artifact check,
 * the Access check and the workflows to that, so a change that would deploy
 * the wrong artifact, open a URL that bypasses Access, or deploy before Access
 * is in place fails.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { WRANGLER, checkAccess, checkArtifact, checkConfigs, readConfig } from "../scripts/check-experimental-deploy.mjs";

const repo = (rel) => fileURLToPath(new URL(`../../../${rel}`, import.meta.url));
const production = () => readConfig(repo("wrangler.jsonc"));
const experimental = () => readConfig(repo("wrangler.composer-experimental.jsonc"));
const problems = (overrides = {}) => checkConfigs({ production: overrides.production ?? production(), experimental: overrides.experimental ?? experimental() });

describe("the configs", () => {
  it("the committed default and experimental configs pass", () => {
    expect(problems()).toEqual([]);
  });

  it("readConfig reads JSONC, comments included, and refuses what does not parse", () => {
    const dir = mkdtempSync(join(tmpdir(), "experimental-config-"));
    try {
      writeFileSync(join(dir, "ok.jsonc"), '// a comment\n{ "name": "x", /* inline */ "main": "y", }\n');
      expect(readConfig(join(dir, "ok.jsonc"))).toEqual({ name: "x", main: "y" });
      writeFileSync(join(dir, "bad.jsonc"), '{ "name": ');
      expect(() => readConfig(join(dir, "bad.jsonc"))).toThrow(/bad\.jsonc/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("both are the one composer Worker on its one hostname, and differ only in the artifact they serve", () => {
    const d = production();
    const e = experimental();
    for (const c of [d, e]) {
      expect(c.name).toBe("dspack-studio-composer");
      expect(c.routes).toEqual([{ pattern: "composer.aesthetic-function.com", custom_domain: true }]);
    }
    expect(d.assets.directory).toBe("./apps/composer/out");
    expect(e.assets.directory).toBe("./apps/composer/out-experimental");
    expect({ ...e, assets: { ...e.assets, directory: d.assets.directory } }).toEqual(d);
  });

  it("neither has a URL that bypasses Access, and both keep the switches set in the dashboard", () => {
    for (const c of [production(), experimental()]) {
      expect(c.workers_dev).toBe(false);
      expect(c.preview_urls).toBe(false);
      expect(c.keep_vars).toBe(true);
      expect(c).not.toHaveProperty("vars");
    }
  });

  it("the order of keys does not matter", () => {
    const e = experimental();
    const reordered = Object.fromEntries(Object.entries(e).reverse().map(([k, v]) => [k, v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v]));
    expect(problems({ experimental: reordered })).toEqual([]);
  });

  describe.each([
    ["wrangler.jsonc", "production"],
    ["wrangler.composer-experimental.jsonc", "experimental"],
  ])("%s", (file, which) => {
    it.each([
      ["names another Worker", (c) => ({ ...c, name: "dspack-studio-composer-beta" }), /name/],
      ["moves to another hostname", (c) => ({ ...c, routes: [{ pattern: "composer-beta.aesthetic-function.com", custom_domain: true }] }), /route/],
      ["adds a second route", (c) => ({ ...c, routes: [...c.routes, { pattern: "beta.aesthetic-function.com", custom_domain: true }] }), /route/],
      ["routes without a custom domain", (c) => ({ ...c, routes: [{ pattern: "composer.aesthetic-function.com/*", zone_name: "aesthetic-function.com" }] }), /route/],
      ["turns on custom-domain Preview URLs", (c) => ({ ...c, routes: [{ ...c.routes[0], previews_enabled: true }] }), /route/],
      ["turns on workers.dev", (c) => ({ ...c, workers_dev: true }), /workers_dev/],
      ["leaves workers.dev to the default", ({ workers_dev: _w, ...c }) => c, /workers_dev/],
      ["turns on Preview URLs", (c) => ({ ...c, preview_urls: true }), /preview_urls/],
      ["leaves Preview URLs to the default", ({ preview_urls: _p, ...c }) => c, /preview_urls/],
      ["drops the dashboard's variables on deploy", (c) => ({ ...c, keep_vars: false }), /keep_vars/],
      ["leaves keep_vars to the default", ({ keep_vars: _k, ...c }) => c, /keep_vars/],
      ["declares HOSTED_AI, which would reset the kill switch on every deploy", (c) => ({ ...c, vars: { HOSTED_AI: "on" } }), /vars/],
      ["declares the block switch, which would override the dashboard", (c) => ({ ...c, vars: { BLOCKS_BETA: '{"enabled":true}' } }), /vars/],
      ["declares the operator log", (c) => ({ ...c, vars: { BETA_OPERATOR_LOG: "on" } }), /vars/],
      ["adds an environment", (c) => ({ ...c, env: { staging: { routes: [] } } }), /env/],
      ["lets the Worker answer more than the API", (c) => ({ ...c, assets: { ...c.assets, run_worker_first: true } }), /run_worker_first/],
    ])(`${which === "experimental" ? "an" : "a"} ${which} config that %s is refused`, (_name, mutate, message) => {
      const found = problems({ [which]: mutate(which === "production" ? production() : experimental()) });
      expect(found.some((p) => p.startsWith(`${file}: `) && message.test(p)), found.join("\n")).toBe(true);
    });
  });

  it("Workers Builds' config never serves the experimental artifact", () => {
    const found = problems({ production: { ...production(), assets: { ...production().assets, directory: "./apps/composer/out-experimental" } } });
    expect(found.join("\n")).toMatch(/wrangler\.jsonc: assets\.directory must stay \.\/apps\/composer\/out\b/);
  });

  it.each([
    ["serves the default artifact", (c) => ({ ...c, assets: { ...c.assets, directory: "./apps/composer/out" } }), /assets\.directory must be \.\/apps\/composer\/out-experimental/],
    ["runs other Worker code", (c) => ({ ...c, main: "apps/composer/worker/other.mjs" }), /main must equal/],
    ["runs on another compatibility date", (c) => ({ ...c, compatibility_date: "2026-10-01" }), /compatibility_date must equal/],
    ["drops a compatibility flag", (c) => ({ ...c, compatibility_flags: [] }), /compatibility_flags must equal/],
    ["turns observability off", (c) => ({ ...c, observability: { enabled: false } }), /observability must equal/],
    ["drops the AI binding", ({ ai: _a, ...c }) => c, /ai must equal/],
    ["uses another rate-limit namespace", (c) => ({ ...c, ratelimits: [{ ...c.ratelimits[0], namespace_id: "1002" }] }), /ratelimits must equal/],
    ["raises the rate limit", (c) => ({ ...c, ratelimits: [{ ...c.ratelimits[0], simple: { limit: 100, period: 60 } }] }), /ratelimits must equal/],
  ])("an experimental config that %s is refused: apart from the artifact it is the same Worker", (_name, mutate, message) => {
    const found = problems({ experimental: mutate(experimental()) });
    expect(found.some((p) => p.startsWith("wrangler.composer-experimental.jsonc: ") && message.test(p)), found.join("\n")).toBe(true);
  });
});

describe("the artifact", () => {
  const dirs = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const artifact = (files) => {
    const dir = mkdtempSync(join(tmpdir(), "experimental-artifact-"));
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
    expect(checkArtifact(join(tmpdir(), "no-such-experimental-artifact")).join("\n")).toMatch(/missing/);
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
  const URL_ = "https://composer.aesthetic-function.com";
  const LOGIN = "https://aesthetic-function.cloudflareaccess.com/cdn-cgi/access/login/composer.aesthetic-function.com?kid=abc";
  const respond = (answer) => {
    const seen = [];
    const fetchImpl = async (url, init) => {
      seen.push({ url: String(url), init });
      const reply = answer(new URL(url).pathname, init);
      if (reply instanceof Error) throw reply;
      return reply;
    };
    return { seen, fetchImpl };
  };
  const redirect = (location, status = 302) => new Response(null, { status, headers: { location } });
  const noWait = async () => {};
  /** The Worker's own refusal of an empty body: what a POST that got past Access would meet. */
  const workerRefusal = () => new Response('{"error":"invalid-request","calls":[]}', { status: 400, headers: { "content-type": "application/json" } });

  it("anonymous GETs for the page, the API and the static assets, and an anonymous POST to the API, all sent to the Access login, pass", async () => {
    const { seen, fetchImpl } = respond(() => redirect(LOGIN));
    expect(await checkAccess(URL_, { phase: "before", fetchImpl, wait: noWait })).toEqual([]);
    expect(seen.map((s) => `${s.init.method} ${new URL(s.url).pathname}`)).toEqual(["GET /", "GET /api/models", "GET /_next/static/access-probe", "POST /api/propose"]);
    for (const s of seen) {
      expect(s.init.redirect).toBe("manual");
      expect(s.init.credentials).toBe("omit");
      expect(s.init.signal).toBeInstanceOf(AbortSignal);
    }
    // A browser's navigation, so Access answers with its login redirect; and anonymous.
    for (const s of seen.slice(0, 3)) expect(s.init.headers).toEqual({ accept: "text/html" });
    const post = seen[3];
    expect(post.init.headers).toEqual({ accept: "text/html", "content-type": "application/json" });
    // An empty body: if the Worker ever answered it, it would refuse it before any model call.
    expect(post.init.body).toBe("{}");
  });

  it("a redirect to Access's own path on the hostname passes", async () => {
    const { fetchImpl } = respond(() => redirect(`${URL_}/cdn-cgi/access/login?redirect_url=%2F`));
    expect(await checkAccess(URL_, { phase: "after", fetchImpl, wait: noWait })).toEqual([]);
  });

  it("a POST that reaches the Worker is refused, even when the Worker refuses it, and even when every GET is sent to the login", async () => {
    for (const phase of ["before", "after"]) {
      const { fetchImpl } = respond((_path, init) => (init.method === "POST" ? workerRefusal() : redirect(LOGIN)));
      const found = await checkAccess(URL_, { phase, fetchImpl, wait: noWait });
      expect(found.join("\n")).toMatch(/\/api\/propose answered 400 to an anonymous POST, not the Cloudflare Access login/);
    }
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
    ["the POST answered by the Worker", (_path, init) => (init.method === "POST" ? workerRefusal() : redirect(LOGIN))],
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

  it("the hostname always exists: one that does not resolve is refused before the deploy, and after it once the retries are spent", async () => {
    const offline = () => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }) });
    const before = respond(offline);
    expect((await checkAccess(URL_, { phase: "before", fetchImpl: before.fetchImpl, wait: noWait })).join("\n")).toMatch(/could not be reached before the deploy \(ENOTFOUND\)/);
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
  ])("before the deploy, a hostname that cannot be reached is refused at once: %s", async (_name, code) => {
    const failing = () => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(code), { code }) });
    const { seen, fetchImpl } = respond(failing);
    const found = await checkAccess(URL_, { phase: "before", fetchImpl, wait: noWait });
    expect(found.join("\n")).toMatch(new RegExp(code));
    expect(seen).toHaveLength(1);
  });

  it("a POST that cannot be reached is refused", async () => {
    const { fetchImpl } = respond((_path, init) => (init.method === "POST" ? Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }) : redirect(LOGIN)));
    expect((await checkAccess(URL_, { phase: "before", fetchImpl, wait: noWait })).join("\n")).toMatch(/\/api\/propose could not be reached \(ECONNRESET\)/);
  });

  it("before the deploy, a probe that never answers is refused when its timeout fires", async () => {
    const { fetchImpl } = respond(() => new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    expect((await checkAccess(URL_, { phase: "before", fetchImpl, wait: noWait })).join("\n")).toMatch(/TimeoutError|timed? ?out/i);
  });

  it("after the deploy, a failing check is retried for about five minutes before it fails", async () => {
    let waited = 0;
    const { seen, fetchImpl } = respond(() => new TypeError("fetch failed"));
    await checkAccess(URL_, { phase: "after", fetchImpl, wait: async (ms) => void (waited += ms) });
    expect(seen.length).toBe(50);
    expect(waited).toBeGreaterThanOrEqual(4 * 60_000);
    expect(waited).toBeLessThanOrEqual(6 * 60_000);
  });

  it("after the deploy, a hostname that answers within the retries passes", async () => {
    let n = 0;
    const { fetchImpl } = respond(() => (n++ < 2 ? new TypeError("fetch failed") : redirect(LOGIN)));
    expect(await checkAccess(URL_, { phase: "after", fetchImpl, wait: noWait, attempts: 5 })).toEqual([]);
  });

  it("a phase other than before or after is refused", async () => {
    await expect(checkAccess(URL_, { phase: "during" })).rejects.toThrow(/phase/);
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
  const workflow = () => text(".github/workflows/deploy-composer-experimental.yml");
  const lines = (yml) => yml.split("\n").filter((l) => !l.trim().startsWith("#"));

  it("topLevelKeys reads a workflow's triggers, and refuses any other way of writing them", () => {
    expect(topLevelKeys("name: x\non:\n  workflow_dispatch:\n    inputs:\n      confirm:\n  push:\n    tags: ['*']\njobs:\n  a:\n", "on")).toEqual(["workflow_dispatch", "push"]);
    expect(topLevelKeys("name: x\non: [push, workflow_dispatch]\njobs:\n", "on")).toBeNull();
    expect(topLevelKeys("name: x\non: workflow_dispatch\njobs:\n", "on")).toBeNull();
  });

  it("the experimental artifact deploys only by a dispatch from main, through the protected composer-experimental environment", () => {
    const yml = workflow();
    expect(topLevelKeys(yml, "on")).toEqual(["workflow_dispatch"]);
    expect(topLevelKeys(yml, "jobs")).toEqual(["deploy"]);
    expect(yml).toMatch(/\n    inputs:\n      confirm:\n        description: [^\n]+\n        required: true\n\n/);
    expect(yml).toMatch(/if: \$\{\{ inputs\.confirm == 'deploy-composer-experimental' && github\.ref == 'refs\/heads\/main' \}\}/);
    expect(yml).toMatch(/\n    environment: composer-experimental\n/);
    expect(yml).toMatch(/\n    permissions:\n      contents: read\n    steps:/);
  });

  it("it authenticates with its own credential only, never the repository's production token, and refuses to run without it", () => {
    const yml = workflow();
    expect(yml).toMatch(/CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN_EXPERIMENTAL \}\}/);
    // A dispatch to an environment that does not exist yet creates it unprotected; a secret of its own name then simply is not there.
    expect(yml).not.toMatch(/secrets\.CLOUDFLARE_API_TOKEN \}\}/);
    expect(yml).not.toMatch(/CLOUDFLARE_API_TOKEN_BETA/);
    // A token scoped to the one Worker cannot look the account up, so wrangler is told it.
    expect(yml).toMatch(/CLOUDFLARE_ACCOUNT_ID: \$\{\{ vars\.CLOUDFLARE_ACCOUNT_ID \}\}/);
    expect(yml).toMatch(/test -n "\$\{CLOUDFLARE_API_TOKEN:-\}"/);
    expect(yml).toMatch(/test -n "\$\{CLOUDFLARE_ACCOUNT_ID:-\}"/);
    // No machine credential for Access: the workflow sends none.
    expect(lines(yml).join("\n")).not.toMatch(/CF_ACCESS_CLIENT_(ID|SECRET)|CF-Access-Client/i);
  });

  it("every wrangler command names the experimental config and the pinned wrangler", () => {
    const commands = lines(workflow()).filter((l) => /\bwrangler\b/.test(l) && !/^\s*-?\s*name:/.test(l) && !/^\s*echo /.test(l));
    expect(commands.length).toBeGreaterThanOrEqual(4);
    for (const command of commands) {
      expect(command).toContain(`npx --yes ${WRANGLER} `);
      if (!command.includes(`${WRANGLER} --version`)) expect(command).toContain("--config wrangler.composer-experimental.jsonc");
    }
    expect(commands.join("\n")).not.toMatch(/--config wrangler\.jsonc|rollback/);
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

  it("every deploy needs a recorded rollback anchor: the Worker exists, so there is no first deploy", () => {
    const yml = workflow();
    expect(yml).not.toMatch(/first_deploy|FIRST_DEPLOY|10007/);
    const script = stepScript(yml, "Record the rollback anchor (currently active version)");
    expect(script).not.toMatch(/\$\{\{/);
    const dir = mkdtempSync(join(tmpdir(), "experimental-anchor-"));
    try {
      writeFileSync(join(dir, "npx"), '#!/bin/sh\necho "listing: $*"\necho "${FAKE_NPX_OUT:-}"\nexit "${FAKE_NPX_EXIT:-0}"\n');
      chmodSync(join(dir, "npx"), 0o755);
      const VERSION = "Version(s):  (100%) 5c409786-97fa-4ed8-a82a-b882608aac79";
      const outputs = {
        ok: [VERSION, 0],
        // A listing that names no version records no anchor.
        empty: ["No deployments found", 0],
        // wrangler 4.146.0 prints an API error as "<message> [code: <n>]".
        missing: ["✘ [ERROR] A request to the Cloudflare API failed. This Worker does not exist on your account. [code: 10007]", 1],
        auth: ["✘ [ERROR] A request to the Cloudflare API failed. Authentication error [code: 10000]", 1],
        outage: ["✘ [ERROR] fetch failed", 1],
      };
      const run = (listing) => {
        const summary = join(dir, `summary-${listing}`);
        writeFileSync(summary, "");
        const [out, exit] = outputs[listing];
        // A run step with no shell set runs under `bash -e`, without pipefail.
        const result = spawnSync("bash", ["--noprofile", "--norc", "-e", "-c", script], {
          env: { PATH: `${dir}:${process.env.PATH}`, FAKE_NPX_OUT: out, FAKE_NPX_EXIT: String(exit), GITHUB_STEP_SUMMARY: summary, GITHUB_SHA: "abc123" },
          encoding: "utf8",
        });
        return { status: result.status, summary: readFileSync(summary, "utf8") };
      };
      const listed = run("ok");
      expect(listed.status).toBe(0);
      expect(listed.summary).toMatch(/listing: --yes wrangler@4\.146\.0 deployments list --config wrangler\.composer-experimental\.jsonc/);
      expect(listed.summary).toContain("5c409786-97fa-4ed8-a82a-b882608aac79");
      for (const failure of ["empty", "missing", "auth", "outage"]) expect(run(failure).status, failure).not.toBe(0);
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
    const yml = workflow();
    const job = yml.slice(yml.indexOf("\n  deploy:\n"), yml.indexOf("\n    steps:\n"));
    expect(job).not.toMatch(/CLOUDFLARE_/);
    const all = steps(yml);
    expect(all.length).toBeGreaterThan(8);
    for (const step of all) {
      const code = step.text.replace(/^\s*#.*$/gm, "");
      const callsCloudflare = /\bwrangler@\S+ (deployments|deploy|rollback)\b/.test(code);
      const checksCredential = step.name === "The experimental deploy uses only its own credential";
      const hasToken = /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN_EXPERIMENTAL \}\}/.test(step.text);
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

  it("every deploy first proves that Access sends anonymous requests to its login: the check has no condition", () => {
    const all = steps(workflow());
    const pre = all.filter((s) => /check-experimental-deploy\.mjs --access=before/.test(s.text));
    expect(pre).toHaveLength(1);
    expect(pre[0].text).not.toMatch(/\n {8}if:/);
    expect(pre[0].text).not.toMatch(/continue-on-error/);
  });

  it("builds the experimental artifact, runs every guard and the Access check, and records the anchor, all before the deploy; checks Access again after it", () => {
    const yml = lines(workflow()).join("\n");
    const at = (needle) => {
      const i = yml.indexOf(needle);
      expect(i, needle).toBeGreaterThan(-1);
      return i;
    };
    const deploy = at(`npx --yes ${WRANGLER} deploy --config wrangler.composer-experimental.jsonc`);
    expect(at("pnpm install --frozen-lockfile")).toBeLessThan(at("pnpm --filter composer build:experimental"));
    expect(at("pnpm --filter composer build:experimental")).toBeLessThan(at("node apps/composer/scripts/check-experimental-deploy.mjs\n"));
    expect(at("node apps/composer/scripts/check-experimental-deploy.mjs\n")).toBeLessThan(at("node apps/composer/scripts/check-experimental-deploy.mjs --access=before"));
    expect(at("node apps/composer/scripts/check-experimental-deploy.mjs --access=before")).toBeLessThan(at(`npx --yes ${WRANGLER} deployments list --config wrangler.composer-experimental.jsonc`));
    expect(at(`npx --yes ${WRANGLER} deployments list --config wrangler.composer-experimental.jsonc`)).toBeLessThan(deploy);
    expect(at("node apps/composer/scripts/check-experimental-deploy.mjs --access=after")).toBeGreaterThan(deploy);
  });

  it("production's workflow still deploys only the default artifact, with production's credential", () => {
    const yml = text(".github/workflows/deploy-composer.yml");
    expect(yml).toMatch(/CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
    expect(yml).toMatch(/test -z "\$\{NEXT_PUBLIC_COMPOSER_EXPERIMENTAL:-\}"/);
    expect(yml).toMatch(/npx wrangler deploy --config wrangler\.jsonc/);
    expect(yml).not.toMatch(/composer-beta|composer-experimental|out-experimental|CLOUDFLARE_API_TOKEN_BETA|CLOUDFLARE_API_TOKEN_EXPERIMENTAL/);
  });

  it("production's workflow comments describe the deploy paths as they are", () => {
    const yml = text(".github/workflows/deploy-composer.yml");
    expect(yml).not.toMatch(/integration\/validation environment/);
    expect(yml).not.toMatch(/not a side effect of merging/);
    expect(yml).not.toMatch(/exhibit Worker \(wrangler\.jsonc\)/);
    expect(yml).toMatch(/Workers Builds/);
    expect(text("wrangler.jsonc")).not.toMatch(/integration\/validation environment/);
  });

  it("no config or workflow for a separate beta Worker or hostname remains", () => {
    expect(existsSync(repo("wrangler.composer-beta.jsonc"))).toBe(false);
    expect(existsSync(repo(".github/workflows/deploy-composer-beta.yml"))).toBe(false);
    for (const rel of ["wrangler.jsonc", "wrangler.composer-experimental.jsonc", ".github/workflows/deploy-composer-experimental.yml", ".github/workflows/deploy-composer.yml", "apps/composer/scripts/check-experimental-deploy.mjs"]) {
      expect(text(rel), rel).not.toMatch(/composer-beta\.aesthetic-function\.com|dspack-studio-composer-beta|deploy-composer-beta/);
    }
  });
});
