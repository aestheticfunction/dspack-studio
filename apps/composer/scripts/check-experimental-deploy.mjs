/**
 * Guards for the experimental deploy to the composer Worker, under the owner's
 * single-host amendment (docs/blocks/BETA-DEPLOY-PLAN.md; docs/deployment.md,
 * "The invite-only beta"). The deploy-composer-experimental workflow runs it,
 * and so can anyone, from the repository root, once `pnpm install` has run:
 *
 *   node apps/composer/scripts/check-experimental-deploy.mjs
 *     The configs and the artifact. wrangler.jsonc, which Workers Builds
 *     deploys on every merge, and wrangler.composer-experimental.jsonc, which
 *     only the dispatched workflow deploys, are the one composer Worker on its
 *     one hostname. They differ only in the artifact they serve:
 *     apps/composer/out, the default, and apps/composer/out-experimental.
 *     Neither has a workers.dev or Preview URL; both keep the dashboard's vars
 *     and declare none. The built artifact is an experimental build that
 *     carries the beta switch.
 *
 *   node apps/composer/scripts/check-experimental-deploy.mjs --access=before|after
 *     Anonymous GET requests to the hostname, for its page, its API and its
 *     static assets, and an anonymous POST to /api/propose, must all be sent
 *     to the Cloudflare Access login, so that none reaches the Worker. The
 *     hostname always exists, so any failure refuses, before a deploy as
 *     after; after a deploy a failing check is retried 50 times, 6 seconds
 *     apart.
 *
 * Exits 1 on any problem, after printing every one.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

/** The wrangler the experimental workflow runs, pinned. */
export const WRANGLER = "wrangler@4.146.0";

/** The one Worker and hostname both configs deploy: the existing composer. */
const WORKER = { name: "dspack-studio-composer", hostname: "composer.aesthetic-function.com" };
const PRODUCTION = { file: "wrangler.jsonc", directory: "./apps/composer/out" };
const EXPERIMENTAL = { file: "wrangler.composer-experimental.jsonc", directory: "./apps/composer/out-experimental" };
/** Everything either config may declare. Anything else (vars, env, other bindings, triggers) is refused. */
const KEYS = ["name", "compatibility_date", "compatibility_flags", "main", "observability", "routes", "workers_dev", "preview_urls", "keep_vars", "assets", "ai", "ratelimits"];
/** What the experimental artifact must carry: the sidecar envelope key (the e2e positive control) and the switch. */
const ARTIFACT_MARKERS = [
  ["blocksSidecar", "this is not an experimental build"],
  ["reference-not-in-beta", "this build has no beta switch"],
];

/** JSON with every object's keys sorted, so the order a config writes them in never matters. */
const canonical = (value) =>
  JSON.stringify(value, (_key, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v));
const same = (a, b) => canonical(a) === canonical(b);

/** A wrangler JSONC config, comments and trailing commas allowed. */
export function readConfig(path) {
  const { config, error } = ts.parseConfigFileTextToJson(path, readFileSync(path, "utf8"));
  if (error || config === undefined) {
    throw new Error(`${path}: ${error ? ts.flattenDiagnosticMessageText(error.messageText, "\n") : "no config"}`);
  }
  return config;
}

/** Every way the two configs depart from the one composer Worker, each serving its own artifact. */
export function checkConfigs({ production, experimental }) {
  const problems = [];
  for (const [{ file }, config] of [[PRODUCTION, production], [EXPERIMENTAL, experimental]]) {
    const say = (message) => problems.push(`${file}: ${message}`);
    for (const key of Object.keys(config)) if (!KEYS.includes(key)) say(`declares ${key}, which neither config may (vars belong in the dashboard, kept by keep_vars)`);
    if (config.name !== WORKER.name) say(`name must be ${WORKER.name}: the beta is the composer Worker, never another`);
    if (!same(config.routes, [{ pattern: WORKER.hostname, custom_domain: true }])) say(`its one route must be the custom domain ${WORKER.hostname}, which Cloudflare Access protects, with no custom-domain Preview URLs`);
    if (config.workers_dev !== false) say("workers_dev must be false: a workers.dev URL would bypass Cloudflare Access");
    if (config.preview_urls !== false) say("preview_urls must be false: a Preview URL would bypass Cloudflare Access");
    if (config.keep_vars !== true) say("keep_vars must be true, so a deploy keeps HOSTED_AI, BLOCKS_BETA and BETA_OPERATOR_LOG as set in the dashboard");
    const assets = config.assets ?? {};
    if (assets.binding !== "ASSETS" || assets.not_found_handling !== "404-page") say('assets must bind ASSETS with not_found_handling "404-page"');
    if (!same(assets.run_worker_first, ["/api/*"])) say('assets.run_worker_first must be ["/api/*"], so the Worker answers only the API');
  }
  if (production.assets?.directory !== PRODUCTION.directory) {
    problems.push(`${PRODUCTION.file}: assets.directory must stay ${PRODUCTION.directory}, the default artifact: Workers Builds deploys this config on every merge`);
  }
  if (experimental.assets?.directory !== EXPERIMENTAL.directory) problems.push(`${EXPERIMENTAL.file}: assets.directory must be ${EXPERIMENTAL.directory}, the experimental artifact`);
  // Apart from the artifact, the two are the same Worker: the same code, runtime, bindings and limits.
  const artifactless = (key, value) => (key === "assets" && value && typeof value === "object" ? { ...value, directory: undefined } : value);
  for (const key of new Set([...Object.keys(production), ...Object.keys(experimental)])) {
    if (!same(artifactless(key, production[key]), artifactless(key, experimental[key]))) {
      problems.push(`${EXPERIMENTAL.file}: ${key} must equal ${PRODUCTION.file}'s: the two configs are the one composer Worker and differ only in assets.directory`);
    }
  }
  return problems;
}

