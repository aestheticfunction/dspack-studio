/**
 * In-browser validation: the SAME implementations the CLI and agent run,
 * imported — never re-implemented (the one-validator principle, now
 * importable end to end):
 *
 *   document gate + consistency  @aestheticfunction/dspack-spec lib
 *   S1/S2/S3 surface lint        @aestheticfunction/dspack-gen/core
 *   emit + A-gates + fidelity    composer-core's projectEmit, over
 *                                @aestheticfunction/dspack-emit (browser-safe)
 *
 * Everything here is synchronous and pure; the agent stays the file-writing
 * authority, but every EDIT gets instant, gate-identical feedback. "Gate
 * identical" is now structural rather than aspirational: the emit loop itself
 * is the shared seam both doors call, not a copy of it (see browserEmit).
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
import { finding, projectEmit, type ComposerFinding, type ProjectEmitResult, type SurfaceToEmit } from "@dspack-studio/composer-core";

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

/** The emit result the browser hands the views — the shared seam's result. */
export type BrowserEmitResult = ProjectEmitResult;

/**
 * The full emit loop in the browser: profile load, per-surface emission,
 * catalog gates for EVERY canonical A2UI version, coverage + fidelity
 * findings. It powers instant feedback on unsaved edits and full demo-mode
 * function.
 *
 * It is the SHARED SEAM plus surface selection, and nothing else. The loop
 * itself lives in composer-core (`projectEmit`) because the agent's
 * /project/emit runs the identical loop and the two copies had already
 * drifted: this side validated A2UI 0.9.1 only while the agent validated
 * 0.9.1 and 1.0, so the same governed project got a different verdict
 * depending on which door it came through. Equivalence is now structural, and
 * asserted from both sides (validation.test.ts here, project.test.ts there).
 */
export function browserEmit(
  contract: Record<string, unknown>,
  profileJson: Record<string, unknown>,
  surfaces: SurfaceToEmit[],
): BrowserEmitResult {
  return projectEmit(contract, profileJson, surfaces);
}

/**
 * The surfaces a BROWSER-backed project has: the contract's worked examples.
 * This is the documented asymmetry with the agent, which additionally emits
 * the project's `surfacesDir` — a directory a browser-backed project has no
 * access to. Everything downstream of this selection is identical.
 */
export function contractSurfaces(contract: Record<string, unknown>): SurfaceToEmit[] {
  const out: SurfaceToEmit[] = [];
  for (const example of (contract.examples as Array<{ id?: string; surface?: unknown }> | undefined) ?? []) {
    if (example.surface) out.push({ name: example.id ?? "example", surface: example.surface });
  }
  return out;
}
