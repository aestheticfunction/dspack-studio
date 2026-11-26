#!/usr/bin/env node
/**
 * Verifies that hosted generation is OFF on the composer Worker, both as configured and as served
 * (docs/incidents/2026-11-26-hosted-ai-inherited.md). Used after every deploy, by both deploy paths.
 *
 *   effective configuration (needs CLOUDFLARE_API_TOKEN; CLOUDFLARE_ACCOUNT_ID optional):
 *     - every version in the ACTIVE deployment has HOSTED_AI exactly "off";
 *     - the LATEST UPLOADED version, the one the next upload's kept variables come from, has HOSTED_AI
 *       exactly "off". The two differ: a version can be uploaded without being deployed.
 *   public behaviour (no credentials):
 *     - GET /api/models offers no "hosted-ai";
 *     - POST /api/propose with an empty body is refused before any provider call (503 "unavailable").
 *     With --expect-access, both must instead be answered by Cloudflare Access (the beta).
 *
 *   node apps/composer/scripts/verify-hosted-ai-off.mjs [--config-only | --public-only]
 *        [--base https://composer.aesthetic-function.com] [--expect-access] [--watch SECONDS]
 *
 * --watch repeats the public checks every 30 s for that long and fails on the first bad answer: what the
 * CI job on main uses while Workers Builds deploys the merge. Exits 0 when every check passes, 1 when any
 * fails, 2 on a usage or credential error. It never changes anything.
 */
import { fileURLToPath } from "node:url";

export const SCRIPT = "dspack-studio-composer";
export const BASE = "https://composer.aesthetic-function.com";
const API = "https://api.cloudflare.com/client/v4";

const hostedAiOf = (version) => {
  const b = (version?.bindings ?? []).find((x) => x?.name === "HOSTED_AI");
  if (!b) return { declared: false };
  return { declared: true, type: b.type, value: b.text ?? b.json };
};

async function cf(fetchImpl, token, path) {
  const res = await fetchImpl(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) throw new Error(`Cloudflare API ${path}: ${res.status} ${JSON.stringify(body?.errors ?? body).slice(0, 200)}`);
  return body.result;
}

/** The effective configuration: the active deployment's versions and the latest upload. */
export async function checkEffectiveConfig({ fetchImpl = fetch, token, accountId, script = SCRIPT }) {
  if (!token) throw new UsageError("CLOUDFLARE_API_TOKEN is not set");
  const account = accountId || (await cf(fetchImpl, token, "/accounts"))?.[0]?.id;
  if (!account) throw new UsageError("no account is visible to this token; set CLOUDFLARE_ACCOUNT_ID");
  const problems = [];
  const facts = [];
  const look = async (label, id) => {
    const version = await cf(fetchImpl, token, `/accounts/${account}/workers/workers/${script}/versions/${id}`);
    const h = hostedAiOf(version);
    facts.push(`${label} ${id}: HOSTED_AI ${h.declared ? JSON.stringify(h.value) : "absent"}`);
    if (!h.declared) problems.push(`${label} ${id} declares no HOSTED_AI: the deploy did not apply the config's "off"`);
    else if (h.type !== "plain_text" || h.value !== "off") problems.push(`${label} ${id} has HOSTED_AI ${JSON.stringify(h.value)}, not "off"`);
  };
  const deployments = await cf(fetchImpl, token, `/accounts/${account}/workers/scripts/${script}/deployments`);
  const active = deployments?.deployments?.[0];
  if (!active?.versions?.length) problems.push("no active deployment was found");
  for (const v of active?.versions ?? []) await look(`active (${v.percentage}%)`, v.version_id);
  const listed = await cf(fetchImpl, token, `/accounts/${account}/workers/scripts/${script}/versions?per_page=1`);
  const latest = (Array.isArray(listed) ? listed : listed?.items)?.[0]?.id;
  if (!latest) problems.push("no uploaded version was found");
  else if (!(active?.versions ?? []).some((v) => v.version_id === latest)) await look("latest upload (not deployed)", latest);
  else facts.push(`latest upload ${latest} is the active version`);
  return { problems, facts };
}

const ACCESS = (res) => [301, 302, 303, 401, 403].includes(res.status) || /cloudflareaccess\.com/.test(res.headers.get("location") ?? "");

/** The public behaviour: no hosted model offered, and a generation request refused before any provider call. */
export async function checkPublic({ fetchImpl = fetch, base = BASE, expectAccess = false }) {
  const problems = [];
  const facts = [];
  const models = await fetchImpl(`${base}/api/models`, { redirect: "manual" });
  if (expectAccess) {
    if (!ACCESS(models)) problems.push(`GET /api/models answered ${models.status}, not Cloudflare Access`);
    else facts.push(`GET /api/models: Access (${models.status})`);
  } else {
    const body = await models.json().catch(() => null);
    const list = Array.isArray(body?.models) ? body.models : null;
    if (!list) problems.push(`GET /api/models answered ${models.status} without a model list`);
    else if (list.includes("hosted-ai")) problems.push(`GET /api/models offers hosted-ai: ${JSON.stringify(list)}`);
    else facts.push(`GET /api/models: ${JSON.stringify(list)}`);
  }
  const propose = await fetchImpl(`${base}/api/propose`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", redirect: "manual" });
  if (expectAccess) {
    if (!ACCESS(propose)) problems.push(`POST /api/propose answered ${propose.status}, not Cloudflare Access`);
    else facts.push(`POST /api/propose: Access (${propose.status})`);
  } else {
    const body = await propose.json().catch(() => null);
    if (propose.status !== 503 || body?.error !== "unavailable") {
      problems.push(`POST /api/propose answered ${propose.status} ${JSON.stringify(body?.error ?? null)}, not 503 "unavailable": the Worker did not refuse before reading the request`);
    } else facts.push('POST /api/propose: 503 "unavailable" (refused before any provider call)');
  }
  return { problems, facts };
}

class UsageError extends Error {}

export async function main(argv = process.argv.slice(2), env = process.env, { fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.log } = {}) {
  const flag = (name) => argv.includes(name);
  const value = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const base = value("--base") ?? BASE;
  const watch = Number(value("--watch") ?? 0);
  const expectAccess = flag("--expect-access");
  const problems = [];
  try {
    if (!flag("--public-only")) {
      const r = await checkEffectiveConfig({ fetchImpl, token: env.CLOUDFLARE_API_TOKEN, accountId: env.CLOUDFLARE_ACCOUNT_ID });
      r.facts.forEach((f) => log(`ok   ${f}`));
      problems.push(...r.problems);
    }
    if (!flag("--config-only")) {
      const deadline = Date.now() + watch * 1000;
      for (;;) {
        const r = await checkPublic({ fetchImpl, base, expectAccess });
        r.facts.forEach((f) => log(`ok   ${f}`));
        problems.push(...r.problems);
        if (r.problems.length > 0 || Date.now() + 30_000 > deadline) break;
        await sleep(30_000);
      }
    }
  } catch (error) {
    log(`error ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  for (const p of problems) log(`FAIL ${p}`);
  if (problems.length > 0) {
    log("Hosted generation may be reachable. Contain it now: docs/deployment.md, \"Hosted AI\", containment.");
    return 1;
  }
  log("Hosted generation is off.");
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => process.exit(code));
}
