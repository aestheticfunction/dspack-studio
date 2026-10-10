/**
 * Model-call accounting (Phase 0.5): the shape every receipt and every later
 * budget reads. Provider-reported figures and calls that never reached a model
 * are kept apart; nothing here estimates.
 */
import { describe, expect, it } from "vitest";
import {
  aggregateUsage,
  callsFromReport,
  createCallRecorder,
  describeCalls,
  describeTimings,
  normalizeUsage,
  proposeBody,
  reconcileGenerationUsage,
  turnTimings,
  type ModelCallRecord,
} from "./index";

describe("normalizeUsage", () => {
  it("reads every shape Composer meets, including the legacy Worker {in, out}", () => {
    expect(normalizeUsage({ inputTokens: 10, outputTokens: 2 })).toEqual({ inputTokens: 10, outputTokens: 2 });
    expect(normalizeUsage({ input_tokens: 10, output_tokens: 2 })).toEqual({ inputTokens: 10, outputTokens: 2 });
    expect(normalizeUsage({ prompt_tokens: 10, completion_tokens: 2 })).toEqual({ inputTokens: 10, outputTokens: 2 });
    expect(normalizeUsage({ in: 10, out: 2 })).toEqual({ inputTokens: 10, outputTokens: 2 });
  });

  it("never invents a figure: null, negative, NaN and missing keys are absent", () => {
    expect(normalizeUsage({ in: null, out: null })).toBeUndefined();
    expect(normalizeUsage({ inputTokens: -1, outputTokens: Number.NaN })).toBeUndefined();
    expect(normalizeUsage({ inputTokens: 7 })).toEqual({ inputTokens: 7 });
    expect(normalizeUsage(null)).toBeUndefined();
    expect(normalizeUsage("12")).toBeUndefined();
  });
});

describe("aggregateUsage", () => {
  const calls: ModelCallRecord[] = [
    { operation: "plan", source: "provider", inputTokens: 1900, outputTokens: 40, outcome: "ok" },
    { operation: "generate", attempt: 0, subCall: 0, source: "provider", inputTokens: 54000, outputTokens: 30, outcome: "unusable-output" },
    { operation: "generate", attempt: 0, subCall: 1, source: "provider", inputTokens: 54000, outputTokens: 700, outcome: "ok" },
    { operation: "repair", attempt: 1, source: "provider", outcome: "provider-error" },
    { operation: "repair", attempt: 2, source: "none", outcome: "refused" },
  ];

  it("sums provider-reported figures across every operation, failed calls included", () => {
    const totals = aggregateUsage(calls);
    expect(totals.provider).toEqual({ inputTokens: 109900, outputTokens: 770, calls: 4 });
  });

  it("counts unmetered provider calls and model-free requests separately, never as zeros", () => {
    const totals = aggregateUsage(calls);
    expect(totals.unreported).toBe(1);
    expect(totals.none).toBe(1);
  });

  it("an empty run is all zeros", () => {
    expect(aggregateUsage([])).toEqual({
      provider: { inputTokens: 0, outputTokens: 0, calls: 0 },
      unreported: 0,
      unreportedInput: 0,
      unreportedOutput: 0,
      none: 0,
    });
  });

  it("counts a call missing ONE figure against that figure, not as a zero", () => {
    const totals = aggregateUsage([
      { operation: "generate", attempt: 0, subCall: 0, source: "provider", inputTokens: 900, outputTokens: 40, outcome: "unusable-output" },
      { operation: "generate", attempt: 0, subCall: 1, source: "provider", inputTokens: 900, outcome: "ok" },
      { operation: "repair", attempt: 1, source: "provider", outcome: "provider-error" },
    ]);
    expect(totals.unreported).toBe(1);
    expect(totals.unreportedInput).toBe(1);
    expect(totals.unreportedOutput).toBe(2);
  });
});

describe("createCallRecorder", () => {
  it("keeps records in order and stores copies, so a caller cannot rewrite history", () => {
    const recorder = createCallRecorder();
    const call: ModelCallRecord = { operation: "generate", attempt: 0, source: "provider", inputTokens: 5, outcome: "ok" };
    recorder.record(call);
    call.inputTokens = 999;
    recorder.record({ operation: "repair", attempt: 1, source: "provider", outcome: "provider-error" });
    expect(recorder.calls.map((c) => c.operation)).toEqual(["generate", "repair"]);
    expect(recorder.calls[0]?.inputTokens).toBe(5);
  });
});

