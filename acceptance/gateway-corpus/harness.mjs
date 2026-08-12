// Gateway MCP corpus evidence harness. Makes LIVE model calls — never run in CI.
// See README.md in this directory for the rules and the operational notes.
// Drives the REAL pipeline: composer-core plan.ts (native TS import) → dspack-gen
// runPipeline (browser subpath, product-identical orchestrator) → dspack-emit —
// with the model turn on the production Worker (/api/propose), exactly like a
// hosted build in the product (adapter cloned from apps/composer/app/hosted-build.ts:118-151).
//
// Usage:
//   node harness.mjs <n> <ds>     one run   (n=1..12, ds=shadcn|astryx)
//   node harness.mjs all          full corpus, sequential, paced
//   GW_BASE=... overrides the gateway origin (default production).

import { readFileSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
// GW_CORPUS selects an alternate corpus module (e.g. ./paraphrases.mjs);
// GW_PREFIX prefixes evidence filenames so alternate runs never collide.
const CORPUS_MODULE = process.env.GW_CORPUS ?? "./corpus.mjs";
const PREFIX = process.env.GW_PREFIX ?? "run";
const { CORPUS } = await import(CORPUS_MODULE);

// Repo root, derived from this file's own location (acceptance/gateway-corpus/).
const REPO = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
// GW_GEN / GW_EMIT point the harness at local package builds (post-fix evidence
// runs on exact merged code before npm publish); default = the app's installed deps.
const GEN = realpathSync(process.env.GW_GEN ?? `${REPO}/apps/composer/node_modules/@aestheticfunction/dspack-gen`);
const EMIT = realpathSync(process.env.GW_EMIT ?? `${REPO}/apps/composer/node_modules/@aestheticfunction/dspack-emit`);
const BASE = process.env.GW_BASE ?? "https://composer.aesthetic-function.com";
const EVIDENCE = new URL("./evidence/", import.meta.url).pathname;
mkdirSync(EVIDENCE, { recursive: true });

const { runPipeline } = await import(`${GEN}/dist/browser.js`);
const { AdapterOutputError } = await import(`${GEN}/dist/adapters/types.js`);
const emitApi = await import(`${EMIT}/dist/index.js`);
const plan = await import(`${REPO}/packages/composer-core/src/plan.ts`);

const req = createRequire(`${EMIT}/dist/index.js`);
const Ajv2020 = req("ajv/dist/2020.js").default;
const addFormats = req("ajv-formats").default;

// Contracts + profiles exactly as Composer loads them (demo-data.ts:20-24).
// Native renderer name sets are the verified pre-merge registries
// (packages/shadcn-renderers/src/registry.tsx:29-44 minus Astryx-only names;
// packages/astryx-renderers/src/registry.tsx:23-36) — regression-locked by
// registry-parity.test.ts.
function loadDs(contractPath, profilePath, native) {
  const contract = JSON.parse(readFileSync(contractPath, "utf8"));
  const profileJson = JSON.parse(readFileSync(profilePath, "utf8"));
  const profile = emitApi.loadProfile(profileJson);
  return { contract, profileJson, profile, native: new Set(native) };
}
const DS = {
  shadcn: loadDs(
    `${REPO}/apps/composer/shadcn-v3-project/shadcn-ui.dspack.json`,
    `${REPO}/apps/composer/shadcn-v3-project/shadcn-v3.profile.json`,
    ["Alert", "AlertDialog", "Badge", "Button", "Card", "Column", "Dialog", "Select", "Table", "Text", "TextField"],
  ),
  astryx: loadDs(
    `${REPO}/apps/composer/astryx-project/astryx.dspack.json`,
    `${REPO}/apps/composer/astryx-project/astryx.profile.json`,
    ["AlertDialog", "Badge", "Button", "Card", "Column", "Dialog", "List", "MetadataList", "SelectableCard", "Table", "Text", "TextField"],
  ),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

// ---- gateway adapter — clone of hosted-build.ts:118-151, absolute base URL ----
const HOSTED_ID = "hosted-ai:claude-haiku-4.5";
let lastCall = 0;
const GAP_MS = 3000; // gentle inter-call spacing; behavior otherwise product-identical
async function pace() {
  const wait = lastCall + GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
}
const gatewayCalls = [];
const gatewayAdapter = {
  id: HOSTED_ID,
  async generate(request) {
    await pace();
    const t0 = Date.now();
    let res;
    try {
      res = await fetch(`${BASE}/api/propose`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ system: request.system, messages: request.messages, jsonSchema: request.jsonSchema }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (e) {
      gatewayCalls.push({ ms: Date.now() - t0, status: "network-error" });
      throw new AdapterOutputError(HOSTED_ID, `hosted AI request failed: ${e?.message ?? e}`);
    }
    if (!res.ok) {
      let msg = `hosted AI endpoint returned ${res.status}`;
      try {
        const body = await res.json();
        if (body && typeof body.message === "string") msg = body.message;
      } catch {}
      gatewayCalls.push({ ms: Date.now() - t0, status: res.status });
      throw new AdapterOutputError(HOSTED_ID, msg);
    }
    const body = await res.json();
    gatewayCalls.push({ ms: Date.now() - t0, status: 200 });
    const { json, raw, model, usage } = body ?? {};
    return { json, raw: raw ?? JSON.stringify(json), model: model ?? "hosted-ai", ...(usage ? { usage } : {}) };
  },
};

// ---- deterministic-score replication (plan.ts:121-160, constants copied exactly) ----
const STOP_WORDS = new Set(
  "a an the of for to and or with in on at your you i want need me my our create build make show give please that this it is are can new".split(" "),
);
const tokenize = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w));
function wordsMatch(a, b) {
  if (a === b) return true;
  const min = Math.min(a.length, b.length);
  let i = 0;
  while (i < min && a[i] === b[i]) i++;
  return i >= 4;
}
function replicateScores(goal, contract) {
  const intents = (Array.isArray(contract.intents) ? contract.intents : []).filter((i) => i && typeof i.id === "string");
  const goalTokens = tokenize(goal);
  const rows = intents.map((it) => {
    const hay = tokenize(`${it.name ?? ""} ${it.description ?? ""}`);
    const covered = goalTokens.filter((g) => hay.some((w) => wordsMatch(g, w)));
    return { intent: it.id, score: covered.length, covered: [...new Set(covered)] };
  });
  return { goalTokens, rows };
}

// ---- deep A3: same AJV config as dspack-emit ajv.ts:35-39, but FULL error objects ----
function deepA3(catalog, surface) {
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: true });
  addFormats(ajv);
  ajv.addSchema(catalog, catalog.$id);
  const validateAny = ajv.getSchema(`${catalog.$id}#/$defs/anyComponent`);
  if (!validateAny) return { error: "anyComponent schema not found" };
  const instances = emitApi.extractInstances(surface);
  const failing = [];
  for (const inst of instances) {
    if (!validateAny(inst)) {
      failing.push({
        component: inst.component,
        id: inst.id,
        errorCount: (validateAny.errors ?? []).length,
        errors: (validateAny.errors ?? []).map((e) => ({
          instancePath: e.instancePath, schemaPath: e.schemaPath, keyword: e.keyword, params: e.params, message: e.message,
        })),
      });
    }
  }
  return { totalInstances: instances.length, failingInstances: failing };
}

