// Independent, read-only analysis of a block-bench run directory: ledger reconciliation, integrity invariants,
// and results by arm, prompt and design system. Reads requests.jsonl, runs.jsonl, runs.superseded.jsonl,
// pacing.jsonl, manifest.json and summary.json. Writes nothing. Usage: node analyze.mjs <runDir> [planned]
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const planned = Number(process.argv[3] ?? 32);
const read = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8") : "");
const jsonl = (f) => read(f).split("\n").filter(Boolean).map((l, i) => { try { return JSON.parse(l); } catch { return { __torn: l.slice(0, 80), __file: f, __line: i + 1 }; } });
const ledger = jsonl("requests.jsonl"), runs = jsonl("runs.jsonl"), superseded = jsonl("runs.superseded.jsonl"), pacing = jsonl("pacing.jsonl");
const manifest = JSON.parse(read("manifest.json"));
const summary = existsSync(join(dir, "summary.json")) ? JSON.parse(read("summary.json")) : null;
const torn = [...ledger, ...runs, ...superseded, ...pacing].filter((x) => x.__torn);
const RUN_MODEL = manifest.servedModel?.id;
const IN = 1e-6, OUT = 5e-6, FEE = 1.05;
const nd = (x) => Math.round(x * 1e9);
const usd = (n) => Math.round(n) / 1e9;

// ---------- Ledger ----------
const byRequest = new Map();
for (const l of ledger.filter((x) => !x.__torn)) {
  const r = byRequest.get(l.request) ?? { request: l.request, invocation: l.invocation, reservations: [], settlements: [] };
  if (typeof l.usd === "number") r.reservations.push(l); else if (typeof l.final === "number") r.settlements.push(l);
  byRequest.set(l.request, r);
}
const requests = [...byRequest.values()];
const ledgerFindings = [];
let committed = 0;
for (const r of requests) {
  if (r.reservations.length !== 1) ledgerFindings.push(`${r.request}: ${r.reservations.length} reservations`);
  if (r.settlements.length === 0) ledgerFindings.push(`${r.request}: unsettled`);
  const c = r.reservations.reduce((s, l) => s + nd(l.usd), 0) + r.settlements.reduce((s, l) => s + nd(l.adjust ?? 0), 0);
  const last = r.settlements.at(-1);
  if (last && nd(last.final) !== c) ledgerFindings.push(`${r.request}: final ${last.final} != reservation+adjustments ${usd(c)}`);
  r.committed = c;
  r.reason = last?.reason;
  r.servedModel = last?.servedModel;
  committed += c;
}
const reasons = {};
for (const r of requests) reasons[r.reason ?? "unsettled"] = (reasons[r.reason ?? "unsettled"] ?? 0) + 1;
const servedModels = [...new Set(requests.map((r) => r.servedModel).filter(Boolean))];
const invocations = [...new Set(ledger.map((l) => l.invocation).filter(Boolean))];

// ---------- Cells ----------
const providerCalls = (r) => (r.calls ?? []).filter((c) => c.source === "provider");
// One gateway request per call that opens a request (subCall 0 or absent), refused sends included.
const requestCount = (r) => (r.calls ?? []).filter((c) => (c.subCall ?? 0) === 0).length;
const listUsd = (calls) => calls.reduce((s, c) => s + (c.inputTokens ?? 0) * IN + (c.outputTokens ?? 0) * OUT, 0);

// Walk the ledger in order, giving each logged cell its requests; what is left belongs to cells that logged no record.
const ordered = [...requests].sort((a, b) => {
  const [ia, na] = a.request.split("#"), [ib, nb] = b.request.split("#");
  return ia === ib ? Number(na) - Number(nb) : invocations.indexOf(ia) - invocations.indexOf(ib);
});
let cursor = 0;
const cellLedger = new Map();
const mappingFindings = [];
for (const r of runs.filter((x) => !x.__torn)) {
  const n = requestCount(r);
  const mine = ordered.slice(cursor, cursor + n);
  cursor += n;
  const ledgerUsd = mine.reduce((s, q) => s + q.committed, 0);
  const expect = nd(listUsd(providerCalls(r)) * FEE);
  const allVerified = mine.every((q) => q.reason === "settled at the reported usage");
  if (allVerified && Math.abs(ledgerUsd - expect) > 1000) mappingFindings.push(`${r.reference}|${r.arm}|${r.prompt}: ledger ${usd(ledgerUsd)} vs reported×fee ${usd(expect)}`);
  cellLedger.set(r, { requests: mine.length, ledgerUsd, reasons: mine.map((q) => q.reason) });
}
const unlogged = ordered.slice(cursor).map((q) => ({ request: q.request, committedUsd: usd(q.committed), reason: q.reason, servedModel: q.servedModel }));

