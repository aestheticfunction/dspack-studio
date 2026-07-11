"use client";

/**
 * The guided tour, keyed to fixture-001 (a recorded real run). Every step
 * IS a real UI state: the tour drives the same deep-link mechanism the
 * permalinks use, so nothing is simulated and nothing is overlaid on top
 * of behavior that does not exist. No animation is involved (steps jump,
 * they never auto-play), so reduced-motion preferences are respected by
 * construction. The bar never traps focus and never blocks exploration.
 */
import type { PermalinkState } from "./permalink";

export interface TourStep {
  title: string;
  body: string;
  state: PermalinkState;
}

export const TOUR_STEPS: TourStep[] = [
  {
    title: "The interface argues back",
    body:
      "You are looking at a real recorded run. At this moment the model asked for a one-click delete and the design system said no: the red tick is a failed gate, with the rule and its written rationale on the record.",
    state: { scenario: "project-deletion", fixture: "argues-back", event: 3 },
  },
  {
    title: "Time travel",
    body:
      "Two governed repairs later, the surface ships. Drag the timeline backward and the interface un-builds, event by event. Any frame you stop on is a real, coherent application state.",
    state: { scenario: "project-deletion", fixture: "argues-back", event: 17 },
  },
  {
    title: "X-ray: pixels to protocol",
    body:
      "X-ray is on. Click any rendered element to trace it: the event that created it, the catalog entry that admitted it, and the rules that concern its component type.",
    state: { scenario: "project-deletion", fixture: "argues-back", event: 17, xray: true },
  },
  {
    title: "The receipt",
    body:
      "Every run ends with its evidence: attempts, findings, repairs, gates, and a canonical hash. Download the receipt, then verify it against any replay of this recording.",
    state: { scenario: "project-deletion", fixture: "argues-back", event: 19, panel: "receipt" },
  },
];

export function TourBar({
  step,
  onStep,
  onDone,
}: {
  step: number;
  onStep: (n: number) => void;
  onDone: () => void;
}) {
  const s = TOUR_STEPS[step];
  if (!s) return null;
  const btn: React.CSSProperties = { padding: "5px 12px", borderRadius: 8, border: "1px solid #94a3b8", background: "transparent", color: "inherit", cursor: "pointer", font: "inherit" };
  return (
    <aside
      data-testid="tour-bar"
      role="region"
      aria-label={`guided tour, step ${step + 1} of ${TOUR_STEPS.length}`}
      style={{
        position: "sticky",
        bottom: 12,
        marginTop: 16,
        background: "#0f172a",
        color: "#f8fafc",
        borderRadius: 12,
        padding: "12px 16px",
        display: "flex",
        gap: 14,
        alignItems: "baseline",
        flexWrap: "wrap",
        boxShadow: "0 6px 24px rgba(15,23,42,0.35)",
      }}
    >
      <strong data-testid="tour-title">
        {step + 1}/{TOUR_STEPS.length} · {s.title}
      </strong>
      <span style={{ flex: "1 1 260px", fontSize: 13, lineHeight: 1.5 }}>{s.body}</span>
      <span style={{ display: "flex", gap: 8 }}>
        {step > 0 && (
          <button style={btn} data-testid="tour-back" onClick={() => onStep(step - 1)}>
            back
          </button>
        )}
        {step < TOUR_STEPS.length - 1 ? (
          <button style={{ ...btn, background: "#f8fafc", color: "#0f172a" }} data-testid="tour-next" onClick={() => onStep(step + 1)}>
            next
          </button>
        ) : (
          <button style={{ ...btn, background: "#f8fafc", color: "#0f172a" }} data-testid="tour-finish" onClick={onDone}>
            explore on your own
          </button>
        )}
        <button style={btn} data-testid="tour-skip" onClick={onDone} aria-label="dismiss the tour">
          skip
        </button>
      </span>
    </aside>
  );
}
