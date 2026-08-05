/**
 * composer-core: manifest parsing, ledger reading (pinned against REAL
 * dspack-export output), findings, adapter manifests.
 *
 * The ledger fixtures are actual dspack-export 0.3.0 artifacts from the
 * composer spike: `acme-ui.dspack.json` is the pristine discovery output
 * (every generated hash matches); `acme-ui.enriched.dspack.json` is the same
 * document after human enrichment (components edited -> human-owned;
 * governance authored -> human-authored). This pins our WebCrypto
 * sectionHash to dspack-export's node:crypto sectionHash byte for byte.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseProjectManifest } from "./project";
import {
  addTombstone,
  applyFreshFact,
  componentEntryStatuses,
  ledgerStatus,
  preservesLedger,
  removeTombstone,
  restoreComponent,
  sectionHash,
} from "./ledger";
import {
  acknowledgedCasualties,
  classifySurfaceRefusal,
  countBySeverity,
  finding,
  gatesSummary,
  unresolvedErrors,
} from "./findings";
import { COMPOSER_ADAPTERS, composerAdapter } from "./adapters";
import {
  buildFailure,
  buildReadiness,
  canAcceptTurn,
  canRefineTurn,
  examplePromptFor,
  foldBuildEvents,
  vocabularyGap,
} from "./build";

const fixture = (name: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8"));

const pristine = fixture("acme-ui.dspack.json");
const enriched = fixture("acme-ui.enriched.dspack.json");
// A real dspack-export 0.5.0 golden (the shadcn-demo fixture): ledger v2
// with per-entry hashes. Entry-hash fidelity and every entry-level state
// below are pinned against this artifact, not hand-written ledgers.
const v2 = fixture("shadcn-demo.v2.dspack.json");

describe("project manifest", () => {
  const valid = {
    composerProject: "0.1",
    name: "Acme UI",
    adapter: "react-generic",
    catalogIdBase: "https://acme.example/catalogs/acme-ui",
    contractPath: "acme-ui.dspack.json",
    profilePath: "acme.profile.json",
  };

  it("parses a valid manifest and applies defaults", () => {
    const result = parseProjectManifest(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.outDir).toBe("out");
      expect(result.manifest.previewRegistry).toBe("wireframe");
    }
  });

  it("rejects a non-https catalogIdBase with a pathed issue", () => {
    const result = parseProjectManifest({ ...valid, catalogIdBase: "http://acme.example/c" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.path === "catalogIdBase")).toBe(true);
  });

  it("rejects unknown keys (strict manifest)", () => {
    const result = parseProjectManifest({ ...valid, vibes: true });
    expect(result.ok).toBe(false);
  });
});

describe("ledger reading (pinned to real dspack-export output)", () => {
  it("matches dspack-export's sectionHash on the pristine document", async () => {
    // Every recorded hash must verify against the section content it hashes.
    const recorded = pristine.metadata["x-bootstrap"].generated as Record<string, string>;
    for (const [section, hash] of Object.entries(recorded)) {
      expect(await sectionHash(pristine[section]), section).toBe(hash);
    }
  });

  it("reports pristine sections tool-owned and unbootstrapped governance absent", async () => {
    const status = await ledgerStatus(pristine);
    expect(status.hasLedger).toBe(true);
    const byName = Object.fromEntries(status.sections.map((s) => [s.section, s.state]));
    expect(byName.components).toBe("tool-owned");
    expect(byName.tokens).toBe("tool-owned");
    expect(byName.intents).toBe("absent");
    expect(status.awaitingAuthorship).toContain("intents");
  });

  it("reports enrichment: edited components human-owned, authored governance human-authored", async () => {
    const status = await ledgerStatus(enriched);
    const byName = Object.fromEntries(status.sections.map((s) => [s.section, s.state]));
    expect(byName.components).toBe("human-owned"); // props + composition edited after bootstrap
    expect(byName.tokens).toBe("tool-owned"); // untouched
    expect(byName.intents).toBe("human-authored"); // authored, never generated
    expect(byName.rules).toBe("human-authored");
  });

  it("preservesLedger guards ledger deletion, not content edits", () => {
    expect(preservesLedger(pristine, enriched)).toBe(true);
    const stripped = structuredClone(enriched);
    delete stripped.metadata["x-bootstrap"];
    expect(preservesLedger(pristine, stripped)).toBe(false);
    // A document that never had a ledger is unconstrained.
    expect(preservesLedger({ metadata: {} }, { metadata: {} })).toBe(true);
  });
});

describe("ledger v2 (entry-level, pinned to a real dspack-export 0.5.0 golden)", () => {
  it("matches dspack-export's per-entry hashes byte for byte", async () => {
    const recorded = v2.metadata["x-bootstrap"].components as Record<string, string>;
    expect(Object.keys(recorded).length).toBeGreaterThan(0);
    for (const [id, hash] of Object.entries(recorded)) {
      expect(await sectionHash(v2.components[id]), id).toBe(hash);
    }
  });

  it("reports the pristine v2 golden all tool-owned, section state derived from entries", async () => {
    const status = await ledgerStatus(v2);
    expect(status.entryLevel).toBe(true);
    expect(status.componentEntries.every((e) => e.state === "tool-owned")).toBe(true);
    expect(status.sections.find((s) => s.section === "components")?.state).toBe("tool-owned");
  });

  it("v1 documents stay section-level: no entry states invented", async () => {
    const status = await ledgerStatus(enriched);
    expect(status.entryLevel).toBe(false);
    expect(status.componentEntries).toEqual([]);
  });

  it("distinguishes human-owned, unattributed, orphaned, and tombstoned entries", async () => {
    const doc = structuredClone(v2);
    doc.components.button.whenToUse = "Any user-initiated action."; // stale hash
    delete doc.metadata["x-bootstrap"].components.card; // present, no record
    delete doc.components.badge; // record, no entry
    doc.metadata["x-bootstrap"].doNotRediscover = ["input"];
    delete doc.components.input;
    delete doc.metadata["x-bootstrap"].components.input;

    const byId = Object.fromEntries((await componentEntryStatuses(doc)).map((e) => [e.id, e.state]));
    expect(byId.button).toBe("human-owned");
    expect(byId.card).toBe("unattributed");
    expect(byId.badge).toBe("orphaned");
    expect(byId.input).toBe("tombstoned");
    // Any non-tool-owned state makes the section human-owned at v2.
    const status = await ledgerStatus(doc);
    expect(status.sections.find((s) => s.section === "components")?.state).toBe("human-owned");
  });

  it("round-trips byte-stably through save/reload with ownership intact", async () => {
    const doc = structuredClone(v2);
    doc.components.button.whenToUse = "Any user-initiated action.";
    delete doc.components.badge; // orphan = deletion memory
    const before = JSON.stringify(doc);
    const reloaded = JSON.parse(before); // the save/export/reload path IS JSON
    expect(JSON.stringify(reloaded)).toBe(before);
    const a = await componentEntryStatuses(doc);
    const b = await componentEntryStatuses(reloaded);
    expect(b).toEqual(a); // ownership, orphan memory, and hashes all survive
    expect(b.find((e) => e.id === "badge")?.state).toBe("orphaned");
  });

  it("restoreComponent clears exactly the orphaned record, nothing else", async () => {
    const doc = structuredClone(v2);
    delete doc.components.badge;
    const result = restoreComponent(doc, "badge");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ledger = (result.document.metadata as any)["x-bootstrap"];
    expect(ledger.components.badge).toBeUndefined();
    // Byte-identical outside that one record.
    const expected = structuredClone(doc);
    delete (expected.metadata as any)["x-bootstrap"].components.badge;
    expect(JSON.stringify(result.document)).toBe(JSON.stringify(expected));
    // Refuses when there is no deletion to resolve.
    expect(restoreComponent(v2, "badge").ok).toBe(false);
    expect(restoreComponent(doc, "not-a-component").ok).toBe(false);
  });

  it("addTombstone/removeTombstone round-trip; tombstoning an orphan retires its hash", () => {
    const doc = structuredClone(v2);
    delete doc.components.badge;
    const dead = addTombstone(doc, "badge");
    expect(dead.ok).toBe(true);
    if (!dead.ok) return;
    const ledger = (dead.document.metadata as any)["x-bootstrap"];
    expect(ledger.doNotRediscover).toEqual(["badge"]);
    expect(ledger.components.badge).toBeUndefined(); // decision made, memory retired
    const undone = removeTombstone(dead.document, "badge");
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect((undone.document.metadata as any)["x-bootstrap"].doNotRediscover).toEqual([]);
    expect(removeTombstone(doc, "badge").ok).toBe(false); // nothing to remove
  });

  it("v2 actions refuse on v1 documents (version floor)", () => {
    expect(restoreComponent(enriched, "action-button").ok).toBe(false);
    expect(addTombstone(enriched, "action-button").ok).toBe(false);
  });

  it("preservesLedger also guards wholesale deletion-memory destruction on v2", () => {
    const doc = structuredClone(v2);
    (doc.metadata as any)["x-bootstrap"].doNotRediscover = ["badge"];
    const noMap = structuredClone(doc);
    delete (noMap.metadata as any)["x-bootstrap"].components;
    expect(preservesLedger(doc, noMap)).toBe(false);
    const noTombstones = structuredClone(doc);
    delete (noTombstones.metadata as any)["x-bootstrap"].doNotRediscover;
    expect(preservesLedger(doc, noTombstones)).toBe(false);
    const downgraded = structuredClone(doc);
    delete (downgraded.metadata as any)["x-bootstrap"].ledger;
    expect(preservesLedger(doc, downgraded)).toBe(false);
    // Granular decisions keep the structures present and pass.
    const tombstoned = addTombstone(structuredClone(doc), "another");
    expect(tombstoned.ok && preservesLedger(doc, tombstoned.document)).toBe(true);
  });
});

describe("freshDelta acceptance (explicit, scalar leaves and pure additions only)", () => {
  it("applies a scalar leaf replacement to the entry", () => {
    const result = applyFreshFact(v2, "button", { path: "/description", fresh: "A clickable control." });
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.document.components as any).button.description).toBe("A clickable control.");
    expect((v2.components as any).button.description).not.toBe("A clickable control."); // input untouched
  });

  it("applies a pure prop addition, refuses overwriting an existing prop", () => {
    const added = applyFreshFact(v2, "button", { path: "/props/loading", fresh: { type: "boolean" } });
    expect(added.ok).toBe(true);
    if (added.ok) expect((added.document.components as any).button.props.loading).toEqual({ type: "boolean" });
    const existing = Object.keys((v2.components as any).button.props)[0];
    expect(applyFreshFact(v2, "button", { path: `/props/${existing}`, fresh: {} }).ok).toBe(false);
  });

  it("appends only new enum values; refuses unsupported paths", () => {
    const doc = structuredClone(v2);
    const [prop, descriptor] = Object.entries((doc.components as any).button.props).find(
      ([, d]: [string, any]) => Array.isArray(d.values),
    ) as [string, any];
    const had = descriptor.values.length;
    const result = applyFreshFact(doc, "button", { path: `/props/${prop}/values`, fresh: [descriptor.values[0], "brand-new"] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const values = (result.document.components as any).button.props[prop].values;
      expect(values.length).toBe(had + 1); // the known value was not duplicated
      expect(values).toContain("brand-new");
    }
    expect(applyFreshFact(doc, "button", { path: "/composition/subComponents", fresh: [] }).ok).toBe(false);
    expect(applyFreshFact(doc, "missing", { path: "/description", fresh: "x" }).ok).toBe(false);
  });

  it("preserves authored order (append-only) and refuses non-list authored values", () => {
    const doc = structuredClone(v2) as any;
    const prop = Object.keys(doc.components.button.props)[0];
    doc.components.button.props[prop] = { type: "string", values: ["alpha", "beta"] };
    const r = applyFreshFact(doc, "button", { path: `/props/${prop}/values`, fresh: ["beta", "gamma"] });
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.document.components as any).button.props[prop].values).toEqual(["alpha", "beta", "gamma"]);
    // Authored non-list values must never be replaced by acceptance.
    const authored = structuredClone(v2) as any;
    authored.components.button.props[prop] = { type: "string", values: "sm | lg" };
    const refused = applyFreshFact(authored, "button", { path: `/props/${prop}/values`, fresh: ["xl"] });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toContain("by hand");
  });

  it("addTombstone deduplicates and is byte-bounded; clearTombstone removes exactly one id", () => {
    const doc = structuredClone(v2) as any;
    delete doc.components.badge;
    const once = addTombstone(doc, "badge");
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const twice = addTombstone(once.document, "badge");
    expect(twice.ok).toBe(true);
    if (!twice.ok) return;
    expect((twice.document.metadata as any)["x-bootstrap"].doNotRediscover).toEqual(["badge"]);
    // Byte-identical outside the two intended ledger edits.
    const expected = structuredClone(doc);
    (expected.metadata as any)["x-bootstrap"].doNotRediscover = ["badge"];
    delete (expected.metadata as any)["x-bootstrap"].components.badge;
    expect(JSON.stringify(twice.document)).toBe(JSON.stringify(expected));
    // Exactly one id leaves a multi-entry list; the others are decisions too.
    const multi = structuredClone(v2) as any;
    multi.metadata["x-bootstrap"].doNotRediscover = ["alpha", "badge", "omega"];
    const cleared = removeTombstone(multi, "badge");
    expect(cleared.ok).toBe(true);
    if (cleared.ok) expect((cleared.document.metadata as any)["x-bootstrap"].doNotRediscover).toEqual(["alpha", "omega"]);
  });
});

describe("findings", () => {
  it("counts by severity", () => {
    const counts = countBySeverity([
      finding("S2", "unknown-prop", "error", "$.root.props.x", "unknown prop"),
      finding("fidelity", "lossy", "warn", "button.variant", "5 -> 4 projection"),
    ]);
    expect(counts).toEqual({ error: 1, warn: 1, info: 0 });
  });
});

describe("adapter manifests", () => {
  it("ships the initial trio with the documented seam bindings", () => {
    expect(Object.keys(COMPOSER_ADAPTERS).sort()).toEqual(["astryx", "react-generic", "shadcn"]);
    expect(composerAdapter("react-generic")?.rendering).toBeUndefined(); // wireframe fallback
    expect(composerAdapter("shadcn")?.rendering?.registryId).toBe("shadcn");
    expect(composerAdapter("astryx")?.drift?.runtime).toBe("agent");
  });
});


describe("acknowledged casualties (#30)", () => {
  /**
   * Structured inputs only — the contract's sub-component vocabulary, the
   * profile's mapped plans, the profile's authored casualty declarations,
   * and the surface's referenced component ids. No message text is ever read.
   */
  const contract = {
    components: {
      "info-card": { composition: { subComponents: [{ id: "info-card-body" }] } },
      "mini-stepper": {},
      "note-field": {},
    },
  };
  const profile = {
    components: [{ dspackId: "info-card", a2ui: "Card" }, { dspackId: "note-field", a2ui: "TextField" }],
    casualtyComponents: [
      { dspackId: "mini-stepper", class: "cannot-represent", reason: "steps is free-form step data." },
    ],
  };
  const surfaceUsing = (...ids: string[]) => ({
    root: { component: ids[0], children: ids.slice(1).map((id) => ({ component: id })) },
  });

  it("classifies a refusal whose only unresolvable id is an authored casualty with a reason", () => {
    const ack = classifySurfaceRefusal(surfaceUsing("info-card", "info-card-body", "mini-stepper"), contract, profile);
    expect(ack).toEqual({ componentId: "mini-stepper", class: "cannot-represent", reason: "steps is free-form step data." });
  });

  it("does NOT classify an unknown component, however similarly the message might read", () => {
    expect(classifySurfaceRefusal(surfaceUsing("info-card", "not-a-component"), contract, profile)).toBeNull();
  });

  it("does NOT classify a casualty declared without a usable reason", () => {
    for (const reason of [undefined, "", "   "]) {
      const bare = { ...profile, casualtyComponents: [{ dspackId: "mini-stepper", class: "cannot-represent", reason }] };
      expect(classifySurfaceRefusal(surfaceUsing("info-card", "mini-stepper"), contract, bare), String(reason)).toBeNull();
    }
  });

  it("refuses to classify when an unknown component accompanies the casualty (ambiguous cause)", () => {
    const mixed = surfaceUsing("info-card", "mini-stepper", "not-a-component");
    expect(classifySurfaceRefusal(mixed, contract, profile)).toBeNull();
  });

  it("does NOT classify a refusal with no unresolvable id (some other defect)", () => {
    expect(classifySurfaceRefusal(surfaceUsing("info-card", "info-card-body"), contract, profile)).toBeNull();
  });

  it("never reads message text: an ordinary error mentioning a casualty stays unresolved", () => {
    const findings = [
      finding("A3", "emit-surface", "error", "other", "component 'mini-stepper' is a declared casualty (cannot-represent): steps is free-form."),
    ];
    expect(acknowledgedCasualties(findings)).toEqual([]);
    expect(unresolvedErrors(findings)).toHaveLength(1);
  });
});

