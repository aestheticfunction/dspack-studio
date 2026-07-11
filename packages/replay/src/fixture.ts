/**
 * The recorded-run fixture format (versioned). A fixture is the complete
 * AG-UI event stream of one run plus original timings — the honest-magic
 * substrate: replays are recorded runs, never hand-scripted content. The
 * `mode` field keeps that distinction auditable: "live" fixtures came from a
 * real model; "scripted" fixtures came from the deterministic ScriptedAdapter
 * (CI and dev only — the public site labels them).
 *
 * Events are stored as plain JSON (AG-UI wire shapes, SCREAMING_SNAKE type
 * strings); this package deliberately has no @ag-ui dependency so fixtures
 * and reducers stay pure data.
 */

export interface FixtureEvent {
  /** Milliseconds since run start when the event was observed. */
  atMs: number;
  event: Record<string, unknown> & { type: string };
}

/** FM-3: where a forked run came from. Present only on forked fixtures. */
export interface ForkProvenance {
  /** The id of the fixture this run was forked from. */
  parentId: string;
  parentName?: string;
  /** The playhead event index the fork was taken at (the prefix [0..index] was copied). */
  forkIndex: number;
  forkedAt: string;
}

export interface ReplayFixture {
  replayFixture: "0.1";
  id: string;
  name: string;
  recordedAt: string;
  /** "live" = real model adapter; "scripted" = deterministic ScriptedAdapter. */
  mode: "live" | "scripted";
  adapterId: string;
  intent: string;
  prompt: string;
  events: FixtureEvent[];
  /** Present when this run is a fork of another run (additive; 0.1-compatible). */
  fork?: ForkProvenance;
}

export function parseFixture(json: unknown): ReplayFixture {
  const f = json as ReplayFixture;
  if (f?.replayFixture !== "0.1") {
    throw new Error(`unsupported replay fixture version '${String((f as any)?.replayFixture)}'`);
  }
  if (!Array.isArray(f.events)) throw new Error("fixture has no events array");
  return f;
}
