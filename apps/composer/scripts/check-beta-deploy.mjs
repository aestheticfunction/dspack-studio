/**
 * Guards for the beta composer's deploy (docs/deployment.md, "The beta
 * composer"; docs/blocks/PHASE-2-RELEASE-PLAN.md, §6, layer 2). The
 * deploy-composer-beta workflow runs it, and so can anyone, from the
 * repository root:
 *
 *   node apps/composer/scripts/check-beta-deploy.mjs
 *     The configs and the artifact. Production's wrangler.jsonc still serves
 *     apps/composer/out on production's Worker and hostname; the beta's config
 *     is its own Worker on its own hostname, serving
 *     apps/composer/out-experimental with no workers.dev or preview URL and no
 *     declared vars; and the built artifact is an experimental build that
 *     carries the beta switch.
 *
 *   node apps/composer/scripts/check-beta-deploy.mjs --access=before|after
 *     An anonymous request to the beta hostname, its page and its API, must be
 *     sent to the Cloudflare Access login. Before the first deploy the hostname
 *     may not exist yet (DNS not found), which passes; any other failure does
 *     not, and after a deploy the hostname must resolve.
 *
 * Exits 1 on any problem, after printing every one.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

/** The wrangler the beta workflow runs, pinned. */
export const WRANGLER = "wrangler@4.146.0";

const PRODUCTION = { file: "wrangler.jsonc", name: "dspack-studio-composer", hostname: "composer.aesthetic-function.com", directory: "./apps/composer/out" };
const BETA = { file: "wrangler.composer-beta.jsonc", name: "dspack-studio-composer-beta", hostname: "composer-beta.aesthetic-function.com", directory: "./apps/composer/out-experimental" };
/** Everything the beta config may declare. Anything else (vars, env, other bindings, triggers) is refused. */
const BETA_KEYS = ["name", "compatibility_date", "compatibility_flags", "main", "observability", "routes", "workers_dev", "preview_urls", "keep_vars", "assets", "ai", "ratelimits"];
/** What the experimental artifact must carry: the sidecar envelope key (the e2e positive control) and the switch. */
const ARTIFACT_MARKERS = [
  ["blocksSidecar", "this is not an experimental build"],
  ["reference-not-in-beta", "this build has no beta switch"],
];

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A wrangler JSONC config, comments and trailing commas allowed. */
export function readConfig(path) {
  const { config, error } = ts.parseConfigFileTextToJson(path, readFileSync(path, "utf8"));
  if (error || config === undefined) {
    throw new Error(`${path}: ${error ? ts.flattenDiagnosticMessageText(error.messageText, "\n") : "no config"}`);
  }
  return config;
}

