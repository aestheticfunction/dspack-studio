/**
 * Fail-first diagnostics tests (ratified robustness slice).
 *
 *  1. catalogGateFindings — ONE finding per component instance when a failing
 *     catalog gate carries structured errorDetails (dspack-emit >= 0.7,
 *     feature-detected): honest `Component#id` targets, message capped at the
 *     first three error strings, the COMPLETE raw strings kept on the new
 *     `evidence` field. Without errorDetails the single finding keeps the
 *     caller's target but caps its joined message the same way — genuine
 *     errors are layered, never dropped.
 *  2. buildFailure — catalog-gate reasons deduped across the two A2UI
 *     versions (identical-message repetition capped), S-gate reasons rendered
 *     first with A-gate noise collapsed to one summary, and a dspack-gen
 *     >= 0.4 representability refusal surfaced instead of "unknown".
 *
 * Written BEFORE the implementation (fail-first): on the pre-change tree
 * every new assertion fails — catalogGateFindings does not exist (browser
 * and agent join ALL gate errors into one finding with a fixed target),
 * build failures explode one row per raw error across BOTH versions, and a
 * representability refusal reports "without structured evidence".
 */
import { describe, expect, it } from "vitest";
import { catalogGateFindings } from "./findings";
import { buildFailure, foldBuildEvents } from "./build";

describe("catalogGateFindings — per-instance findings with honest targets", () => {
  const detailErrors = [
    { instancePath: "/props/label", schemaPath: "#/properties/label/type", keyword: "type", message: "must be string" },
    { instancePath: "/props/variant", keyword: "enum", message: "must be equal to one of the allowed values" },
    { instancePath: "/props/size", keyword: "enum", message: "must be equal to one of the allowed values" },
    { instancePath: "", keyword: "additionalProperties", message: "must NOT have additional properties" },
  ];

  it("a failing gate with errorDetails yields ONE finding per instance: Component#id target, capped message, complete evidence", () => {
    const out = catalogGateFindings(
      "A3",
      {
        name: "instance",
        errors: ["flat string the 0.6 emitter would also report", "another flat string"],
        errorDetails: [
          { instance: { component: "Button", id: "save" }, component: "Button", id: "save", errors: detailErrors },
          { instance: { component: "Card", id: "summary" }, component: "Card", id: "summary", errors: [{ instancePath: "/props/title", message: "must be string" }] },
        ],
      },
      "a2ui@0.9.1",
    );
    expect(out).toHaveLength(2);
    expect(out.map((f) => f.target)).toEqual(["Button#save", "Card#summary"]);
    expect(out[0].message).toBe(
      "/props/label must be string; /props/variant must be equal to one of the allowed values; /props/size must be equal to one of the allowed values (+1 more)",
    );
    expect(out[0].evidence).toHaveLength(4);
    expect(out[0].evidence?.at(-1)).toBe("(root) must NOT have additional properties");
    expect(out[1]).toMatchObject({ gate: "A3", code: "instance", severity: "error", message: "/props/title must be string" });
  });

  it("without errorDetails the single finding keeps the caller's target, caps the joined message, and keeps ALL raw strings as evidence", () => {
    const out = catalogGateFindings("A3", { name: "instance", errors: ["e1", "e2", "e3", "e4", "e5"] }, "a2ui@0.9.1");
    expect(out).toHaveLength(1);
    expect(out[0].target).toBe("a2ui@0.9.1");
    expect(out[0].message).toBe("e1; e2; e3 (+2 more)");
    expect(out[0].evidence).toEqual(["e1", "e2", "e3", "e4", "e5"]);
  });

  it("three or fewer errors are never marked truncated, and an error-less failing gate falls back to its name", () => {
    const short = catalogGateFindings("A1", { name: "schema-compile-0.9.1", errors: ["boom"] }, "a2ui@0.9.1");
    expect(short[0].message).toBe("boom");
    expect(short[0].message).not.toContain("more)");
    expect(short[0].evidence).toEqual(["boom"]);
    const bare = catalogGateFindings("A2", { name: "catalog-shape" }, "a2ui@1.0");
    expect(bare).toHaveLength(1);
    expect(bare[0]).toMatchObject({ target: "a2ui@1.0", message: "catalog-shape" });
    expect(bare[0].evidence).toBeUndefined();
  });
});

