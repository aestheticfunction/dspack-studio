"use client";

/**
 * FM-9, the wire itself: the actual open-protocol session, event by event.
 * Raw ordered AG-UI events with expandable JSON, the real content types,
 * and an honest protobuf re-encoding of the same events. Recorded fixtures
 * are JSON event documents and the local agent's default transport is SSE
 * JSON; the protobuf bytes are labeled as a re-encoded VIEW, never claimed
 * as the original transport. This is everything. There is no other channel.
 */
import { useMemo, useState } from "react";
import { encodeEventBinary } from "@dspack-studio/agui-bridge";
import type { FixtureEvent } from "@dspack-studio/replay";

const hex = (bytes: Uint8Array, max = 64): string =>
  [...bytes.slice(0, max)].map((b) => b.toString(16).padStart(2, "0")).join(" ") + (bytes.length > max ? ` … (${bytes.length} bytes)` : "");

export function TheWire({ events, playhead, live, defaultOpen }: { events: FixtureEvent[]; playhead: number; live?: boolean; defaultOpen?: boolean }) {
  const [encoding, setEncoding] = useState<"json" | "proto">("json");

  const protoFrames = useMemo(() => {
    if (encoding !== "proto") return [];
    return events.map((e) => {
      try {
        return hex(encodeEventBinary(e.event as any));
      } catch (err) {
        return `(this event has no protobuf projection: ${err instanceof Error ? err.message : String(err)})`;
      }
    });
  }, [encoding, events]);

  return (
    <details data-testid="the-wire" ref={(el) => { if (el && defaultOpen && !el.dataset.autoOpened) { el.open = true; el.dataset.autoOpened = "1"; } }} style={{ marginTop: 12, fontSize: 12 }}>
      <summary style={{ cursor: "pointer" }}>the wire — the raw protocol session ({events.length} AG-UI events)</summary>
      <div style={{ border: "1px solid #cbd5e1", borderRadius: 12, padding: "12px 14px", marginTop: 8, display: "grid", gap: 8 }}>
        <p style={{ margin: 0 }} data-testid="wire-transport">
          {live
            ? "Live transport: "
            : "This session is a recorded fixture (a JSON event document); its live transport was "}
          <code>text/event-stream</code> carrying AG-UI events as SSE JSON. A2UI operations ride{" "}
          <code>generate_a2ui</code> tool-call results. This is everything; there is no other channel.
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }} role="group" aria-label="wire encoding">
          <button
            data-testid="wire-encoding-json"
            aria-pressed={encoding === "json"}
            onClick={() => setEncoding("json")}
            style={{ padding: "3px 10px", borderRadius: 6, border: "1px solid #cbd5e1", background: encoding === "json" ? "#0f172a" : "transparent", color: encoding === "json" ? "#fff" : "inherit", cursor: "pointer", font: "inherit" }}
          >
            JSON
          </button>
          <button
            data-testid="wire-encoding-proto"
            aria-pressed={encoding === "proto"}
            onClick={() => setEncoding("proto")}
            style={{ padding: "3px 10px", borderRadius: 6, border: "1px solid #cbd5e1", background: encoding === "proto" ? "#0f172a" : "transparent", color: encoding === "proto" ? "#fff" : "inherit", cursor: "pointer", font: "inherit" }}
          >
            protobuf
          </button>
          {encoding === "proto" && (
            <em data-testid="wire-proto-label">
              re-encoded view: the same events as <code>application/vnd.ag-ui.event+proto</code> frames; the original
              was SSE JSON
            </em>
          )}
        </div>
        <ol
          data-testid="wire-events"
          tabIndex={0}
          aria-label="raw AG-UI events"
          style={{ margin: 0, paddingLeft: 0, listStyle: "none", maxHeight: 320, overflow: "auto", display: "grid", gap: 2, fontFamily: "ui-monospace, monospace" }}
        >
          {events.map((e, i) => (
            <li key={i} style={{ background: i === playhead ? "rgba(139,92,246,0.14)" : undefined, borderRadius: 6 }}>
              <details>
                <summary style={{ cursor: "pointer", padding: "2px 6px" }}>
                  <span style={{ opacity: 0.55 }}>{String(i).padStart(3, " ")}</span> {String((e.event as any).type)}
                  {(e.event as any).name ? ` ${String((e.event as any).name)}` : ""} <span style={{ opacity: 0.55 }}>@{e.atMs}ms</span>
                </summary>
                {encoding === "json" ? (
                  <pre tabIndex={0} aria-label={`event ${i} JSON`} style={{ margin: "2px 0 6px", padding: 8, background: "rgba(148,163,184,0.12)", borderRadius: 6, overflow: "auto", maxHeight: 200, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {JSON.stringify(e.event, null, 2)}
                  </pre>
                ) : (
                  <pre tabIndex={0} aria-label={`event ${i} protobuf frame (re-encoded)`} style={{ margin: "2px 0 6px", padding: 8, background: "rgba(148,163,184,0.12)", borderRadius: 6, overflow: "auto", maxHeight: 200, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                    {protoFrames[i]}
                  </pre>
                )}
              </details>
            </li>
          ))}
        </ol>
      </div>
    </details>
  );
}
