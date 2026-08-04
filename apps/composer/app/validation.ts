/**
 * In-browser validation: the SAME implementations the CLI and agent run,
 * imported — never re-implemented (the one-validator principle, now
 * importable end to end):
 *
 *   document gate + consistency  @aestheticfunction/dspack-spec lib
 *   S1/S2/S3 surface lint        @aestheticfunction/dspack-gen/core
 *   emit + A-gates + fidelity    @aestheticfunction/dspack-emit (browser-safe)
 *
 * Everything here is synchronous and pure; the agent stays the file-writing
 * authority, but every EDIT gets instant, gate-identical feedback.
 */
import {
  compileSchemaSet,
  documentReport,
  type ValidatorMap,
} from "@aestheticfunction/dspack-spec/lib/validate.mjs";
import dspackV04 from "@aestheticfunction/dspack-spec/schema/dspack.v0.4.schema.json";
import dspackV03 from "@aestheticfunction/dspack-spec/schema/dspack.v0.3.schema.json";
import surfaceV01 from "@aestheticfunction/dspack-spec/schema/dspack.surface.v0_1.schema.json";
import { lintSurface } from "@aestheticfunction/dspack-gen/core";
import {
  transformFromJson,
  emitSurface,
  loadProfile,
  EmitSurfaceError,
  ProfileLoadError,
  type Profile,
} from "@aestheticfunction/dspack-emit";
import { finding, classifySurfaceRefusal, type ComposerFinding } from "@dspack-studio/composer-core";

let compiled: ValidatorMap | undefined;
function validators(): ValidatorMap {
  if (!compiled) {
    const { validators: v, failures } = compileSchemaSet({
      "dspack.v0.3.schema.json": dspackV03,
      "dspack.v0.4.schema.json": dspackV04,
      "dspack.surface.v0_1.schema.json": surfaceV01,
    });
    if (failures.length) throw new Error(`schema compile failed: ${failures.join("; ")}`);
    compiled = v;
  }
  return compiled;
}

/** Document gate + governance/categories consistency, CLI wording included. */
export function validateContract(doc: Record<string, unknown>): ComposerFinding[] {
  const report = documentReport(doc, validators());
  return report.errors.map((e) => finding("document", "harness", "error", "", e));
}

/** S1/S2/S3 over one surface (dspack-gen/core, the only S3 implementation). */
export function lintOneSurface(name: string, surface: unknown, contract: Record<string, unknown>): ComposerFinding[] {
  const findings: ComposerFinding[] = [];
  const report = lintSurface(surface, contract as never);
  for (const gate of report.gates) {
    if (gate.status === "FAIL") {
      for (const error of gate.errors ?? []) {
        findings.push(finding(gate.gate as ComposerFinding["gate"], "lint", "error", name, error));
      }
    }
  }
  for (const f of report.findings) {
    findings.push(
      finding("S3", f.ruleId, f.level === "error" ? "error" : "warn", `${name} ${f.location.path}`, `${f.message} — ${f.rationale}`),
    );
  }
  return findings;
}

export interface BrowserEmitResult {
  ok: boolean;
  catalog?: Record<string, any>;
  surfaces: Array<{ name: string; messages?: unknown[]; warnings: Array<{ code: string; message: string }>; error?: string }>;
  findings: ComposerFinding[];
}

/**
 * The full emit loop in the browser: profile load, per-surface emission,
 * catalog gates for 0.9.1, coverage + fidelity findings. The agent's
 * /project/emit remains the twin that also WRITES out/; this one powers
 * instant feedback on unsaved edits and full demo-mode function.
 */
/**
 * The A3 refusal finding, classified. An emit refusal caused solely by
 * components the profile author declared casualties (with a written reason)
 * is an acknowledged decision — the finding keeps its severity, code,
 * target, and verbatim message, and gains structured evidence of the
 * acknowledgement. See composer-core's classifySurfaceRefusal for the rule.
 */
function refusalFinding(
  name: string,
  error: string,
  surfaces: Array<{ name: string; surface: unknown }>,
  contract: Record<string, any>,
  profileJson: Record<string, unknown>,
): ComposerFinding {
  const base = finding("A3", "emit-surface", "error", name, error);
  const surface = surfaces.find((s) => s.name === name)?.surface;
  const acknowledged = classifySurfaceRefusal(surface, contract, profileJson as Record<string, any>);
  return acknowledged ? { ...base, acknowledged } : base;
}

export function browserEmit(
  contract: Record<string, unknown>,
  profileJson: Record<string, unknown>,
  surfaces: Array<{ name: string; surface: unknown }>,
): BrowserEmitResult {
  let profile: Profile;
  try {
    profile = loadProfile(profileJson);
  } catch (e) {
    if (e instanceof ProfileLoadError) {
      return {
        ok: false,
        surfaces: [],
        findings: e.issues.map((i) => finding("profile", "schema", "error", i.path, i.message)),
      };
    }
    throw e;
  }

  const emitted: BrowserEmitResult["surfaces"] = [];
  const allMessages: unknown[] = [];
  for (const { name, surface } of surfaces) {
    try {
      const r = emitSurface(surface as never, contract as never, { profile });
      emitted.push({ name, messages: r.messages, warnings: r.warnings as Array<{ code: string; message: string }> });
      allMessages.push(...r.messages);
    } catch (e) {
      if (e instanceof EmitSurfaceError) {
        emitted.push({ name, warnings: [], error: e.message });
        continue;
      }
      throw e;
    }
  }

  const findings: ComposerFinding[] = [];
  const out = transformFromJson(contract as never, { a2uiVersion: "0.9.1", surface: { messages: allMessages }, profile });
  for (const gate of out.validation.gates) {
    if (!gate.pass) {
      const gateId = gate.name.startsWith("schema-compile") ? "A1" : gate.name === "catalog-shape" ? "A2" : "A3";
      findings.push(finding(gateId as "A1", gate.name, "error", "a2ui@0.9.1", (gate.errors ?? []).join("; ") || gate.name));
    }
  }
  for (const c of out.mapping.coverage) {
    if (c.disposition === "unclassified") {
      findings.push(finding("coverage", "unclassified", "error", c.id, "component is neither mapped, adapted, omitted, nor a declared casualty"));
    }
  }
  for (const f of out.mapping.fidelity) {
    if (f.class === "lossy" || f.class === "cannot-represent") {
      findings.push(finding("fidelity", f.class, "warn", f.source, f.note));
    }
  }
  for (const { name, warnings, error } of emitted) {
    if (error) findings.push(refusalFinding(name, error, surfaces, contract, profileJson));
    for (const w of warnings) findings.push(finding("A3", w.code, "info", name, w.message));
  }

  return { ok: out.validation.pass, catalog: out.catalog as Record<string, any>, surfaces: emitted, findings };
}

/** Contract examples + any extra named surfaces, the emit/preview corpus. */
export function contractSurfaces(contract: Record<string, unknown>): Array<{ name: string; surface: unknown }> {
  const out: Array<{ name: string; surface: unknown }> = [];
  for (const example of (contract.examples as Array<{ id?: string; surface?: unknown }> | undefined) ?? []) {
    if (example.surface) out.push({ name: example.id ?? "example", surface: example.surface });
  }
  return out;
}
