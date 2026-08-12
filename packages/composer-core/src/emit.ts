/**
 * THE EMIT SEAM: one emit loop, one validation truth.
 *
 * Two doors led to the same governed project — the local agent's
 * `/project/emit` (repository-backed) and the composer's in-browser
 * `browserEmit` (browser-backed) — and each carried its own copy of the emit
 * loop. The copies drifted where copies always drift, on the detail nobody
 * re-reads: the agent validated the emitted surface against A2UI 0.9.1 AND
 * 1.0, the browser against 0.9.1 alone. The same project, two truths, and
 * nothing in either result said which versions had run.
 *
 * WHY BOTH IS THE CANONICAL ANSWER, and not simply the majority vote:
 * dspack-gen's `runPipeline` — the generator behind BUILD on both doors —
 * defaults to `a2uiVersions: ["0.9.1", "1.0"]` and neither caller overrides
 * it, so generation already gated both versions on both doors. The agent's
 * emit matched generation; so does the composer's build-time reference bake
 * (apps/composer/scripts/demo-assets.mjs). The browser's emit was the lone
 * dissenter, and validating FEWER versions than the generator that produced
 * the surface is the one reading that cannot be right.
 *
 * SCOPE. This is the smallest seam that stops the known divergence: profile
 * load, per-surface emission, per-version catalog gates, coverage, fidelity,
 * refusal classification, warnings — everything the two copies said
 * identically, plus the one thing they said differently. It deliberately does
 * NOT absorb what is genuinely different about each door: the agent writes
 * `out/` (it owns the filesystem) and the browser selects which surfaces exist
 * (it has no `surfacesDir`). Those stay at their call sites, which is why they
 * can be asserted as "the seam plus exactly one thing" from either side.
 *
 * The other known twins between these two files — id minting, the accept gate,
 * the scripted adapter — are NOT extracted here. They have not been measured
 * to diverge, and a refactor is not a correctness fix.
 */
import {
  loadProfile,
  transformFromJson,
  emitSurface,
  EmitSurfaceError,
  ProfileLoadError,
  type A2uiVersion,
  type Profile,
} from "@aestheticfunction/dspack-emit";
import {
  finding,
  catalogGateFindings,
  classifySurfaceRefusal,
  type ComposerFinding,
} from "./findings";

/**
 * The A2UI versions every governed emit in this repo validates against.
 *
 * Pinned to dspack-gen's `runPipeline` default (`["0.9.1", "1.0"]`, see
 * dist/run/orchestrator.js): the generator that produced the surface decides
 * which versions it is claiming to satisfy, and emit validates exactly that
 * set. If dspack-gen's default ever changes, this constant is the ONE place
 * the studio follows it.
 */
export const A2UI_VERSIONS: readonly A2uiVersion[] = ["0.9.1", "1.0"];

/** A surface to emit, named the way its door names it. */
export interface SurfaceToEmit {
  name: string;
  surface: unknown;
}

/** One surface's emission outcome — messages, warnings, or a verbatim refusal. */
export interface EmittedSurface {
  name: string;
  messages?: unknown[];
  warnings: Array<{ code: string; message: string }>;
  error?: string;
}

/** One A2UI version's compiled catalog and its gate verdict. */
export interface EmitVersionRun {
  version: A2uiVersion;
  pass: boolean;
  catalog: Record<string, any>;
  report: unknown;
}

export interface ProjectEmitResult {
  /** Every version's catalog gates passed. */
  ok: boolean;
  /** The primary (first version's) catalog — what previews render. */
  catalog?: Record<string, any>;
  /** The primary version's fidelity/coverage report JSON. */
  report?: unknown;
  /** One entry per validated A2UI version, in `A2UI_VERSIONS` order. */
  runs: EmitVersionRun[];
  surfaces: EmittedSurface[];
  findings: ComposerFinding[];
}

/**
 * Emit a governed project's surfaces and validate the result, exactly once,
 * for every door. Pure: no filesystem, no network, no globals — the agent
 * hands it parsed documents and writes the returned runs to disk itself.
 */
export function projectEmit(
  contract: Record<string, unknown>,
  profileJson: Record<string, unknown>,
  surfaces: SurfaceToEmit[],
): ProjectEmitResult {
  let profile: Profile;
  try {
    profile = loadProfile(profileJson);
  } catch (e) {
    if (e instanceof ProfileLoadError) {
      return {
        ok: false,
        runs: [],
        surfaces: [],
        findings: e.issues.map((i) => finding("profile", "schema", "error", i.path, i.message)),
      };
    }
    throw e;
  }

  const emitted: EmittedSurface[] = [];
  const allMessages: unknown[] = [];
  for (const { name, surface } of surfaces) {
    try {
      const r = emitSurface(surface as never, contract as never, { profile });
      emitted.push({ name, messages: r.messages, warnings: r.warnings as EmittedSurface["warnings"] });
      allMessages.push(...r.messages);
    } catch (e) {
      if (e instanceof EmitSurfaceError) {
        emitted.push({ name, warnings: [], error: e.message });
        continue;
      }
      throw e;
    }
  }

  // One transform per version. The emitter's gate and mapping handles stay
  // local — the published result is data, not an emitter session.
  const transformed = A2UI_VERSIONS.map((version) => ({
    version,
    out: transformFromJson(contract as never, {
      a2uiVersion: version,
      surface: { messages: allMessages },
      profile,
    }),
  }));
  const runs: EmitVersionRun[] = transformed.map(({ version, out }) => ({
    version,
    pass: out.validation.pass,
    catalog: out.catalog as Record<string, any>,
    report: out.report.json,
  }));

  const findings: ComposerFinding[] = [];
  // CATALOG GATES: reported per version, because a gate that fails under one
  // A2UI version and passes under another is exactly the information the
  // single-version reading destroyed. The `a2ui@<version>` target is what
  // distinguishes the rows; catalogGateFindings still explodes structured
  // errorDetails into honest Component#id targets when the emitter supplies
  // them (dspack-emit >= 0.7, feature-detected).
  for (const { version, out } of transformed) {
    for (const gate of out.validation.gates) {
      if (gate.pass) continue;
      const gateId = gate.name.startsWith("schema-compile") ? "A1" : gate.name === "catalog-shape" ? "A2" : "A3";
      findings.push(...catalogGateFindings(gateId as "A1", gate, `a2ui@${version}`));
    }
  }

  // COVERAGE + FIDELITY come from the primary run: they describe how the
  // CONTRACT projects onto A2UI, which is version-independent.
  const primary = transformed[0].out;
  for (const c of primary.mapping.coverage) {
    if (c.disposition === "unclassified") {
      findings.push(
        finding("coverage", "unclassified", "error", c.id, "component is neither mapped, adapted, omitted, nor a declared casualty"),
      );
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
      // decision, not unresolved work. The finding keeps its severity, code,
      // target, and verbatim message; the classification rides alongside.
      const base = finding("A3", "emit-surface", "error", name, error);
      const surface = surfaces.find((s) => s.name === name)?.surface;
      const acknowledged = classifySurfaceRefusal(surface, contract as Record<string, any>, profileJson as Record<string, any>);
      findings.push(acknowledged ? { ...base, acknowledged } : base);
    }
    for (const w of warnings) findings.push(finding("A3", w.code, "info", name, w.message));
  }

  return {
    // Every version, not the first one: a project is only clean when the whole
    // set of versions it claims to satisfy actually gates clean.
    ok: runs.every((r) => r.pass),
    catalog: runs[0]?.catalog,
    report: runs[0]?.report,
    runs,
    surfaces: emitted,
    findings,
  };
}