describe("buildFailure — deduped, layered catalog-gate presentation", () => {
  const run = (outcome: string, report: Record<string, any>) =>
    foldBuildEvents([
      { type: "RUN_STARTED" },
      { type: "STEP_STARTED", stepName: "attempt-0" },
      { type: "CUSTOM", name: "dspack.audit", value: { outcome, exitCode: outcome === "passed" ? 0 : 2, report } },
      { type: "RUN_FINISHED" },
    ]);

  const A3 = (errors: string[]) => ({ gate: "A3", name: "instance", pass: false, errors });

  it("identical catalog-gate errors under both A2UI versions render ONCE, targeted 'both A2UI versions'", () => {
    const f = buildFailure(
      run("failed-gate", {
        attempts: [{ index: 0, surface: { root: {} }, gates: [{ gate: "S1", name: "surface-schema", status: "PASS" }], findings: [] }],
        emitted: {
          target: "a2ui",
          warnings: [],
          validations: [
            { a2uiVersion: "0.9.1", gates: [A3(["Button#save: /props/label must be string", "Card#c1: /props/title must be string"])] },
            { a2uiVersion: "1.0", gates: [A3(["Button#save: /props/label must be string", "Card#c1: /props/title must be string"])] },
          ],
        },
      }),
    );
    expect(f?.kind).toBe("emit-gate");
    expect(f?.reasons).toHaveLength(2); // was 4: one row per raw error per version
    expect(f?.reasons[0]).toMatchObject({ gate: "A3", message: "Button#save: /props/label must be string", target: "both A2UI versions" });
    expect(f?.reasons[1].target).toBe("both A2UI versions");
  });

  it("identical-message repetition within one version is capped to one row; single-version reasons keep their version target", () => {
    const f = buildFailure(
      run("failed-gate", {
        attempts: [{ index: 0, surface: { root: {} }, gates: [], findings: [] }],
        emitted: {
          target: "a2ui",
          warnings: [],
          validations: [{ a2uiVersion: "0.9.1", gates: [A3(["dup err", "dup err", "dup err", "only here"])] }],
        },
      }),
    );
    expect(f?.reasons).toHaveLength(2);
    expect(f?.reasons[0]).toMatchObject({ message: "dup err", target: "a2ui@0.9.1" });
    expect(f?.reasons[1]).toMatchObject({ message: "only here", target: "a2ui@0.9.1" });
  });

  it("when S-gate failures explain the turn, A-gate reasons collapse to one summary (S-first layering)", () => {
    const f = buildFailure(
      run("failed-gate", {
        attempts: [
          {
            index: 0,
            gates: [
              { gate: "S1", name: "surface-schema", status: "PASS" },
              { gate: "S2", name: "contract-vocabulary", status: "FAIL", errors: ["component 'timeline' is not contract vocabulary"] },
            ],
            findings: [],
          },
        ],
        emitted: {
          target: "a2ui",
          warnings: [],
          validations: [
            { a2uiVersion: "0.9.1", gates: [A3(["e1", "e2", "e3", "e4"])] },
            { a2uiVersion: "1.0", gates: [A3(["e1", "e2", "e3", "e4"])] },
          ],
        },
      }),
    );
    expect(f?.reasons).toHaveLength(2); // S2 verbatim + ONE catalog summary (was 8 A-gate rows, no S2)
    expect(f?.reasons[0]).toMatchObject({ gate: "S2", message: "component 'timeline' is not contract vocabulary" });
    expect(f?.reasons[1].message).toBe("4 catalog-gate findings — see Checks for detail");
  });

  it("a failed-lint-exhausted whose last attempt carries a representability refusal surfaces the refusal (dspack-gen >= 0.4)", () => {
    const refusal = "the goal needs tabular data layout, which this catalog cannot represent";
    const progress = run("failed-lint-exhausted", {
      attempts: [
        { index: 0, gates: [], findings: [] },
        { index: 1, gates: [], findings: [], representability: { pass: false, refusal } },
      ],
    });
    // (b) the folded attempt exposes it, so the Build view can label the repair
    expect(progress.attempts.at(-1)?.representability).toEqual({ pass: false, refusal });
    // (a) the failure names it instead of "unknown / without structured evidence"
    const f = buildFailure(progress);
    expect(f?.kind).not.toBe("unknown");
    expect(f?.reasons.some((r) => r.message === refusal)).toBe(true);
    expect(f?.stoppedAt).toMatch(/representability/);
  });
});