/** Every way the two configs depart from production's and the beta's. */
export function checkConfigs({ production, beta }) {
  const problems = [];
  const prod = (message) => problems.push(`${PRODUCTION.file}: ${message}`);
  const bet = (message) => problems.push(`${BETA.file}: ${message}`);

  if (production.name !== PRODUCTION.name) prod(`name must stay ${PRODUCTION.name}`);
  if (production.assets?.directory !== PRODUCTION.directory) prod(`assets.directory must stay ${PRODUCTION.directory}, the default artifact`);
  if (!same(production.routes, [{ pattern: PRODUCTION.hostname, custom_domain: true }])) prod(`its one route must stay the custom domain ${PRODUCTION.hostname}`);
  if (production.vars && Object.prototype.hasOwnProperty.call(production.vars, "BLOCKS_BETA")) prod("must not declare BLOCKS_BETA: the block switch is the beta's alone");

  for (const key of Object.keys(beta)) if (!BETA_KEYS.includes(key)) bet(`declares ${key}, which the beta config must not (vars belong in the dashboard, kept by keep_vars)`);
  if (beta.name !== BETA.name || beta.name === production.name) bet(`name must be ${BETA.name}, never production's`);
  if (beta.main !== production.main) bet(`main must be production's Worker code, ${production.main}`);
  if (beta.compatibility_date !== production.compatibility_date) bet(`compatibility_date must equal production's, ${production.compatibility_date}`);
  if (!same(beta.compatibility_flags, production.compatibility_flags)) bet("compatibility_flags must equal production's");
  if (!same(beta.routes, [{ pattern: BETA.hostname, custom_domain: true }])) bet(`its one route must be the custom domain ${BETA.hostname}, which Cloudflare Access protects`);
  if (beta.workers_dev !== false) bet("workers_dev must be false: a workers.dev URL would bypass Cloudflare Access");
  if (beta.preview_urls !== false) bet("preview_urls must be false: a preview URL would bypass Cloudflare Access");
  if (beta.keep_vars !== true) bet("keep_vars must be true, so a deploy keeps BLOCKS_BETA and HOSTED_AI as set in the dashboard");
  const assets = beta.assets ?? {};
  if (assets.directory !== BETA.directory) bet(`assets.directory must be ${BETA.directory}, the experimental artifact`);
  if (assets.binding !== "ASSETS" || assets.not_found_handling !== "404-page") bet('assets must bind ASSETS with not_found_handling "404-page", as production does');
  if (!same(assets.run_worker_first, ["/api/*"])) bet('assets.run_worker_first must be ["/api/*"], as production\'s');
  if (!same(beta.ai, { binding: "AI" })) bet('ai must be { "binding": "AI" }, the shared gateway\'s binding');
  const productionNamespaces = (production.ratelimits ?? []).map((r) => r.namespace_id);
  const limits = beta.ratelimits ?? [];
  if (limits.length !== 1 || limits[0].name !== "PROPOSE_RATE_LIMIT" || productionNamespaces.includes(limits[0].namespace_id)) {
    bet("ratelimits must declare PROPOSE_RATE_LIMIT once, in a namespace production does not use");
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
/** The hostname does not exist (yet): a first deploy creates its DNS record. Nothing else counts as this. */
const notFound = (error) => error?.cause?.code === "ENOTFOUND" || error?.code === "ENOTFOUND";

/**
 * Sent to the Cloudflare Access login: a redirect to the Access team domain's
 * login path, or to the Access path on the beta hostname itself. A bare 401
 * or 403 proves nothing: a WAF rule or a bot challenge can stop this runner
 * while other visitors get through.
 */
function accessVerdict(url, res) {
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
  return `${url} answered ${res.status}${mitigated ? ` (cf-mitigated: ${mitigated})` : ""} to an anonymous request, not the Cloudflare Access login`;
}

/**
 * An anonymous request to the page and to the API must be sent to the
 * Cloudflare Access login. `phase` "before" (the deploy) lets only a hostname
 * that does not exist yet pass, and refuses every other failure; "after"
 * retries any failure, since a new custom domain can take a moment, and fails
 * once the attempts are spent. Every probe has a timeout.
 */
export async function checkAccess(baseUrl, { phase, fetchImpl = fetch, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), attempts = 10, delayMs = 6000 } = {}) {
  if (phase !== "before" && phase !== "after") throw new Error('phase must be "before" or "after"');
  const base = baseUrl.replace(/\/+$/, "");
  const probe = (path) =>
    fetchImpl(`${base}${path}`, { method: "GET", redirect: "manual", credentials: "omit", headers: { accept: "text/html" }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
  let page;
  let failure;
  for (let i = 0; i < (phase === "after" ? attempts : 1); i++) {
    if (i > 0) await wait(delayMs);
    try {
      page = await probe("/");
      break;
    } catch (error) {
      failure = error;
    }
  }
  if (!page) {
    if (phase === "before" && notFound(failure)) {
      console.log(`check-beta-deploy: ${base} does not resolve (ENOTFOUND); allowed before the first deploy only`);
      return [];
    }
    return [`${base} could not be reached ${phase} the deploy (${describe(failure)})`];
  }
  const problems = [];
  const pageVerdict = accessVerdict(`${base}/`, page);
  if (pageVerdict) problems.push(pageVerdict);
  try {
    const apiVerdict = accessVerdict(`${base}/api/models`, await probe("/api/models"));
    if (apiVerdict) problems.push(apiVerdict);
  } catch (error) {
    problems.push(`${base}/api/models could not be reached (${describe(error)})`);
  }
  return problems;
}

async function main(argv) {
  const repo = fileURLToPath(new URL("../../../", import.meta.url));
  const access = argv.find((a) => a.startsWith("--access="))?.slice("--access=".length);
  let problems;
  if (access !== undefined) {
    const beta = readConfig(join(repo, BETA.file));
    problems = await checkAccess(`https://${beta.routes?.[0]?.pattern ?? BETA.hostname}`, { phase: access });
  } else {
    problems = [
      ...checkConfigs({ production: readConfig(join(repo, PRODUCTION.file)), beta: readConfig(join(repo, BETA.file)) }),
      ...checkArtifact(join(repo, "apps", "composer", "out-experimental")),
    ];
  }
  if (problems.length > 0) {
    console.error(`check-beta-deploy: refusing:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`check-beta-deploy: ${access !== undefined ? `anonymous requests go to the Cloudflare Access login (${access} the deploy)` : "configs and artifact pass"}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`check-beta-deploy: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