describe("gate arithmetic and summary (#30)", () => {
  const ack = (target: string) => ({
    ...finding("A3", "emit-surface", "error", target, `component is a declared casualty: because.`),
    acknowledged: { componentId: "x", class: "cannot-represent", reason: "because." },
  });
  const err = (code: string) => finding("A1", code, "error", "a2ui@0.9.1", "gate failed");

  it("keeps acknowledged casualties out of the unresolved-error count but preserves the finding", () => {
    const findings = [ack("uses-casualty")];
    expect(unresolvedErrors(findings)).toEqual([]);
    expect(acknowledgedCasualties(findings)).toHaveLength(1);
    // Severity, code, target, message and the authored reason all survive.
    expect(findings[0].severity).toBe("error");
    expect(findings[0].code).toBe("emit-surface");
    expect(findings[0].acknowledged.reason).toBe("because.");
    expect(countBySeverity(findings).error).toBe(1); // raw counts untouched
  });

  it("summarizes a passing project with singular and plural acknowledgements", () => {
    expect(gatesSummary([ack("a")], true)).toEqual({ done: true, detail: "Gates pass · 1 acknowledged casualty" });
    expect(gatesSummary([ack("a"), ack("b")], true)).toEqual({ done: true, detail: "Gates pass · 2 acknowledged casualties" });
    expect(gatesSummary([], true)).toEqual({ done: true, detail: "document, S-gates, and catalog gates pass" });
  });

  it("never lets an acknowledged casualty make a failing project look green", () => {
    const mixed = [err("schema-compile"), err("catalog-shape"), ack("a")];
    expect(gatesSummary(mixed, true)).toEqual({ done: false, detail: "2 error findings · 1 acknowledged casualty" });
    expect(gatesSummary([err("schema-compile"), ack("a")], true)).toEqual({
      done: false,
      detail: "1 error finding · 1 acknowledged casualty",
    });
    expect(gatesSummary([err("schema-compile")], true)).toEqual({ done: false, detail: "1 error finding" });
  });

  it("acknowledgement never spreads to other findings on the same surface", () => {
    // Only the emission refusal itself is a decision; a lint or coverage
    // finding targeting the same surface is unrelated unresolved work.
    const surface = "uses-casualty";
    const findings = [
      ack(surface),
      finding("S2", "unknown-component", "error", surface, "component is not contract vocabulary"),
      finding("coverage", "unclassified", "error", surface, "neither mapped nor a declared casualty"),
      finding("fidelity", "lossy", "warn", surface, "5 -> 4 projection"),
    ];
    expect(acknowledgedCasualties(findings).map((f) => f.gate)).toEqual(["A3"]);
    expect(unresolvedErrors(findings).map((f) => f.gate)).toEqual(["S2", "coverage"]);
    expect(gatesSummary(findings, true)).toEqual({
      done: false,
      detail: "2 error findings · 1 acknowledged casualty",
    });
  });

  it("stays not-done when emit has not run, whatever the findings say", () => {
    expect(gatesSummary([], false)).toEqual({ done: false, detail: "emit has not run" });
  });
});


