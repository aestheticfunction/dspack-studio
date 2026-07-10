/**
 * Session-fixture import: the third event source. Downloaded live sessions
 * reopen through the same reducers and RunView as everything else — this
 * module only validates and labels; there is no separate replay path.
 *
 * Validation is deliberately strict and error-messages are user-facing:
 * imports are the one input that arrives from outside the app's control.
 */
import type { FixtureEvent, ReplayFixture } from "./fixture";

/** Hard ceiling for imported files: a recorded run is tens of KB; 5 MB is
 * already two orders of magnitude past any honest fixture. */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_EVENTS = 5000;

export interface ImportResult {
  ok: true;
  fixture: ReplayFixture;
  /** True when the fixture self-identifies as an imported session. */
  imported: true;
}

export interface ImportError {
  ok: false;
  error: string;
}

export function importFixture(raw: string, byteLength?: number): ImportResult | ImportError {
  const size = byteLength ?? new TextEncoder().encode(raw).length;
  if (size > MAX_IMPORT_BYTES) {
    return { ok: false, error: `file is ${(size / 1024 / 1024).toFixed(1)} MB — fixtures are small JSON documents (limit 5 MB)` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "not valid JSON" };
  }

  const f = parsed as Partial<ReplayFixture>;
  if (typeof f !== "object" || f === null || !("replayFixture" in f)) {
    return { ok: false, error: "not a replay fixture (missing the replayFixture version field)" };
  }
  if (f.replayFixture !== "0.1") {
    return { ok: false, error: `unsupported fixture version '${String(f.replayFixture)}' (this build reads 0.1)` };
  }
  if (!Array.isArray(f.events)) {
    return { ok: false, error: "fixture has no events array" };
  }
  if (f.events.length > MAX_IMPORT_EVENTS) {
    return { ok: false, error: `fixture has ${f.events.length} events (limit ${MAX_IMPORT_EVENTS})` };
  }
  for (let i = 0; i < f.events.length; i++) {
    const e = f.events[i] as Partial<FixtureEvent>;
    if (typeof e?.atMs !== "number" || typeof e?.event !== "object" || e.event === null || typeof (e.event as any).type !== "string") {
      return { ok: false, error: `event ${i} is malformed (expected { atMs: number, event: { type: string, … } })` };
    }
  }
  if (f.mode !== "live" && f.mode !== "scripted") {
    return { ok: false, error: `fixture mode '${String(f.mode)}' is not "live" or "scripted"` };
  }

  return {
    ok: true,
    imported: true,
    fixture: {
      replayFixture: "0.1",
      id: String(f.id ?? "imported-session"),
      name: String(f.name ?? "Imported session"),
      recordedAt: String(f.recordedAt ?? ""),
      mode: f.mode,
      adapterId: String(f.adapterId ?? "unknown"),
      intent: String(f.intent ?? ""),
      prompt: String(f.prompt ?? ""),
      events: f.events as FixtureEvent[],
    },
  };
}