// ---------- Integrity invariants over logged calls ----------
const integrity = [];
for (const r of runs.filter((x) => !x.__torn)) {
  for (const c of r.calls ?? []) {
    if (c.source !== "provider") continue;
    const reached = c.outcome === "ok" || c.outcome === "unusable-output";
    if (reached && (typeof c.inputTokens !== "number" || typeof c.outputTokens !== "number")) integrity.push(`${r.reference}|${r.arm}|${r.prompt} ${c.operation}: usage missing`);
    if (reached && c.model !== RUN_MODEL) integrity.push(`${r.reference}|${r.arm}|${r.prompt} ${c.operation}: model ${c.model}`);
    if (!reached && (c.inputTokens != null || c.outputTokens != null || c.model != null)) integrity.push(`${r.reference}|${r.arm}|${r.prompt} ${c.operation}: ${c.outcome} with usage or model`);
  }
  if ((r.tokens?.unreportedCalls ?? 0) !== 0) integrity.push(`${r.reference}|${r.arm}|${r.prompt}: ${r.tokens.unreportedCalls} unreported calls`);
}

// ---------- Tables ----------
const blank = () => ({ cells: 0, completed: 0, skipped: 0, passed: 0, failed: 0, outcomes: {}, paths: {}, attempts: 0, pipelineRepairs: 0, blockRepairs: 0, reissues: 0, workerRetries: 0, refusedSends: 0, providerCalls: 0, requests: 0, input: 0, output: 0, listUsd: 0, ledgerUsd: 0, requestBytes: 0, totalMs: 0, firstAttemptPass: 0, selectionCorrect: 0, selectionScored: 0, parity: [] });
const add = (t, r) => {
  t.cells++; t[r.status === "completed" ? "completed" : "skipped"]++;
  if (r.passed) t.passed++; else if (r.status === "completed") t.failed++;
  t.outcomes[r.outcome ?? "none"] = (t.outcomes[r.outcome ?? "none"] ?? 0) + 1;
  t.paths[r.path ?? "none"] = (t.paths[r.path ?? "none"] ?? 0) + 1;
  t.attempts += r.attempts ?? 0;
  t.pipelineRepairs += Math.max(0, (r.attempts ?? 0) - 1);
  if (r.passed && r.attempts === 1 && r.path !== "block-repair") t.firstAttemptPass++;
  for (const c of r.calls ?? []) {
    if (c.operation === "block-repair") t.blockRepairs++;
    if (c.reissue || /reissue/.test(c.operation ?? "")) t.reissues++;
    if ((c.subCall ?? 0) > 0) t.workerRetries++;
    if (c.outcome === "refused") t.refusedSends++;
  }
  t.providerCalls += providerCalls(r).length;
  t.requests += requestCount(r);
  t.input += r.tokens?.input ?? 0; t.output += r.tokens?.output ?? 0;
  t.listUsd += listUsd(providerCalls(r));
  t.ledgerUsd += cellLedger.get(r)?.ledgerUsd ?? 0;
  t.requestBytes += r.requestBytes ?? 0; t.totalMs += r.timings?.totalMs ?? 0;
  if (r.selection && typeof r.selection.correct === "boolean") { t.selectionScored++; if (r.selection.correct) t.selectionCorrect++; }
  if (typeof r.parity?.score === "number") t.parity.push(r.parity.score);
};
const finish = (t) => ({ ...t, listUsd: Number(t.listUsd.toFixed(6)), ledgerUsd: usd(t.ledgerUsd), meanInput: t.cells ? Math.round(t.input / t.cells) : null, meanOutput: t.cells ? Math.round(t.output / t.cells) : null, tokensPerPass: t.passed ? Math.round((t.input + t.output) / t.passed) : null, meanRequestBytes: t.cells ? Math.round(t.requestBytes / t.cells) : null, meanTotalS: t.cells ? Number((t.totalMs / t.cells / 1000).toFixed(1)) : null, meanParity: t.parity.length ? Number((t.parity.reduce((a, b) => a + b, 0) / t.parity.length).toFixed(3)) : null, parity: undefined });
const group = (keyOf) => {
  const out = {};
  for (const r of runs.filter((x) => !x.__torn)) add((out[keyOf(r)] ??= blank()), r);
  return Object.fromEntries(Object.entries(out).sort().map(([k, t]) => [k, finish(t)]));
};

