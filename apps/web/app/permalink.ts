"use client";

/**
 * Stable deep links, static-hosting-safe: everything lives in the URL hash
 * as short identifiers — scenario id, bundled fixture key, fork spec
 * (parentKey@eventIndex, reconstructed deterministically from the bundled
 * parent), timeline event index, and an optional panel. No prompts, keys,
 * hosts, or session contents ever enter the URL; imported sessions are
 * deliberately not linkable (they live on the visitor's disk) and the UI
 * says so instead of pretending.
 *
 *   #s=<scenario>&f=<fixtureKey>&e=<n>&panel=receipt|wire|pipeline&x=1
 *   #s=<scenario>&fork=<parentKey>@<n>&e=<n>
 *   #s=<scenario>&v=break&bc=<conditionId>&e=<n>
 *
 * v names the OPERATION (replay is the default and stays out of the URL);
 * bc names a break condition. The scenario always wins: a condition that
 * does not belong to the named scenario never drags the scenario along —
 * the studio lands on the scenario's own valid default and says why.
 */
export interface PermalinkState {
  scenario?: string;
  view?: "replay" | "live" | "break" | "canvas" | "home";
  fixture?: string;
  fork?: { parentKey: string; forkIndex: number };
  breakCondition?: string;
  event?: number;
  panel?: "receipt" | "wire" | "pipeline";
  xray?: boolean;
}

const PANELS = new Set(["receipt", "wire", "pipeline"]);
const VIEWS = new Set(["replay", "live", "break", "canvas", "home"]);

export function parsePermalink(hash: string): { state: PermalinkState; error?: string } {
  const raw = hash.replace(/^#\/?/, "");
  if (!raw) return { state: {} };
  const p = new URLSearchParams(raw);
  const state: PermalinkState = {};
  if (p.get("s")) state.scenario = p.get("s")!;
  const view = p.get("v");
  if (view) {
    if (!VIEWS.has(view)) return { state, error: `unknown view '${view}'` };
    state.view = view as PermalinkState["view"];
  }
  if (p.get("bc")) state.breakCondition = p.get("bc")!;
  if (p.get("f")) state.fixture = p.get("f")!;
  const fork = p.get("fork");
  if (fork) {
    const m = /^(.+)@(\d+)$/.exec(fork);
    if (!m) return { state, error: `unrecognized fork reference '${fork}' (expected parentKey@eventIndex)` };
    state.fork = { parentKey: m[1], forkIndex: Number(m[2]) };
  }
  if (p.get("e") !== null) {
    const e = Number(p.get("e"));
    if (!Number.isInteger(e) || e < 0) return { state, error: `'${p.get("e")}' is not an event index` };
    state.event = e;
  }
  const panel = p.get("panel");
  if (panel) {
    if (!PANELS.has(panel)) return { state, error: `unknown panel '${panel}'` };
    state.panel = panel as PermalinkState["panel"];
  }
  if (p.get("x") === "1") state.xray = true;
  return { state };
}

export function buildPermalink(state: PermalinkState): string {
  const p = new URLSearchParams();
  if (state.scenario) p.set("s", state.scenario);
  if (state.view && state.view !== "replay") p.set("v", state.view);
  if (state.breakCondition) p.set("bc", state.breakCondition);
  if (state.fork) p.set("fork", `${state.fork.parentKey}@${state.fork.forkIndex}`);
  else if (state.fixture) p.set("f", state.fixture);
  if (state.event !== undefined && state.event >= 0) p.set("e", String(state.event));
  if (state.panel) p.set("panel", state.panel);
  if (state.xray) p.set("x", "1");
  return `#${p.toString()}`;
}
