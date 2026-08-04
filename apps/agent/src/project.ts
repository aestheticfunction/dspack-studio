/**
 * Composer project routes: the local agent is the bridge between the composer
 * app and a user project's FILES. Every route is thin orchestration over
 * published packages — the agent parses nothing itself:
 *
 *   POST /project/connect   { path }                  -> manifest + ledger + inventory
 *   POST /project/discover  { path }                  -> dspack-export CLI (bootstrap / refusal verbatim)
 *   POST /project/emit      { path }                  -> loadProfile + transformFromJson + emitSurface -> out/
 *   POST /project/validate  { path }                  -> dspack-validate CLI + dspack-gen/core lintSurface
 *   POST /project/save      { path, kind, document }  -> shape-gated, ledger-preserving atomic write
 *   POST /project/run       { path, prompt, intent, modelRef } -> AG-UI SSE generation
 *                             under the PROJECT contract + profile (scoped vocabulary)
 *
 * Security bounds: `path` must be an absolute existing directory containing
 * project.json; every file access resolves inside it (the two CLI spawns and
 * the contract/profile/surface reads). This is the same BYO-machine trust
 * model as the rest of the agent: local process, local files, no credentials
 * from the browser. dspack-export is imported/spawned ONLY here (import-
 * isolation rule, mirroring @a2ui/* and @ag-ui/* confinement).
 */
import { execFile } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { ServerResponse } from "node:http";
import {
  loadProfile,
  transformFromJson,
  emitSurface,
  EmitSurfaceError,
  ProfileLoadError,
  type Profile,
  type A2uiVersion,
} from "@aestheticfunction/dspack-emit";
import { lintSurface } from "@aestheticfunction/dspack-gen/core";
import { runPipeline, ScriptedAdapter, adapterFor, OllamaAdapter } from "@aestheticfunction/dspack-gen";
import { exportProject, regenerateSections } from "@aestheticfunction/dspack-export";
import { compileSchemaSet, documentReport, type ValidatorMap } from "@aestheticfunction/dspack-spec/lib/validate.mjs";
import {
  ledgerStatus,
  parseProjectManifest,
  preservesLedger,
  finding,
  classifySurfaceRefusal,
  type ComposerFinding,
  type ProjectManifest,
} from "@dspack-studio/composer-core";
import {
  createPipelineEventMapper,
  createSseEncoder,
  runErrorEvent,
  type BaseEvent,
  type PipelineEvent as BridgePipelineEvent,
} from "@dspack-studio/agui-bridge";

const require = createRequire(import.meta.url);
const execFileP = promisify(execFile);

/** Resolve a sibling package's file without relying on its exports map. */
function packageFile(pkg: string, rel: string): string {
  return join(dirname(require.resolve(`${pkg}/package.json`)), rel);
}

/**
 * The dspack harness, in-process: schemas read once from the installed
 * dspack-spec package, checks imported from its lib — identical wording to
 * the dspack-validate CLI by construction (one-validator principle).
 */
let harness: ValidatorMap | undefined;
function specValidators(): ValidatorMap {
  if (!harness) {
    const schemaDir = packageFile("@aestheticfunction/dspack-spec", "schema");
    const schemas: Record<string, unknown> = {};
    for (const file of readdirSync(schemaDir).filter((f) => f.endsWith(".schema.json"))) {
      schemas[file] = JSON.parse(readFileSync(join(schemaDir, file), "utf8"));
    }
    const { validators, failures } = compileSchemaSet(schemas);
    if (failures.length) throw new Error(`dspack-spec schemas failed to compile: ${failures.join("; ")}`);
    harness = validators;
  }
  return harness;
}

class ProjectError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface ProjectContext {
  root: string;
  manifest: ProjectManifest;
  contractPath: string;
  profilePath: string;
  outDir: string;
}

function inside(root: string, rel: string): string {
  const abs = resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new ProjectError(400, `path '${rel}' escapes the project directory`);
  }
  return abs;
}