describe("callsFromReport (paths with no transport recorder)", () => {
  it("scripted runs record no model call, not provider-shaped zeros", () => {
    const report = {
      generation: { adapterId: "fake:scripted" },
      attempts: [
        { index: 0, model: "fake-model", usage: { inputTokens: 0, outputTokens: 0 }, meta: { provider: "fake" } },
        { index: 1, model: "fake-model", usage: { inputTokens: 0, outputTokens: 0 }, meta: { provider: "fake" } },
      ],
    };
    const calls = callsFromReport(report);
    expect(calls.map((c) => [c.operation, c.source])).toEqual([
      ["generate", "none"],
      ["repair", "none"],
    ]);
    expect(aggregateUsage(calls).provider.calls).toBe(0);
  });

  it("a local model's attempts carry its reported usage; a thrown attempt is an unmetered provider error", () => {
    const report = {
      generation: { adapterId: "ollama:gemma4:e4b" },
      attempts: [
        { index: 0, model: "gemma4:e4b", usage: { inputTokens: 3000, outputTokens: 400 } },
        { index: 1, adapterError: "[ollama:gemma4:e4b] connection refused" },
      ],
    };
    const calls = callsFromReport(report, { refinement: true });
    expect(calls[0]).toMatchObject({ operation: "refine", attempt: 0, source: "provider", inputTokens: 3000, outputTokens: 400, model: "gemma4:e4b", outcome: "ok" });
    expect(calls[1]).toMatchObject({ operation: "repair", attempt: 1, source: "provider", outcome: "provider-error" });
    expect(calls[1]?.inputTokens).toBeUndefined();
  });

  it("a scripted attempt that threw is recorded as failed, not ok", () => {
    const report = { generation: { adapterId: "fake:scripted" }, attempts: [{ index: 0, adapterError: "[fake:scripted] scripted failure" }] };
    expect(callsFromReport(report)[0]).toMatchObject({ source: "none", outcome: "provider-error" });
  });

  it("no report, no calls", () => {
    expect(callsFromReport(undefined)).toEqual([]);
  });
});

describe("reconcileGenerationUsage", () => {
  const report = {
    generation: { adapterId: "hosted-ai:claude-haiku-4.5" },
    attempts: [{ index: 0, usage: { inputTokens: 108000, outputTokens: 730 } }, { index: 1, adapterError: "[hosted-ai] busy" }],
  };

  it("agrees when the recorder's calls for an attempt sum to the report's figure (the Worker retry included)", () => {
    const recorded: ModelCallRecord[] = [
      { operation: "plan", source: "provider", inputTokens: 1900, outputTokens: 40, outcome: "ok" },
      { operation: "generate", attempt: 0, subCall: 0, source: "provider", inputTokens: 54000, outputTokens: 30, outcome: "unusable-output" },
      { operation: "generate", attempt: 0, subCall: 1, source: "provider", inputTokens: 54000, outputTokens: 700, outcome: "ok" },
      { operation: "repair", attempt: 1, source: "provider", outcome: "provider-error" },
    ];
    expect(reconcileGenerationUsage(recorded, report)).toEqual({ consistent: true, mismatches: [] });
  });

  it("names the attempt when they disagree (a dropped retry, say)", () => {
    const recorded: ModelCallRecord[] = [
      { operation: "generate", attempt: 0, subCall: 1, source: "provider", inputTokens: 54000, outputTokens: 700, outcome: "ok" },
    ];
    const result = reconcileGenerationUsage(recorded, report);
    expect(result.consistent).toBe(false);
    expect(result.mismatches).toEqual([
      { attempt: 0, reported: { inputTokens: 108000, outputTokens: 730 }, recorded: { inputTokens: 54000, outputTokens: 700 } },
    ]);
  });
});

describe("turnTimings", () => {
  const gates = (status: string) => ({ type: "CUSTOM", name: "dspack.gates", value: { gates: [{ gate: "S1", status }] } });

  it("first gated attempt is the first dspack.gates of ANY verdict; emit time runs from the last one", () => {
    const stamped = [
      { atMs: 900, event: { type: "RUN_STARTED" } },
      { atMs: 4000, event: gates("FAIL") },
      { atMs: 7000, event: gates("PASS") },
      { atMs: 7250, event: { type: "CUSTOM", name: "dspack.emit", value: {} } },
      {
        atMs: 7300,
        event: { type: "CUSTOM", name: "dspack.audit", value: { outcome: "passed", report: { attempts: [{}, { surface: { root: {} } }] } } },
      },
    ];
    expect(turnTimings(stamped, { totalMs: 7400, planMs: 850 })).toEqual({
      planMs: 850,
      firstGatedAttemptMs: 4000,
      firstValidPreviewMs: 7300,
      emitMs: 250,
      totalMs: 7400,
    });
  });

  it("a failed run has no valid preview time, and a refinement reports no planning time", () => {
    const stamped = [
      { atMs: 3000, event: gates("FAIL") },
      { atMs: 3100, event: { type: "CUSTOM", name: "dspack.audit", value: { outcome: "failed-lint-exhausted", report: { attempts: [{ surface: {} }] } } } },
    ];
    expect(turnTimings(stamped, { totalMs: 3200 })).toEqual({ firstGatedAttemptMs: 3000, totalMs: 3200 });
  });
});