// ---- what the user would see (validation.ts:141-146 join; build.ts:274-291 explosion) ----
function reproduceUserFacing(report) {
  const validations = report?.emitted?.validations ?? [];
  const v091 = validations.find((v) => v.a2uiVersion === "0.9.1") ?? validations[0];
  const validateCells = (v091?.gates ?? []).filter((g) => !g.pass).map((g) => {
    const msg = (g.errors ?? []).join("; ") || g.name;
    return { gate: g.gate ?? g.name, name: g.name, chars: msg.length, preview: msg.slice(0, 240) };
  });
  let buildFailureRows = 0;
  for (const v of validations) for (const g of v.gates ?? []) if (!g.pass) buildFailureRows += (g.errors ?? ["gate failed"]).length;
  // refusal path: buildFailure's emitted.refusal branch (build.ts:266-272); in the
  // browser, browserEmit catches EmitSurfaceError → an A3 "emit-surface" finding,
  // acknowledged when classifySurfaceRefusal proves a declared casualty.
  const refusal = report?.emitted?.refusal ?? null;
  return { validateCells, buildFailureRows, refusal };
}

// components used per attempt (structured walk, mirrors extractInstances' spirit
// over dspack surfaces, which use "component" discriminators)
function surfaceComponents(node, out = new Set()) {
  if (Array.isArray(node)) { for (const x of node) surfaceComponents(x, out); return out; }
  if (node && typeof node === "object") {
    if (typeof node.component === "string") out.add(node.component);
    for (const v of Object.values(node)) surfaceComponents(v, out);
  }
  return out;
}

