/**
 * FM-3: fork a run at a timeline moment. A fork is a NEW run — new id, its
 * own event list (a deep copy of the parent's prefix [0..forkIndex]), and
 * explicit provenance back to the parent. The parent is never mutated; the
 * two runs share history up to the fork point and nothing after.
 *
 * Not every moment is forkable: before any surface has been delivered there
 * is no application state to diverge from, and the fork is rejected with the
 * reason stated rather than producing an empty husk.
 */
import { a2uiMessagesAt } from "./player";
import type { FixtureEvent, ForkProvenance, ReplayFixture } from "./fixture";

export interface ForkSource {
  id: string;
  name: string;
  mode: ReplayFixture["mode"];
  adapterId: string;
  intent: string;
  prompt: string;
  events: FixtureEvent[];
}

export type ForkResult = { ok: true; fixture: ReplayFixture } | { ok: false; reason: string };

/** Why a given playhead cannot be forked, or null when it can. */
export function unforkableReason(source: Pick<ForkSource, "events">, forkIndex: number): string | null {
  if (!Number.isInteger(forkIndex) || forkIndex < 0) return "nothing has happened yet — play or scrub to a moment first";
  if (forkIndex >= source.events.length) return `event ${forkIndex} does not exist in this run`;
  if (a2uiMessagesAt({ events: source.events }, forkIndex).length === 0)
    return "no surface has been delivered at this moment — there is no application state to diverge from yet";
  return null;
}

export function forkFixture(source: ForkSource, forkIndex: number, now: () => Date = () => new Date()): ForkResult {
  const reason = unforkableReason(source, forkIndex);
  if (reason) return { ok: false, reason };

  const fork: ForkProvenance = {
    parentId: source.id,
    parentName: source.name,
    forkIndex,
    forkedAt: now().toISOString(),
  };
  const fixture: ReplayFixture = {
    replayFixture: "0.1",
    id: `${source.id}-fork-${forkIndex}-${Math.random().toString(36).slice(2, 8)}`,
    name: `${source.name} — forked at event ${forkIndex}`,
    recordedAt: fork.forkedAt,
    mode: source.mode,
    adapterId: source.adapterId,
    intent: source.intent,
    prompt: source.prompt,
    // Deep copy: the fork owns its history; appending to it can never
    // reach back into the parent's event objects.
    events: structuredClone(source.events.slice(0, forkIndex + 1)),
    fork,
  };
  return { ok: true, fixture };
}
