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
 */
export interface PermalinkState {
  scenario?: string;
  fixture?: string;
  fork?: { parentKey: string; forkIndex: number };
  event?: number;
  panel?: "receipt" | "wire" | "pipeline";
  xray?: boolean;
}

const PANELS = new Set(["receipt", "wire", "pipeline"]);

export function parsePermalink(hash: string): { state: PermalinkState; error?: string } {
  const raw = hash.replace(/^#\/?/, "");
  if (!raw) return { state: {} };
  const p = new URLSearchParams(raw);
  const state: PermalinkState = {};
  if (p.get("s")) state.scenario = p.get("s")!;
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
  if (state.fork) p.set("fork", `${state.fork.parentKey}@${state.fork.forkIndex}`);
  else if (state.fixture) p.set("f", state.fixture);
  if (state.event !== undefined && state.event >= 0) p.set("e", String(state.event));
  if (state.panel) p.set("panel", state.panel);
  if (state.xray) p.set("x", "1");
  return `#${p.toString()}`;
}
