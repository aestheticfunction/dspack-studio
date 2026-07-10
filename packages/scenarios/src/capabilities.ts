/**
 * Scenario-neutral action resolution: maps a dispatched A2UI action — from a
 * deterministic overlay OR a generated surface with synthesized slugs — onto
 * a scenario CAPABILITY the agent's responder supports.
 *
 * Matching uses explicit, declared semantics only (never bare label
 * heuristics hidden in code): each capability declares exact action names
 * and/or component-grounded matchers that VALIDATE the source component's
 * properties (type + a value validator). Resolution is a pure function of
 * (action, surface components), so it is deterministic during replay, and
 * every decision is recorded in the event stream by the caller
 * (studio.action.resolved / studio.action.unresolved). The generated action
 * identifier is always preserved as provenance.
 */

export interface SurfaceComponentLike {
  id: string;
  component: string;
  label?: unknown;
  variant?: unknown;
  [k: string]: unknown;
}

export interface CapabilityMatcher {
  /** Source component type this matcher grounds on (e.g. "Button"). */
  componentType: string;
  /** Validated semantics: returns context to contribute, or null = no match. */
  semantics: (component: SurfaceComponentLike) => Record<string, unknown> | null;
  /** Human-readable method name recorded in the resolution event. */
  method: string;
}

export interface Capability {
  capability: string;
  /** Exact action names (the deterministic overlay's vocabulary). */
  names?: string[];
  /** Component-grounded matchers for synthesized/generated actions. */
  matchers?: CapabilityMatcher[];
}

export type Resolution =
  | {
      ok: true;
      capability: string;
      /** "exact-name" or the matcher's method — provenance for the event stream. */
      method: string;
      /** Original (possibly synthesized) action identifier, preserved. */
      originalName: string;
      context: Record<string, unknown>;
    }
  | { ok: false; reason: "unsupported" | "ambiguous"; originalName: string; detail: string };

export function resolveAction(
  action: { name: string; sourceComponentId?: string; context?: Record<string, unknown> },
  components: SurfaceComponentLike[],
  capabilities: Capability[],
): Resolution {
  const originalName = action.name;

  // 1) Exact declared names win (deterministic surfaces).
  const exact = capabilities.filter((c) => c.names?.includes(originalName));
  if (exact.length === 1) {
    return { ok: true, capability: exact[0].capability, method: "exact-name", originalName, context: action.context ?? {} };
  }
  if (exact.length > 1) {
    return {
      ok: false,
      reason: "ambiguous",
      originalName,
      detail: `action '${originalName}' is declared by ${exact.length} capabilities: ${exact.map((c) => c.capability).join(", ")}`,
    };
  }

  // 2) Component-grounded semantics (generated surfaces with synthesized slugs).
  const source = components.find((c) => c.id === action.sourceComponentId);
  if (source) {
    const hits: Array<{ capability: string; method: string; context: Record<string, unknown> }> = [];
    for (const cap of capabilities) {
      for (const m of cap.matchers ?? []) {
        if (m.componentType !== source.component) continue;
        const context = m.semantics(source);
        if (context) hits.push({ capability: cap.capability, method: m.method, context });
      }
    }
    if (hits.length === 1) {
      return {
        ok: true,
        capability: hits[0].capability,
        method: hits[0].method,
        originalName,
        context: { ...hits[0].context, ...(action.context ?? {}) },
      };
    }
    if (hits.length > 1) {
      return {
        ok: false,
        reason: "ambiguous",
        originalName,
        detail: `component '${source.id}' matches ${hits.length} capabilities: ${hits.map((h) => h.capability).join(", ")}`,
      };
    }
  }

  return {
    ok: false,
    reason: "unsupported",
    originalName,
    detail: source
      ? `no capability grounds action '${originalName}' from ${source.component} '${source.id}'`
      : `no capability declares '${originalName}' and its source component is unknown`,
  };
}

/** Time-of-day literal, e.g. "9:00" / "14:30" — the validated slot semantic. */
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

/** The appointment-booking capability set (used by client and agent alike). */
export const bookingCapabilities: Capability[] = [
  {
    capability: "select_slot",
    names: ["select_slot"],
    matchers: [
      {
        componentType: "Button",
        method: "semantic:time-labeled-button",
        semantics: (c) => (typeof c.label === "string" && TIME_RE.test(c.label.trim()) ? { slot: c.label.trim() } : null),
      },
    ],
  },
  {
    capability: "confirm_booking",
    names: ["confirm_booking"],
    matchers: [
      {
        componentType: "Button",
        method: "semantic:primary-non-time-button",
        semantics: (c) =>
          c.variant === "primary" && typeof c.label === "string" && !TIME_RE.test(c.label.trim()) ? {} : null,
      },
    ],
  },
  {
    capability: "cancel_booking",
    names: ["cancel_booking"],
    matchers: [
      {
        componentType: "Button",
        method: "semantic:ghost-button",
        semantics: (c) => (c.variant === "ghost" ? {} : null),
      },
    ],
  },
];