describe("build readiness (the runway to Build)", () => {
  const readyArgs = () => ({
    contract: {
      intents: [{ id: "status-report" }],
      components: { a: {}, b: {} },
      examples: [{ id: "ex.one" }],
    },
    profile: { components: [{ dspackId: "a" }], casualtyComponents: [{ dspackId: "b" }] },
    findings: [] as ReturnType<typeof finding>[],
    emitOk: true,
  });

  it("is ready only when contract, profile, intent, mapping, gates, and an example all exist", () => {
    expect(buildReadiness(readyArgs())).toEqual({ ready: true });
  });

  it("names the exact blocking condition for every gap", () => {
    expect(buildReadiness({ ...readyArgs(), contract: null }).reason).toMatch(/no contract/);
    expect(buildReadiness({ ...readyArgs(), profile: null }).reason).toMatch(/profile/);
    const noIntents = readyArgs();
    noIntents.contract.intents = [];
    expect(buildReadiness(noIntents).reason).toMatch(/no intents authored/);
    const unmapped = readyArgs();
    unmapped.profile = { components: [], casualtyComponents: [] };
    expect(buildReadiness(unmapped).reason).toMatch(/2 component\(s\) unmapped/);
    expect(buildReadiness({ ...readyArgs(), findings: null }).reason).toMatch(/emit has not run/);
    expect(buildReadiness({ ...readyArgs(), findings: [finding("A1", "x", "error", "", "boom")] }).reason).toMatch(/gates not green/);
    const noExamples = readyArgs();
    noExamples.contract.examples = [];
    expect(buildReadiness(noExamples).reason).toMatch(/no worked example/);
  });

  it("acknowledged casualties do not block building", () => {
    const args = readyArgs();
    args.findings = [{ ...finding("A3", "emit-surface", "error", "s", "declared casualty"), acknowledged: { componentId: "b", class: "cannot-represent", reason: "r" } } as never];
    expect(buildReadiness(args)).toEqual({ ready: true });
  });
});

