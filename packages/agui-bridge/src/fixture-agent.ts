/**
 * FixtureAgent: an AG-UI AbstractAgent that replays a recorded run — the
 * replay-mode backend. The browser instantiates it with a fixture (recorded
 * real events + original timings) and gets the identical event stream a live
 * agent produced, through the identical AgentSubscriber path. Replay and live
 * are the same pixels because they are the same protocol.
 */
import { Observable } from "rxjs";
import { AbstractAgent } from "@ag-ui/client";
import { EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/core";

export interface FixtureEventEntry {
  /** Milliseconds since RUN start when the event was recorded. */
  atMs: number;
  event: Record<string, unknown>;
}

export interface ReplayFixtureLike {
  replayFixture: string;
  events: FixtureEventEntry[];
}

export interface FixtureAgentOptions {
  /** Playback speed multiplier (1 = recorded timing, 0 = instant). */
  speed?: number;
  /** Cap on any single inter-event gap, ms (keeps long model pauses watchable). */
  maxGapMs?: number;
}

export class FixtureAgent extends AbstractAgent {
  constructor(
    private readonly fixture: ReplayFixtureLike,
    private readonly options: FixtureAgentOptions = {},
  ) {
    super({ description: "dspack-studio replay agent (recorded run playback)" });
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    const { speed = 1, maxGapMs = 4000 } = this.options;
    return new Observable<BaseEvent>((subscriber) => {
      const timers: ReturnType<typeof setTimeout>[] = [];
      let clock = 0;
      let prevAt = 0;

      for (const entry of this.fixture.events) {
        const gap = Math.min(Math.max(entry.atMs - prevAt, 0), maxGapMs);
        prevAt = entry.atMs;
        clock += speed === 0 ? 0 : gap / speed;

        const event = { ...entry.event } as Record<string, unknown>;
        // Re-stamp run identity so the replayed stream belongs to THIS run.
        if (event.type === EventType.RUN_STARTED || event.type === EventType.RUN_FINISHED) {
          event.threadId = input.threadId;
          event.runId = input.runId;
        }
        timers.push(
          setTimeout(() => {
            subscriber.next(event as BaseEvent);
            if (event.type === EventType.RUN_FINISHED || event.type === EventType.RUN_ERROR) {
              subscriber.complete();
            }
          }, clock),
        );
      }

      if (this.fixture.events.length === 0) subscriber.complete();
      return () => timers.forEach(clearTimeout);
    });
  }
}