function openProject(rawPath: unknown): ProjectContext {
  if (typeof rawPath !== "string" || !isAbsolute(rawPath)) {
    throw new ProjectError(400, "path must be an absolute project directory");
  }
  const root = resolve(rawPath);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new ProjectError(404, `no directory at '${root}'`);
  }
  const manifestPath = join(root, "project.json");
  if (!existsSync(manifestPath)) {
    throw new ProjectError(404, `no project.json in '${root}'`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    throw new ProjectError(400, "project.json is not valid JSON");
  }
  const result = parseProjectManifest(parsed);
  if (!result.ok) {
    throw new ProjectError(400, `project.json invalid: ${result.issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`);
  }
  const manifest = result.manifest;
  return {
    root,
    manifest,
    contractPath: inside(root, manifest.contractPath),
    profilePath: inside(root, manifest.profilePath),
    outDir: inside(root, manifest.outDir),
  };
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

function atomicWriteJson(path: string, value: unknown): void {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  renameSync(tmp, path);
}

/** Surfaces available for emit/preview: contract examples + surfacesDir files. */
function projectSurfaces(ctx: ProjectContext, contract: Record<string, unknown>): Array<{ name: string; surface: unknown }> {
  const out: Array<{ name: string; surface: unknown }> = [];
  for (const example of (contract.examples as Array<{ id?: string; surface?: unknown }> | undefined) ?? []) {
    if (example.surface) out.push({ name: example.id ?? "example", surface: example.surface });
  }
  if (ctx.manifest.surfacesDir) {
    const dir = inside(ctx.root, ctx.manifest.surfacesDir);
    if (existsSync(dir)) {
      for (const file of readdirSync(dir).filter((f) => f.endsWith(".dsurface.json")).sort()) {
        out.push({ name: file.replace(/\.dsurface\.json$/, ""), surface: readJson(join(dir, file)) });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------

async function connect(ctx: ProjectContext) {
  const contract = existsSync(ctx.contractPath) ? (readJson(ctx.contractPath) as Record<string, unknown>) : null;
  const profileExists = existsSync(ctx.profilePath);
  let profileIssue: string | null = null;
  if (profileExists) {
    try {
      loadProfile(readJson(ctx.profilePath));
    } catch (e) {
      profileIssue = e instanceof Error ? e.message : String(e);
    }
  }
  return {
    manifest: ctx.manifest,
    contract,
    ledger: contract ? await ledgerStatus(contract) : null,
    profile: profileExists ? readJson(ctx.profilePath) : null,
    profileIssue,
    // surfacesDir extras ship with content so the browser's live emit loop
    // covers them; contract examples are derivable from the contract itself.
    extraSurfaces: contract
      ? projectSurfaces(ctx, contract).filter(
          (s) => !((contract.examples as Array<{ id?: string }> | undefined) ?? []).some((e) => e.id === s.name),
        )
      : [],
  };
}

function exportConfig(ctx: ProjectContext): string {
  const configRel = ctx.manifest.exportConfigPath;
  if (!configRel) {
    throw new ProjectError(400, "this project has no exportConfigPath (imported contract; discovery does not apply)");
  }
  return inside(ctx.root, configRel);
}

async function discover(ctx: ProjectContext) {
  const config = exportConfig(ctx);
  // First bootstrap only: the whole-file refusal table applies when a
  // contract already exists (use /project/rediscover for the iterative path).
  if (existsSync(ctx.contractPath)) {
    const { decideRegeneration } = await import("@aestheticfunction/dspack-export");
    const decision = decideRegeneration(readFileSync(ctx.contractPath, "utf8"));
    if (!decision.allow) throw new ProjectError(409, decision.reason);
  }
  try {
    const { document, warnings } = exportProject(config);
    atomicWriteJson(ctx.contractPath, document);
    const contract = document as unknown as Record<string, unknown>;
    return {
      ok: true,
      log: warnings.length ? `discovery warnings: ${warnings.join("; ")}` : "discovery clean",
      contract,
      ledger: await ledgerStatus(contract),
    };
  } catch (e) {
    // dspack-export's own words pass through — refusals are never rephrased.
    throw new ProjectError(409, (e instanceof Error ? e.message : String(e)).trim());
  }
}

/**
 * Section-scoped rediscovery: fresh extraction merged at the ledger's
 * granularity (dspack-export regenerateSections) — tool-owned refreshes,
 * human-owned and governance preserved, new components added.
 * `restoreTopLevel` passes explicit owner intents through (the ratified
 * "Restore top-level" conflict resolution); the tool's refusals are
 * returned verbatim.
 */
async function rediscover(ctx: ProjectContext, body: Record<string, unknown>) {
  const config = exportConfig(ctx);
  if (!existsSync(ctx.contractPath)) {
    throw new ProjectError(409, "no contract exists yet; run discovery first");
  }
  const restoreTopLevel = body.restoreTopLevel;
  if (restoreTopLevel !== undefined && (!Array.isArray(restoreTopLevel) || restoreTopLevel.some((id) => typeof id !== "string"))) {
    throw new ProjectError(400, "restoreTopLevel must be an array of component id strings");
  }
  const existing = readJson(ctx.contractPath) as Parameters<typeof regenerateSections>[0];
  let fresh;
  try {
    fresh = exportProject(config).document;
  } catch (e) {
    throw new ProjectError(409, (e instanceof Error ? e.message : String(e)).trim());
  }
  const result = regenerateSections(existing, fresh, restoreTopLevel ? { restoreTopLevel: restoreTopLevel as string[] } : undefined);
  if (!result.ok) throw new ProjectError(409, result.reason);
  // One-validator principle: every contract write passes the same harness
  // gate as /project/save — a merge that produced an invalid document is
  // refused, not persisted.
  const report = documentReport(result.document as unknown as Record<string, unknown>, specValidators());
  if (!report.valid) {
    throw new ProjectError(409, `rediscovery produced a document the harness rejects; nothing was written: ${report.errors.join("; ")}`);
  }
  atomicWriteJson(ctx.contractPath, result.document);
  const contract = result.document as unknown as Record<string, unknown>;
  return { ok: true, contract, ledger: await ledgerStatus(contract), report: result.report };
}

function emit(ctx: ProjectContext) {
  const contract = readJson(ctx.contractPath) as Record<string, unknown>;
  // The profile as authored (JSON): casualty declarations and their written
  // reasons are read from this, never from emitted message text.
  const profileJson = readJson(ctx.profilePath) as Record<string, unknown>;
  let profile: Profile;
  try {
    profile = loadProfile(profileJson);
  } catch (e) {
    if (e instanceof ProfileLoadError) {
      return {
        ok: false as const,
        findings: e.issues.map((i) => finding("profile", "schema", "error", i.path, i.message)),
      };
    }
    throw e;
  }

  const surfaces = projectSurfaces(ctx, contract);
  const emitted: Array<{ name: string; messages?: unknown[]; warnings: Array<{ code: string; message: string }>; error?: string }> = [];
  const allMessages: unknown[] = [];
  for (const { name, surface } of surfaces) {
    try {
      const result = emitSurface(surface as Parameters<typeof emitSurface>[0], contract as Parameters<typeof emitSurface>[1], { profile });
      emitted.push({ name, messages: result.messages, warnings: result.warnings as Array<{ code: string; message: string }> });
      allMessages.push(...result.messages);
    } catch (e) {
      if (e instanceof EmitSurfaceError) {
        emitted.push({ name, warnings: [], error: e.message });
        continue;
      }
      throw e;
    }
  }

  mkdirSync(ctx.outDir, { recursive: true });
  const versions: A2uiVersion[] = ["0.9.1", "1.0"];
  const runs = versions.map((version) => {
    const out = transformFromJson(contract as Parameters<typeof transformFromJson>[0], { a2uiVersion: version, surface: { messages: allMessages }, profile });
    const seg = version === "0.9.1" ? "v0_9_1" : "v1_0";
    atomicWriteJson(join(ctx.outDir, `catalog.${seg}.json`), out.catalog);
    atomicWriteJson(join(ctx.outDir, `report.${seg}.json`), out.report.json);
    return { version, out };
  });
  for (const { name, messages } of emitted) {
    if (messages) atomicWriteJson(join(ctx.outDir, `${name}.surface.json`), { messages });
  }

  const primary = runs[0].out;
  const findings: ComposerFinding[] = [];
  for (const { version, out } of runs) {
    for (const gate of out.validation.gates) {
      if (!gate.pass) {
        const gateId = gate.name.startsWith("schema-compile") ? "A1" : gate.name === "catalog-shape" ? "A2" : "A3";
        findings.push(finding(gateId as "A1", gate.name, "error", `a2ui@${version}`, (gate.errors ?? []).join("; ") || gate.name));
      }
    }
  }
  for (const c of primary.mapping.coverage) {
    if (c.disposition === "unclassified") {
      findings.push(finding("coverage", "unclassified", "error", c.id, "component is neither mapped, adapted, omitted, nor a declared casualty"));
    }
  }
  for (const f of primary.mapping.fidelity) {
    if (f.class === "lossy" || f.class === "cannot-represent") {
      findings.push(finding("fidelity", f.class, "warn", f.source, f.note));
    }
  }
  for (const { name, warnings, error } of emitted) {
    if (error) {
      // An emit refusal caused solely by components the profile author
      // declared casualties (with a written reason) is an acknowledged
      // decision, not unresolved work. The finding keeps its severity,
      // code, target, and verbatim message; the classification is
      // structured evidence attached alongside.
      const base = finding("A3", "emit-surface", "error", name, error);
      const surface = surfaces.find((s) => s.name === name)?.surface;
      const acknowledged = classifySurfaceRefusal(surface, contract, profileJson);
      findings.push(acknowledged ? { ...base, acknowledged } : base);
    }
    for (const w of warnings) findings.push(finding("A3", w.code, "info", name, w.message));
  }

  return {
    ok: runs.every((r) => r.out.validation.pass),
    catalog: runs[0].out.catalog,
    report: primary.report.json,
    surfaces: emitted,
    findings,
  };
}

async function validate(ctx: ProjectContext) {
  const findings: ComposerFinding[] = [];
  const report = documentReport(readJson(ctx.contractPath), specValidators());
  for (const error of report.errors) {
    findings.push(finding("document", "harness", "error", "", error));
  }

  const contract = readJson(ctx.contractPath) as Record<string, unknown>;
  for (const { name, surface } of projectSurfaces(ctx, contract)) {
    const report = lintSurface(surface, contract as Parameters<typeof lintSurface>[1]);
    for (const gate of report.gates) {
      if (gate.status === "FAIL") {
        for (const error of gate.errors ?? []) findings.push(finding(gate.gate as "S1", "lint", "error", name, error));
      }
    }
    for (const f of report.findings) {
      findings.push(
        finding("S3", f.ruleId, f.level === "error" ? "error" : "warn", `${name} ${f.location.path}`, `${f.message} — ${f.rationale}`),
      );
    }
  }
  return { ok: findings.every((f) => f.severity !== "error"), findings };
}

async function save(ctx: ProjectContext, body: Record<string, unknown>) {
  const kind = body.kind;
  const document = body.document as Record<string, unknown> | undefined;
  if ((kind !== "contract" && kind !== "profile") || document === undefined) {
    throw new ProjectError(400, "kind ('contract' | 'profile') and document are required");
  }
  if (kind === "profile") {
    try {
      loadProfile(document);
    } catch (e) {
      if (e instanceof ProfileLoadError) {
        return { ok: false, findings: e.issues.map((i) => finding("profile", "schema", "error", i.path, i.message)) };
      }
      throw e;
    }
    atomicWriteJson(ctx.profilePath, document);
    return { ok: true, findings: [] };
  }
  // contract: the ledger is provenance — a save may never drop it.
  const existing = existsSync(ctx.contractPath) ? (readJson(ctx.contractPath) as Record<string, unknown>) : {};
  if (!preservesLedger(existing, document)) {
    return {
      ok: false,
      findings: [finding("ledger", "ledger-dropped", "error", 'metadata["x-bootstrap"]', "a save may not remove the bootstrap ledger; edits make sections human-owned, deleting provenance is refused")],
    };
  }
  const report = documentReport(document, specValidators());
  if (!report.valid) {
    return { ok: false, findings: report.errors.map((e) => finding("document", "harness", "error", "", e)) };
  }
  atomicWriteJson(ctx.contractPath, document);
  return { ok: true, findings: [], ledger: await ledgerStatus(document) };
}

// ---------------------------------------------------------------------------

/** Ollama window mirroring pipeline.ts (BYO-inference configuration). */
const OLLAMA_OPTIONS = { num_ctx: 16384, num_predict: 4096 };
function ollamaAdapterWithWindow(modelRef: string) {
  return new OllamaAdapter({
    model: modelRef.slice("ollama:".length),
    fetch: ((url: unknown, init: { body: string }) => {
      const body = JSON.parse(init.body);
      body.options = { ...body.options, ...OLLAMA_OPTIONS };
      return fetch(url as string, { ...init, body: JSON.stringify(body) });
    }) as typeof fetch,
  });
}

/** AG-UI SSE generation under the PROJECT contract + profile. */
async function runProject(ctx: ProjectContext, body: Record<string, unknown>, res: ServerResponse, cors: Record<string, string>, accept: string | undefined) {
  const contract = readJson(ctx.contractPath) as Record<string, unknown>;
  const profile = loadProfile(readJson(ctx.profilePath));
  const prompt = String(body.prompt ?? "");
  const intents = (contract.intents as Array<{ id: string }> | undefined) ?? [];
  const intent = String(body.intent ?? intents[0]?.id ?? "");
  const modelRef = String(body.modelRef ?? "scripted");

  const examples = (contract.examples as Array<{ intent: string; surface: unknown }> | undefined) ?? [];
  const example = examples.find((e) => e.intent === intent) ?? examples[0];
  if (modelRef === "scripted" && !example) {
    throw new ProjectError(400, "scripted mode needs at least one worked example in the contract");
  }
  const adapter =
    modelRef === "scripted"
      ? new ScriptedAdapter([{ output: example!.surface }])
      : modelRef.startsWith("ollama:")
        ? ollamaAdapterWithWindow(modelRef)
        : adapterFor(modelRef);

  const encoder = createSseEncoder(accept);
  res.writeHead(200, { "content-type": encoder.contentType, "cache-control": "no-cache", connection: "keep-alive", ...cors });
  const threadId = `project-${ctx.manifest.name}`;
  const runId = String(body.runId ?? `run-${Date.now()}`);
  const map = createPipelineEventMapper({ threadId, runId });
  try {
    await runPipeline({
      contract: contract as Parameters<typeof runPipeline>[0]["contract"],
      intent,
      prompt,
      adapter,
      maxRepairs: 2,
      emitProfile: profile,
      onEvent: (event) => {
        // The bridge's PipelineEvent is a structural mirror of dspack-gen's
        // union (retired once dspack-gen#48 re-exports the type).
        for (const agui of map(event as unknown as BridgePipelineEvent)) res.write(encoder.encode(agui as BaseEvent));
      },
    });
  } catch (error) {
    res.write(encoder.encode(runErrorEvent(error instanceof Error ? error.message : String(error))));
  }
  res.end();
}

// ---------------------------------------------------------------------------

/**
 * Dispatch a /project/* route. Returns true when the route was handled.
 * `json` mirrors the server's response helper.
 */
export async function handleProjectRoute(
  path: string,
  body: Record<string, unknown>,
  res: ServerResponse,
  cors: Record<string, string>,
  accept: string | undefined,
  json: (res: ServerResponse, status: number, payload: unknown, cors: Record<string, string>) => void,
): Promise<boolean> {
  if (!path.startsWith("/project/")) return false;
  const route = path.slice("/project/".length);
  try {
    const ctx = openProject(body.path);
    switch (route) {
      case "connect":
        json(res, 200, await connect(ctx), cors);
        return true;
      case "discover":
        json(res, 200, await discover(ctx), cors);
        return true;
      case "rediscover":
        json(res, 200, await rediscover(ctx, body), cors);
        return true;
      case "emit":
        json(res, 200, emit(ctx), cors);
        return true;
      case "validate":
        json(res, 200, await validate(ctx), cors);
        return true;
      case "save":
        json(res, 200, await save(ctx, body), cors);
        return true;
      case "run":
        await runProject(ctx, body, res, cors, accept);
        return true;
      default:
        json(res, 404, { error: `unknown project route '${route}'` }, cors);
        return true;
    }
  } catch (e) {
    if (e instanceof ProjectError) {
      json(res, e.status, { error: e.message }, cors);
      return true;
    }
    json(res, 500, { error: e instanceof Error ? e.message : String(e) }, cors);
    return true;
  }
}