describe("folding a streamed build run", () => {
  const stream = [
    { type: "RUN_STARTED" },
    { type: "STEP_STARTED", stepName: "attempt-0" },
    { type: "CUSTOM", name: "dspack.gates", value: { gates: [{ gate: "S1", status: "PASS" }, { gate: "S2", status: "FAIL", errors: ["component 'not-a-component' is not contract vocabulary"] }] } },
    { type: "STEP_FINISHED", stepName: "attempt-0" },
    { type: "CUSTOM", name: "dspack.repair", value: { index: 0, message: "fix it" } },
    { type: "STEP_STARTED", stepName: "attempt-1" },
    { type: "CUSTOM", name: "dspack.gates", value: { gates: [{ gate: "S1", status: "PASS" }, { gate: "S2", status: "PASS" }, { gate: "S3", status: "PASS" }] } },
    { type: "STEP_FINISHED", stepName: "attempt-1" },
    { type: "CUSTOM", name: "dspack.emit", value: { validations: [{ gate: "A1", pass: true }], warnings: [] } },
    { type: "CUSTOM", name: "dspack.audit", value: { outcome: "passed", exitCode: 0, report: { attempts: [{ index: 0, surface: { root: 1 } }, { index: 1, surface: { root: { component: "info-card" } } }] } } },
    { type: "RUN_FINISHED" },
  ];

  it("yields attempts with gates, the verbatim repair, emit, and the final surface", () => {
    const turn = foldBuildEvents(stream);
    expect(turn.status).toBe("finished");
    expect(turn.attempts.map((a) => a.index)).toEqual([0, 1]);
    expect(turn.attempts[0].repair).toBe("fix it");
    expect(turn.attempts[0].gates[1].status).toBe("FAIL");
    expect(turn.outcome).toBe("passed");
    expect(turn.surface).toEqual({ root: { component: "info-card" } });
    expect(turn.emit?.validations).toBeDefined();
  });

  it("distinguishes a vocabulary gap from a formatting failure, structurally", () => {
    // Final attempt failing S2 with a named component = a gap.
    const gapTurn = foldBuildEvents(stream.slice(0, 4).concat([{ type: "CUSTOM", name: "dspack.audit", value: { outcome: "failed-lint-exhausted", exitCode: 2, report: { attempts: [] } } }, { type: "RUN_FINISHED" }]));
    expect(vocabularyGap(gapTurn)).toEqual(["not-a-component"]);
    // Final attempt failing S1 only = formatting, no gap.
    const s1Turn = foldBuildEvents([
      { type: "STEP_STARTED", stepName: "attempt-0" },
      { type: "CUSTOM", name: "dspack.gates", value: { gates: [{ gate: "S1", status: "FAIL", errors: ["(root) must be object"] }] } },
      { type: "RUN_FINISHED" },
    ]);
    expect(vocabularyGap(s1Turn)).toEqual([]);
    // A repaired S2 failure is not a standing gap.
    expect(vocabularyGap(foldBuildEvents(stream))).toEqual([]);
  });

  it("surfaces stream errors as an error status", () => {
    const turn = foldBuildEvents([{ type: "RUN_STARTED" }, { type: "RUN_ERROR", message: "agent gone" }]);
    expect(turn.status).toBe("error");
    expect(turn.error).toBe("agent gone");
  });
});