function gateSummary(report) {
  const att = report?.attempts ?? [];
  const last = att.at(-1);
  const s = {};
  for (const g of last?.gates ?? []) s[g.gate] = g.status;
  const emitted = report?.emitted;
  if (emitted?.validations) {
    for (const v of emitted.validations) {
      for (const g of v.gates ?? []) {
        const key = `${g.gate}@${v.a2uiVersion ?? "?"}`;
        s[key] = g.pass ? "PASS" : "FAIL";
      }
    }
  }
  if (emitted?.refusal) s.refusal = emitted.refusal;
  return { attempts: att.length, lastAttemptGates: s, outcome: report?.outcome };
}

// ---- one evidence run ----
async function runOne(n, dsName, retriesLeft = 2, retryCount = 0) {
  const p = CORPUS[n - 1];
  const d = DS[dsName];
  if (!p || !d) throw new Error(`bad args n=${n} ds=${dsName}`);
  const t0 = Date.now();
  const ev = {
    promptN: n, title: p.title, tool: p.tool, ds: dsName, base: BASE,
    goalSha256_16: sha(p.body), goal: p.body,
    startedAt: new Date().toISOString(), retryCount,
  };

  // 1) planning — deterministic + replicated scores + hosted (raw before reconcile)
  const det = plan.planDeterministic(p.body, d.contract);
  const scores = replicateScores(p.body, d.contract);
  const top = scores.rows.reduce((b, r) => (r.score > (b?.score ?? -1) ? r : b), null);
  ev.planning = {
    deterministic: det,
    replicatedScores: scores,
    replicationConsistent: top?.intent === det.intent,
  };
  try {
    const request = plan.buildPlanRequest(p.body, d.contract);
    const result = await gatewayAdapter.generate(request);
    ev.planning.hostedRaw = result.json;
    ev.planning.hosted = plan.reconcilePlan(result.json, d.contract, p.body);
    ev.planning.pathUsed = "hosted";
    ev.planning.intentClamped =
      typeof result.json?.intent === "string" && result.json.intent !== ev.planning.hosted.intent;
    ev.planning.feasibleCoerced = result.json?.feasible === false && ev.planning.hosted.feasible === true;
  } catch (e) {
    ev.planning.hostedError = String(e?.message ?? e);
    ev.planning.hosted = det;
    ev.planning.pathUsed = "deterministic-fallback"; // planning.ts:27-31 product behavior
  }
  const gp = ev.planning.hosted;

  // 2) product behavior on infeasible plan: vocab-gap turn, NO generation (state.tsx:1034-1041)
  if (gp.feasible === false) {
    ev.vocabGap = { missingCapability: gp.missingCapability, reason: gp.reason };
    ev.outcome = "vocab-gap";
    ev.durationMs = Date.now() - t0;
    save(ev);
    return ev;
  }

  // 3) generation through the real orchestrator (defaults: maxRepairs 2, both A2UI versions)
  const events = [];
  const result = await runPipeline({
    contract: d.contract,
    intent: gp.intent,
    prompt: gp.restated,
    adapter: gatewayAdapter,
    emitProfile: d.profile,
    onEvent: (e) => events.push(e),
  });
  ev.pipeline = {
    exitCode: result.exitCode,
    outcome: result.report?.outcome,
    gateSummary: gateSummary(result.report),
    attemptComponents: (result.report?.attempts ?? []).map((a) => ({
      index: a.index,
      components: a.surface ? [...surfaceComponents(a.surface)].sort() : [],
    })),
    report: result.report,
    events,
  };

  // gateway congestion → retry the whole run after backoff (evidence idempotent)
  const adapterErr = (result.report?.attempts ?? []).map((a) => a.adapterError).filter(Boolean).join(" | ");
  if (result.report?.outcome === "failed-adapter" && /busy|rate.?limit|429|503|capacity|unavailable|usable proposal/i.test(adapterErr) && retriesLeft > 0) {
    console.log(`  ~ gateway congested (${adapterErr.slice(0, 80)}) — backing off 90s, retrying run`);
    await sleep(90_000);
    return runOne(n, dsName, retriesLeft - 1, retryCount + 1);
  }

  // 4) final surface + A2UI messages
  const finalSurface = result.report?.attempts?.at(-1)?.surface ?? result.surface ?? null;
  let messages = result.surfaceMessages ?? null;
  if (!messages && finalSurface) {
    try {
      const es = emitApi.emitSurface(finalSurface, d.contract, { profile: d.profile });
      messages = es.messages;
      ev.emitFallback = { warnings: es.warnings };
    } catch (e) {
      ev.emitRefusal = String(e?.message ?? e);
    }
  }
  ev.hasFinalSurface = Boolean(finalSurface);
  ev.hasMessages = Boolean(messages);

  // 5) deep emit + A3 with full AJV error objects, both versions
  if (messages) {
    ev.deep = {};
    for (const v of ["0.9.1", "1.0"]) {
      try {
        const out = emitApi.transformFromJson(d.contract, { a2uiVersion: v, surface: { messages }, profile: d.profile });
        ev.deep[v] = {
          pass: out.validation.pass,
          gates: out.validation.gates,
          ajv: deepA3(out.catalog, { messages }),
        };
      } catch (e) {
        ev.deep[v] = { error: String(e?.message ?? e) };
      }
    }
    // 6) renderer coverage (pre-merge native sets; wireframe fallback is NOT failure)
    const used = [...new Set(emitApi.extractInstances({ messages }).map((i) => i.component))].sort();
    ev.renderer = {
      used,
      native: used.filter((c) => d.native.has(c)),
      wireframe: used.filter((c) => !d.native.has(c)),
    };
  }

  // 7) user-facing diagnostics reproduction
  ev.userFacing = reproduceUserFacing(result.report);
  ev.durationMs = Date.now() - t0;
  save(ev);
  return ev;
}

