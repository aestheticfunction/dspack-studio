/**
 * Compositions (R1a spike): the gates every instance passes, prepared once per
 * contract and profile.
 *
 *   S1 to S3  dspack-gen's lintSurface over the expanded surface, injected
 *             (as blocks/phase.ts injects it) so this package stays free of
 *             the generator at run time;
 *   emit      dspack-emit's emitSurface, with the instance's own surfaceId;
 *   A1, A2    the catalog gates. They read only the catalog, so they run once
 *             per contract, profile and A2UI version and are reused;
 *   A3        every emitted component instance against its own catalog
 *             branch, the algorithm of dspack-emit's gate 3 (validate/ajv.js)
 *             with the validator compiled once instead of on every call.
 *             governance.test.ts checks it gives the same verdict, instance by
 *             instance, as dspack-emit's own validateCatalog.
 *
 * Caching is what R0-REVIEW A12 asks for: without it the A gates dominate an
 * instantiation (about 27 ms for 0.9.1 and 50 ms more for 1.0, measured).
 */
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  emitSurface,
  extractInstances,
  loadProfile,
  transformFromJson,
  validateCatalog,
  type A2uiVersion,
  type Profile,
} from "@aestheticfunction/dspack-emit";
import { sha256Hex } from "../blocks/digest";

type Json = Record<string, any>;

/** dspack-gen's LintReport, structurally (core/lint/findings.d.ts). */
export interface LintReport {
  pass: boolean;
  gates: Array<{ gate: string; name?: string; status: string; errors?: string[] }>;
  findings: Array<{ ruleId?: string; level?: string; message?: string; rationale?: string; [k: string]: unknown }>;
}

export interface GateFailure {
  gate: "S1" | "S2" | "S3" | "emit" | "A1" | "A2" | "A3";
  version?: A2uiVersion;
  rule?: string;
  message: string;
}

export interface Governor {
  readonly contract: Json;
  readonly profile: Profile;
  readonly contractSha256: string;
  readonly profileSha256: string;
  readonly versions: readonly A2uiVersion[];
  lint(surface: unknown): { pass: boolean; failures: GateFailure[]; report: LintReport };
  emit(surface: unknown, surfaceId: string): { ok: true; messages: Json[]; warnings: unknown[] } | { ok: false; failure: GateFailure };
  gates(messages: unknown[]): { pass: boolean; failures: GateFailure[] };
  catalog(version: A2uiVersion): Json;
}

const ajvFactory = () => {
  const ajv = new (Ajv2020 as unknown as new (o: object) => any)({ strict: false, allErrors: true, validateFormats: true });
  (addFormats as unknown as (a: unknown) => void)(ajv);
  return ajv;
};

function fmt(e: { instancePath?: string; message?: string }): string {
  return `${e.instancePath || "/"} ${e.message ?? "invalid"}`;
}

/**
 * The A2UI versions instances are gated against: the same set production's
 * emit seam uses (emit.ts A2UI_VERSIONS), so an instance is governed exactly
 * as a generated surface is. Messages travel in the v0.9 envelope; the spike
 * claims 0.9.1 interoperability only (R0-REVIEW 6.2, PROTOCOL.md).
 */
export const INSTANCE_A2UI_VERSIONS: readonly A2uiVersion[] = ["0.9.1", "1.0"];

export async function createGovernor(options: {
  contract: Json;
  profileJson: Json;
  lintSurface: (surface: unknown, contract: Json) => LintReport;
  versions?: readonly A2uiVersion[];
}): Promise<Governor> {
  const { contract, profileJson } = options;
  const versions = options.versions ?? INSTANCE_A2UI_VERSIONS;
  const profile = loadProfile(profileJson as never);
  const catalogs = new Map<A2uiVersion, Json>();
  const catalogFailures: GateFailure[] = [];
  const branchValidators = new Map<A2uiVersion, { admitted: Set<string>; branch(component: string): ((x: unknown) => boolean) & { errors?: any[] } }>();
  for (const version of versions) {
    const catalog = transformFromJson(contract as never, { a2uiVersion: version, profile }).catalog as Json;
    catalogs.set(version, catalog);
    const report = validateCatalog(catalog as never, version);
    for (const g of report.gates) if (!g.pass) catalogFailures.push({ gate: g.name.startsWith("schema-compile") ? "A1" : "A2", version, message: g.detail });
    const ajv = ajvFactory();
    ajv.addSchema(catalog, catalog.$id);
    const cache = new Map<string, any>();
    branchValidators.set(version, {
      admitted: new Set(Object.keys(catalog.components ?? {})),
      branch: (component) => {
        if (!cache.has(component)) cache.set(component, ajv.getSchema(`${catalog.$id}#/components/${component}`));
        return cache.get(component);
      },
    });
  }
  const contractSha256 = await sha256Hex(JSON.stringify(contract));
  const profileSha256 = await sha256Hex(JSON.stringify(profileJson));

  return {
    contract,
    profile,
    contractSha256,
    profileSha256,
    versions,
    catalog: (version) => catalogs.get(version)!,
    lint(surface) {
      const report = options.lintSurface(surface, contract);
      const failures: GateFailure[] = [];
      for (const g of report.gates) {
        if (g.status !== "FAIL" || g.gate === "S3") continue;
        for (const e of g.errors ?? [`${g.gate} failed`]) failures.push({ gate: g.gate as "S1" | "S2", message: e });
      }
      for (const f of report.findings) {
        if (f.level !== "error") continue;
        failures.push({ gate: "S3", rule: f.ruleId as string, message: `${String(f.message)} Rationale: ${String(f.rationale)}` });
      }
      if (!report.pass && failures.length === 0) failures.push({ gate: "S3", message: "the surface did not pass lint" });
      return { pass: report.pass, failures, report };
    },
    emit(surface, surfaceId) {
      try {
        const r = emitSurface(surface as never, contract as never, { profile, surfaceId });
        return { ok: true, messages: r.messages as Json[], warnings: r.warnings };
      } catch (error) {
        return { ok: false, failure: { gate: "emit", message: (error instanceof Error ? error.message : String(error)).trim().slice(0, 600) || "refused" } };
      }
    },
    gates(messages) {
      const failures: GateFailure[] = [...catalogFailures];
      const instances = extractInstances({ messages });
      for (const version of versions) {
        const v = branchValidators.get(version)!;
        for (const inst of instances) {
          const comp = String(inst.component);
          const where = `${comp}#${String(inst.id)}`;
          if (!v.admitted.has(comp)) {
            failures.push({ gate: "A3", version, message: `${where}: component '${comp}' is not in this catalog` });
            continue;
          }
          const validate = v.branch(comp);
          if (!validate) {
            failures.push({ gate: "A3", version, message: `${where}: could not resolve #/components/${comp}` });
            continue;
          }
          if (!validate(inst)) for (const e of validate.errors ?? []) failures.push({ gate: "A3", version, message: `${where}: ${fmt(e)}` });
        }
      }
      return { pass: failures.length === 0, failures };
    },
  };
}