describe("structured build failures (#41)", () => {
  const run = (outcome: string, report: Record<string, any>, extra: Array<Record<string, any>> = []) =>
    foldBuildEvents([
      { type: "RUN_STARTED" },
      { type: "STEP_STARTED", stepName: "attempt-0" },
      ...extra,
      { type: "CUSTOM", name: "dspack.audit", value: { outcome, exitCode: outcome === "passed" ? 0 : 2, report } },
      { type: "RUN_FINISHED" },
    ]);

  it("an S3 governance failure names the rule, its message, its location, and the owner's rationale", () => {
    const f = buildFailure(
      run("failed-lint-exhausted", {
        attempts: [
          {
            index: 0,
            surface: { root: {} },
            gates: [
              { gate: "S1", name: "surface-schema", status: "PASS" },
              { gate: "S2", name: "contract-vocabulary", status: "PASS" },
              { gate: "S3", name: "governance", status: "FAIL" },
            ],
            findings: [
              {
                ruleId: "rule.destructive-requires-alertdialog",
                level: "error",
                message: "destructive action without an AlertDialog",
                rationale: "Irreversible actions must be confirmed deliberately.",
                location: { path: "$.root.children[0]", component: "action-button" },
              },
            ],
          },
        ],
      }),
    );
    expect(f?.kind).toBe("lint");
    expect(f?.stoppedAt).toMatch(/attempt 1.*S3/);
    expect(f?.reasons).toHaveLength(1);
    expect(f?.reasons[0]).toMatchObject({
      gate: "S3",
      code: "rule.destructive-requires-alertdialog",
      target: "$.root.children[0]",
      message: "destructive action without an AlertDialog",
      rationale: "Irreversible actions must be confirmed deliberately.",
    });
  });

  it("an S1/S2 failure reports its gate errors verbatim (no findings exist for those gates)", () => {
    const f = buildFailure(
      run("failed-lint-exhausted", {
        attempts: [
          {
            index: 0,
            gates: [
              { gate: "S1", name: "surface-schema", status: "PASS" },
              { gate: "S2", name: "contract-vocabulary", status: "FAIL", errors: ["component 'nope' is not contract vocabulary"] },
              { gate: "S3", name: "governance", status: "SKIPPED" },
            ],
            findings: [],
          },
        ],
      }),
    );
    expect(f?.kind).toBe("lint");
    expect(f?.reasons[0]).toMatchObject({ gate: "S2", message: "component 'nope' is not contract vocabulary" });
    expect(f?.reasons[0].rationale).toBeUndefined();
  });

  it("an emit refusal renders the emitter's verbatim refusal, not a bare outcome", () => {
    const f = buildFailure(
      run("failed-gate", {
        attempts: [{ index: 0, surface: { root: {} }, gates: [{ gate: "S1", name: "surface-schema", status: "PASS" }], findings: [] }],
        emitted: { target: "a2ui", warnings: [], validations: [], refusal: "component 'mini-stepper' is a declared casualty (cannot-represent): steps is free-form." },
      }),
    );
    expect(f?.kind).toBe("emit-refusal");
    expect(f?.reasons[0].message).toContain("declared casualty");
    expect(f?.stoppedAt).toMatch(/emit/i);
  });

  it("an emit A-gate failure names the gate and its errors", () => {
    const f = buildFailure(
      run("failed-gate", {
        attempts: [{ index: 0, surface: { root: {} }, gates: [], findings: [] }],
        emitted: {
          target: "a2ui",
          warnings: [],
          validations: [{ a2uiVersion: "0.9.1", gates: [{ gate: "A3", name: "instance", pass: false, errors: ["TextField requires label"] }] }],
        },
      }),
    );
    expect(f?.kind).toBe("emit-gate");
    expect(f?.reasons[0]).toMatchObject({ gate: "A3", message: "TextField requires label" });
  });

  it("an adapter failure carries the typed error and an actionable explanation", () => {
    const f = buildFailure(run("failed-adapter", { attempts: [{ index: 0, adapterError: "fetch failed: connect ECONNREFUSED 127.0.0.1:11434" }] }));
    expect(f?.kind).toBe("adapter");
    expect(f?.reasons[0].message).toContain("ECONNREFUSED");
    expect(f?.headline).toMatch(/model|provider/i);
  });

  it("repair exhaustion is named as such, with the last attempt's reasons", () => {
    const gates = [{ gate: "S2", name: "contract-vocabulary", status: "FAIL", errors: ["component 'x' is not contract vocabulary"] }];
    const f = buildFailure(
      run("failed-lint-exhausted", {
        attempts: [
          { index: 0, gates, findings: [] },
          { index: 1, gates, findings: [] },
          { index: 2, gates, findings: [] },
        ],
        repairMessages: ["r1", "r2"],
      }),
    );
    expect(f?.kind).toBe("repair-exhausted");
    expect(f?.headline).toMatch(/repair/i);
    expect(f?.reasons[0].gate).toBe("S2");
  });

  it("a passing run has no failure, and successful gates are never hidden", () => {
    const progress = run("passed", { attempts: [{ index: 0, surface: { root: { component: "x" } }, gates: [{ gate: "S1", name: "s", status: "PASS" }], findings: [] }] });
    expect(buildFailure(progress)).toBeNull();
    expect(progress.attempts[0].gates).toHaveLength(1); // the fold keeps every gate
  });

  it("Refine and Accept are offered only for a completed run with a valid surface", () => {
    const passed = run("passed", { attempts: [{ index: 0, surface: { root: {} }, gates: [], findings: [] }] });
    expect(canAcceptTurn(passed)).toBe(true);
    expect(canRefineTurn(passed)).toBe(true);

    // A failed turn may still carry a surface from its last attempt — neither action applies.
    const failed = run("failed-lint-exhausted", { attempts: [{ index: 0, surface: { root: {} }, gates: [], findings: [] }] });
    expect(canAcceptTurn(failed)).toBe(false);
    expect(canRefineTurn(failed)).toBe(false);

    const adapter = run("failed-adapter", { attempts: [{ index: 0, adapterError: "boom" }] });
    expect(canAcceptTurn(adapter)).toBe(false);
    expect(canRefineTurn(adapter)).toBe(false);

    const streaming = foldBuildEvents([{ type: "RUN_STARTED" }]);
    expect(canAcceptTurn(streaming)).toBe(false);
    expect(canRefineTurn(streaming)).toBe(false);
  });

  it("a vocabulary gap stays distinguishable from malformed model output", () => {
    const gap = run("failed-lint-exhausted", {
      attempts: [{ index: 0, gates: [{ gate: "S2", name: "contract-vocabulary", status: "FAIL", errors: ["component 'timeline' is not contract vocabulary"] }], findings: [] }],
    });
    expect(vocabularyGap(gap)).toEqual(["timeline"]);
    expect(buildFailure(gap)?.kind).toBe("lint");

    const malformed = run("failed-lint-exhausted", {
      attempts: [{ index: 0, gates: [{ gate: "S1", name: "surface-schema", status: "FAIL", errors: ["(root) must be object"] }], findings: [] }],
    });
    expect(vocabularyGap(malformed)).toEqual([]);
    expect(buildFailure(malformed)?.reasons[0].gate).toBe("S1");
  });
});

describe("worked-example prompt provenance (#42)", () => {
  it("keeps the ORIGINAL request as the prompt and records refinements deterministically", () => {
    expect(examplePromptFor(["a deployment status screen"])).toBe("a deployment status screen");
    expect(examplePromptFor(["a deployment status screen", "make the title clearer"])).toBe(
      "a deployment status screen — refined: make the title clearer",
    );
    expect(examplePromptFor(["a status screen", "make the title clearer", "add the region"])).toBe(
      "a status screen — refined: make the title clearer; add the region",
    );
    // Deterministic and stable: same chain, same string.
    expect(examplePromptFor(["a", "b"])).toBe(examplePromptFor(["a", "b"]));
    // Never merely the last instruction.
    expect(examplePromptFor(["original", "last"])).toContain("original");
  });
});