function save(ev) {
  const file = `${EVIDENCE}${PREFIX}-${String(ev.promptN).padStart(2, "0")}-${ev.ds}.json`;
  writeFileSync(file, JSON.stringify(ev, null, 1));
  const gates = ev.pipeline?.gateSummary?.lastAttemptGates ?? {};
  const gateStr = Object.entries(gates).map(([k, v]) => `${k}:${v}`).join(" ");
  console.log(
    `#${ev.promptN} ${ev.ds}: plan=${ev.planning?.hosted?.intent}(${ev.planning?.pathUsed})` +
    `${ev.vocabGap ? " VOCAB-GAP" : ` outcome=${ev.pipeline?.outcome} exit=${ev.pipeline?.exitCode}`}` +
    `${ev.renderer ? ` wf=${ev.renderer.wireframe.length}/${ev.renderer.used.length}` : ""}` +
    ` [${gateStr.slice(0, 120)}] ${Math.round((ev.durationMs ?? 0) / 1000)}s → ${file.split("/").pop()}`,
  );
}

// ---- CLI ----
const [, , a, b] = process.argv;
if (a === "all") {
  const { existsSync } = await import("node:fs");
  for (const dsName of ["shadcn", "astryx"]) {
    for (const p of CORPUS) {
      const file = `${EVIDENCE}${PREFIX}-${String(p.n).padStart(2, "0")}-${dsName}.json`;
      if (existsSync(file) && b !== "--force") {
        console.log(`#${p.n} ${dsName}: evidence exists, skipping (resume mode)`);
        continue;
      }
      try {
        await runOne(p.n, dsName);
      } catch (e) {
        console.error(`#${p.n} ${dsName} CRASHED: ${e?.stack ?? e}`);
        writeFileSync(`${EVIDENCE}${PREFIX}-${String(p.n).padStart(2, "0")}-${dsName}.crash.json`,
          JSON.stringify({ promptN: p.n, ds: dsName, crash: String(e?.stack ?? e) }, null, 1));
      }
      await sleep(Number(process.env.GW_RUN_GAP ?? 10_000));
    }
  }
  console.log(`gateway calls total: ${gatewayCalls.length}`);
} else if (a && b) {
  await runOne(Number(a), b);
  console.log(`gateway calls: ${gatewayCalls.length}`);
} else {
  console.log("usage: node harness.mjs <n> <shadcn|astryx> | node harness.mjs all");
}