function chunkFiles(dir) {
  const files = [];
  const walk = (at) => {
    for (const entry of readdirSync(at)) {
      const path = join(at, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith(".js")) files.push(path);
    }
  };
  const chunks = join(dir, "_next", "static", "chunks");
  if (existsSync(chunks)) walk(chunks);
  return files;
}

/** The built artifact is an experimental build that carries the beta switch. */
export function checkArtifact(dir) {
  if (!existsSync(dir)) return [`${dir} is missing: run pnpm --filter composer build:experimental first`];
  const problems = [];
  if (!existsSync(join(dir, "index.html"))) problems.push(`${dir}/index.html is missing`);
  const bodies = chunkFiles(dir).map((file) => readFileSync(file, "utf8"));
  for (const [marker, why] of ARTIFACT_MARKERS) {
    if (!bodies.some((body) => body.includes(marker))) problems.push(`no chunk under ${dir}/_next/static/chunks carries ${marker}: ${why}`);
  }
  return problems;
}

const REDIRECTS = [301, 302, 303, 307, 308];
const PROBE_TIMEOUT_MS = 15_000;
const describe = (error) => String(error?.cause?.code ?? error?.cause?.message ?? (error?.name === "TimeoutError" ? "TimeoutError" : error?.message) ?? error);

/**
 * Sent to the Cloudflare Access login: a redirect to the Access team domain's
 * login path, or to the Access path on the hostname itself. A bare 401 or 403
 * proves nothing: a WAF rule or a bot challenge can stop this runner while
 * other visitors get through.
 */
function accessVerdict(url, method, res) {
  if (REDIRECTS.includes(res.status)) {
    let to;
    try {
      to = new URL(res.headers.get("location") ?? "", url);
    } catch {
      return `${url} redirects to an unreadable location`;
    }
    const own = new URL(url);
    const accessPath = to.protocol === "https:" && to.pathname.startsWith("/cdn-cgi/access/");
    const accessHost = to.hostname.endsWith(".cloudflareaccess.com") || to.hostname === own.hostname;
    return accessPath && accessHost ? null : `${url} redirects to ${to.origin}${to.pathname}, not to the Cloudflare Access login`;
  }
  const mitigated = res.headers.get("cf-mitigated");
  return `${url} answered ${res.status}${mitigated ? ` (cf-mitigated: ${mitigated})` : ""} to an anonymous ${method}, not the Cloudflare Access login`;
}

/**
 * What each check requests: the page, the API and a path under the static
 * assets, then the generation endpoint itself. The POST's body is empty, so a
 * Worker that answered it would refuse it before any model call.
 */
const PROBES = [
  { path: "/", method: "GET" },
  { path: "/api/models", method: "GET" },
  { path: "/_next/static/access-probe", method: "GET" },
  { path: "/api/propose", method: "POST" },
];

/**
 * Anonymous requests for the page, the API, the static assets and a POST to
 * /api/propose must all be sent to the Cloudflare Access login. The hostname
 * always exists, so `phase` "before" (the deploy) refuses any failure at once;
 * "after" retries a failure to reach the page 50 times, 6 seconds apart (about
 * five minutes, longer when a probe hangs to its timeout), then fails. Every
 * probe has a timeout.
 */
export async function checkAccess(baseUrl, { phase, fetchImpl = fetch, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), attempts = 50, delayMs = 6000 } = {}) {
  if (phase !== "before" && phase !== "after") throw new Error('phase must be "before" or "after"');
  const base = baseUrl.replace(/\/+$/, "");
  const probe = ({ path, method }) =>
    fetchImpl(`${base}${path}`, {
      method,
      redirect: "manual",
      credentials: "omit",
      headers: method === "POST" ? { accept: "text/html", "content-type": "application/json" } : { accept: "text/html" },
      ...(method === "POST" ? { body: "{}" } : {}),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  let page;
  let failure;
  for (let i = 0; i < (phase === "after" ? attempts : 1); i++) {
    if (i > 0) await wait(delayMs);
    try {
      page = await probe(PROBES[0]);
      break;
    } catch (error) {
      failure = error;
    }
  }
  if (!page) return [`${base} could not be reached ${phase} the deploy (${describe(failure)})`];
  const problems = [];
  const pageVerdict = accessVerdict(`${base}${PROBES[0].path}`, PROBES[0].method, page);
  if (pageVerdict) problems.push(pageVerdict);
  for (const request of PROBES.slice(1)) {
    try {
      const verdict = accessVerdict(`${base}${request.path}`, request.method, await probe(request));
      if (verdict) problems.push(verdict);
    } catch (error) {
      problems.push(`${base}${request.path} could not be reached (${describe(error)})`);
    }
  }
  return problems;
}

async function main(argv) {
  const repo = fileURLToPath(new URL("../../../", import.meta.url));
  const access = argv.find((a) => a.startsWith("--access="))?.slice("--access=".length);
  let problems;
  if (access !== undefined) {
    problems = await checkAccess(`https://${WORKER.hostname}`, { phase: access });
  } else {
    problems = [
      ...checkConfigs({ production: readConfig(join(repo, PRODUCTION.file)), experimental: readConfig(join(repo, EXPERIMENTAL.file)) }),
      ...checkArtifact(join(repo, "apps", "composer", "out-experimental")),
    ];
  }
  if (problems.length > 0) {
    console.error(`check-experimental-deploy: refusing:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`check-experimental-deploy: ${access !== undefined ? `anonymous requests go to the Cloudflare Access login (${access} the deploy)` : "configs and artifact pass"}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`check-experimental-deploy: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