const cells = runs.filter((x) => !x.__torn).map((r) => ({
  cell: `${r.reference}|${r.arm}|${r.prompt}`,
  outcome: r.outcome, passed: r.passed, path: r.path, attempts: r.attempts,
  chosen: r.selection?.chosen ?? null, expected: r.expected?.block ?? null, selectionCorrect: r.selection?.correct ?? null, planSource: r.plan?.source ?? null,
  calls: (r.calls ?? []).map((c) => `${c.operation}${c.attempt !== undefined ? "#" + c.attempt : ""}${c.subCall ? "." + c.subCall : ""}:${c.outcome}${c.inputTokens != null ? `(${c.inputTokens}/${c.outputTokens})` : ""}`).join(" "),
  input: r.tokens?.input, output: r.tokens?.output, providerCalls: providerCalls(r).length, requests: cellLedger.get(r)?.requests,
  ledgerUsd: usd(cellLedger.get(r)?.ledgerUsd ?? 0), listUsd: Number(listUsd(providerCalls(r)).toFixed(6)),
  requestBytes: r.requestBytes, totalS: Number(((r.timings?.totalMs ?? 0) / 1000).toFixed(1)),
  parity: r.parity?.score ?? null,
  failure: r.failure ? { kind: r.failure.kind, message: String(r.failure.message ?? "").slice(0, 160), rerunEligible: r.rerunEligible ?? r.failure.rerunEligible } : null,
  trace: r.trace ? { encoding: r.trace.encoding, outcome: r.trace.outcome, providerCalls: r.trace.providerCalls, rawBlockBytes: r.trace.rawBlockBytes, fallback: r.trace.fallback ?? null } : null,
}));

// Named vs positional, paired by design system and prompt.
const pick = (arm) => Object.fromEntries(runs.filter((r) => r.arm === arm).map((r) => [`${r.reference}|${r.prompt}`, r]));
const named = pick("block"), positional = pick("block-positional");
const blockCalls = (r) => (r.calls ?? []).filter((c) => /^block/.test(c.operation ?? "") && c.source === "provider");
const side = (r) => ({ outcome: r.outcome, path: r.path, attempts: r.attempts, chosen: r.selection?.chosen ?? null, blockCalls: blockCalls(r).length, blockIn: blockCalls(r).reduce((s, c) => s + (c.inputTokens ?? 0), 0), blockOut: blockCalls(r).reduce((s, c) => s + (c.outputTokens ?? 0), 0), rawBlockBytes: r.trace?.rawBlockBytes ?? null, totalIn: r.tokens?.input, totalOut: r.tokens?.output, requestBytes: r.requestBytes, parity: r.parity?.score ?? null, failure: r.failure?.kind ?? null });
const namedVsPositional = Object.keys(named).filter((k) => positional[k]).sort().map((k) => ({ pair: k, named: side(named[k]), positional: side(positional[k]) }));

// Pacing and stops, per invocation.
const invocationLog = pacing.filter((p) => !p.__torn).map((p) => {
  const pc = p.telemetry?.pacing ?? {};
  const waits = pc.waits ?? [];
  const nonSpacing = waits.filter((w) => w.reason !== "spacing");
  return { at: p.at, stopped: p.stopped ?? null, sent: pc.sent, waits: waits.length, spacingWaitS: Number((waits.filter((w) => w.reason === "spacing").reduce((s, w) => s + w.ms, 0) / 1000).toFixed(1)), otherWaits: nonSpacing };
});

console.log(JSON.stringify({
  runId: manifest.runId, startedAt: manifest.startedAt, provider: manifest.provider, runModel: RUN_MODEL, limits: manifest.limits, code: manifest.code, corpus: manifest.corpus,
  preflightBuild: manifest.deployment ?? null,
  ledger: {
    requests: requests.length, reservationLines: ledger.filter((l) => typeof l.usd === "number").length, settlementLines: ledger.filter((l) => typeof l.final === "number").length,
    committedUsd: usd(committed), withinCeiling: usd(committed) <= (manifest.limits?.maxTotalUsd ?? Infinity), withinRequestCap: requests.length <= (manifest.limits?.maxTotalRequests ?? Infinity),
    reasons, servedModels, invocations: invocations.length, findings: ledgerFindings, mappingFindings, unloggedRequests: unlogged,
  },
  priceCheck: {
    reportedListUsd: Number(runs.reduce((s, r) => s + listUsd(providerCalls(r)), 0).toFixed(6)),
    reportedWithFeeUsd: Number((runs.reduce((s, r) => s + listUsd(providerCalls(r)), 0) * FEE).toFixed(6)),
    note: "list = provider-reported tokens at $1/M input and $5/M output; the ledger adds the 5% credit fee",
  },
  cells: { planned, logged: runs.length, completed: runs.filter((r) => r.status === "completed").length, skipped: runs.filter((r) => r.status === "skipped").length, passed: runs.filter((r) => r.passed).length, failed: runs.filter((r) => r.status === "completed" && !r.passed).length, superseded: superseded.length, torn: torn.length },
  integrity: { findings: integrity, tornLines: torn },
  stopped: summary?.stopped ?? null,
  invocationLog,
  byArm: group((r) => r.arm),
  byReference: group((r) => r.reference),
  byPrompt: group((r) => r.prompt),
  byReferenceArm: group((r) => `${r.reference}|${r.arm}`),
  namedVsPositional,
  cellRows: cells,
}, null, 1));
