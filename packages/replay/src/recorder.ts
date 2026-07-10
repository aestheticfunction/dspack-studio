/**
 * Recorder: capture an AG-UI event stream (any source — the agent server's
 * mapper output, or a client-side AgentSubscriber) into a versioned fixture
 * with real timings.
 */
import type { FixtureEvent, ReplayFixture } from "./fixture";

export interface RecorderMeta {
  id: string;
  name: string;
  mode: ReplayFixture["mode"];
  adapterId: string;
  intent: string;
  prompt: string;
  now?: () => number;
}

export interface Recorder {
  record(event: Record<string, unknown> & { type: string }): void;
  finish(): ReplayFixture;
}

export function createRecorder(meta: RecorderMeta): Recorder {
  const now = meta.now ?? (() => Date.now());
  const t0 = now();
  const events: FixtureEvent[] = [];
  return {
    record(event) {
      events.push({ atMs: now() - t0, event: structuredClone(event) });
    },
    finish() {
      return {
        replayFixture: "0.1",
        id: meta.id,
        name: meta.name,
        recordedAt: new Date().toISOString(),
        mode: meta.mode,
        adapterId: meta.adapterId,
        intent: meta.intent,
        prompt: meta.prompt,
        events,
      };
    },
  };
}