describe("proposeBody maxCalls", () => {
  const request = { system: "sys", messages: [{ role: "user", content: "x" }], jsonSchema: { type: "object" } };

  it("absent: the exact bytes sent today (the Phase 0 request hashes depend on it)", () => {
    expect(proposeBody(request)).toBe('{"system":"sys","messages":[{"role":"user","content":"x"}],"jsonSchema":{"type":"object"}}');
    expect(proposeBody(request, {})).toBe(proposeBody(request));
  });

  it("present: appended last, after the request it caps", () => {
    expect(proposeBody(request, { maxCalls: 1 })).toBe(
      '{"system":"sys","messages":[{"role":"user","content":"x"}],"jsonSchema":{"type":"object"},"maxCalls":1}',
    );
  });
});

describe("receipts", () => {
  it("a hosted turn: calls by operation and provider-reported totals, failed calls included", () => {
    const calls: ModelCallRecord[] = [
      { operation: "plan", source: "provider", inputTokens: 1912, outputTokens: 48, outcome: "ok" },
      { operation: "generate", attempt: 0, subCall: 0, source: "provider", inputTokens: 56427, outputTokens: 30, outcome: "unusable-output" },
      { operation: "generate", attempt: 0, subCall: 1, source: "provider", inputTokens: 56427, outputTokens: 912, outcome: "ok" },
    ];
    expect(describeCalls(calls)).toBe("3 model calls (plan 1, generate 2) · 114,766 input + 990 output tokens, provider-reported");
  });

  it("unmetered calls and refusals are said, never folded into zeros", () => {
    expect(describeCalls([{ operation: "generate", attempt: 0, source: "provider", outcome: "provider-error" }])).toBe(
      "1 model call (generate 1) · usage not reported",
    );
    expect(
      describeCalls([
        { operation: "repair", attempt: 1, source: "provider", inputTokens: 900, outputTokens: 10, outcome: "ok" },
        { operation: "repair", attempt: 2, source: "provider", outcome: "provider-error" },
        { operation: "repair", attempt: 3, source: "none", outcome: "refused" },
      ]),
    ).toBe("2 model calls (repair 2) · 900 input + 10 output tokens, provider-reported · 1 call reported no usage · 1 request refused before reaching a model");
  });

  it("a figure some calls did not report is named, never shown as a provider-reported zero", () => {
    expect(describeCalls([{ operation: "generate", attempt: 0, source: "provider", inputTokens: 900, outcome: "ok" }])).toBe(
      "1 model call (generate 1) · 900 input tokens, provider-reported · output not reported for 1 call",
    );
    expect(
      describeCalls([
        { operation: "generate", attempt: 0, subCall: 0, source: "provider", inputTokens: 900, outputTokens: 40, outcome: "unusable-output" },
        { operation: "generate", attempt: 0, subCall: 1, source: "provider", inputTokens: 900, outcome: "ok" },
      ]),
    ).toBe("2 model calls (generate 2) · 1,800 input + 40 output tokens, provider-reported · output not reported for 1 call");
  });

  it("scripted turns make no model calls; a refinement makes no planning call", () => {
    expect(describeCalls([{ operation: "generate", attempt: 0, source: "none", outcome: "ok" }])).toBe("no model calls (scripted)");
    expect(describeCalls([])).toBe("no model calls");
    expect(describeCalls(undefined)).toBe("model calls not reported");
  });

  it("timings read in seconds, only the ones that happened", () => {
    expect(describeTimings({ planMs: 812, firstGatedAttemptMs: 4020, firstValidPreviewMs: 7310, emitMs: 260, totalMs: 7400 })).toBe(
      "planning 0.8 s · first gated attempt 4.0 s · valid preview 7.3 s · emit 0.3 s · total 7.4 s",
    );
    expect(describeTimings({ totalMs: 120 })).toBe("total 0.1 s");
  });
});
