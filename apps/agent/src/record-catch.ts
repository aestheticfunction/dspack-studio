/**
 * Record an interactive break-condition catch as a replay fixture: the
 * scenario's authored deterministic start, then the exact bad round-trip
 * Break-it Mode dispatches, answered by the same responders the server
 * uses (and, for resolution, the same resolveAction the browser runs).
 * Deterministic by construction — no model, no network — and labeled so:
 * mode "scripted", adapterId "deterministic:authored".
 *
 *   pnpm --filter agent record:catch -- --condition invalid-state \
 *     --out ../../packages/replay/fixtures/fixture-007.json
 *   pnpm --filter agent record:catch -- --condition ambiguous-action \
 *     --out ../../packages/replay/fixtures/fixture-008.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { a2uiDeliveryEvents, EventType, STUDIO_EVENT, type BaseEvent } from "@dspack-studio/agui-bridge";
import { createRecorder, surfaceComponentsAt } from "@dspack-studio/replay";
import { capabilitiesByScenario, resolveAction } from "@dspack-studio/scenarios";
import { bookingRespond, bookingStartOps } from "./scenarios/appointment-booking.js";
import { recipeRespond, recipeStartOps } from "./scenarios/recipe-creator.js";

function flag(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  console.error(`--${name} is required`);
  process.exit(1);
}

interface Catch {
  scenarioId: string;
  intent: string;
  id: string;
  name: string;
  /** What a live break run would carry as its prompt: the condition label. */
  prompt: string;
  start: () => unknown[];
  respond: (name: string, ctx: Record<string, unknown>) => { outcome: "accepted" | "rejected"; detail?: string; ops: unknown[] };
  /** The exact bad action BreakView's dispatchBadAction sends. */
  action: { name: string; capability?: string; sourceComponentId?: string; context?: Record<string, unknown> };
  /** True to resolve against declared capabilities (the ungroundable case). */
  resolveAgainstSurface: boolean;
}

const CATCHES: Record<string, Catch> = {
  "invalid-state": {
    scenarioId: "recipe-creator",
    intent: "structured-editing",
    id: "fixture-007",
    name: "The agent rejects an invalid edit",
    prompt: "invalid shared-state edit",
    start: recipeStartOps,
    respond: recipeRespond,
    action: { name: "apply_constraint", capability: "apply_constraint", context: { constraint: "keto" } },
    resolveAgainstSurface: false,
  },
  "ambiguous-action": {
    scenarioId: "appointment-booking",
    intent: "scheduling",
    id: "fixture-008",
    name: "An action nothing grounds",
    prompt: "ungroundable generated action",
    start: bookingStartOps,
    respond: bookingRespond,
    action: { name: "mystery_action", sourceComponentId: "intro" },
    resolveAgainstSurface: true,
  },
};

const conditionId = flag("condition");
const out = flag("out");
const spec = CATCHES[conditionId];
if (!spec) {
  console.error(`unknown condition '${conditionId}' (expected: ${Object.keys(CATCHES).join(", ")})`);
  process.exit(1);
}

const recorder = createRecorder({
  id: spec.id,
  name: spec.name,
  mode: "scripted",
  adapterId: "deterministic:authored",
  intent: spec.intent,
  prompt: spec.prompt,
});
const events: Array<Record<string, unknown>> = [];
const rec = (event: BaseEvent | Record<string, unknown>) => {
  recorder.record(event as any);
  events.push(event as Record<string, unknown>);
};
const beat = () => new Promise((r) => setTimeout(r, 300));

// 1) The deterministic interactive start, exactly as the server streams it.
rec({ type: EventType.RUN_STARTED, threadId: "studio", runId: spec.id });
await beat();
for (const e of a2uiDeliveryEvents(spec.start() as Array<Record<string, unknown>>, `${spec.id}-start`)) rec(e);
await beat();
rec({ type: EventType.RUN_FINISHED, threadId: "studio", runId: spec.id });
await beat();

// 2) The bad round-trip, exactly as the browser's dispatchAction records it.
const actionId = randomUUID();
const resolution = spec.resolveAgainstSurface
  ? resolveAction(
      { name: spec.action.name, sourceComponentId: spec.action.sourceComponentId, context: spec.action.context },
      surfaceComponentsAt({ events: events.map((e) => ({ atMs: 0, event: e })) } as any, events.length - 1) as any,
      capabilitiesByScenario[spec.scenarioId] ?? [],
    )
  : ({ ok: true, capability: spec.action.capability!, method: "exact-name", originalName: spec.action.name, context: spec.action.context ?? {} } as const);

if (spec.resolveAgainstSurface && resolution.ok) {
  console.error(`expected the action to resolve to nothing, but it grounded as '${resolution.capability}'; fixture not written`);
  process.exit(5);
}

if (!resolution.ok) {
  rec({
    type: "CUSTOM",
    name: "studio.action.unresolved",
    value: { actionId, originalName: resolution.originalName, reason: resolution.reason, detail: resolution.detail },
  });
  console.log(`resolution rejected client-side (${resolution.reason}): ${resolution.detail}`);
} else {
  rec({
    type: "CUSTOM",
    name: "studio.action.resolved",
    value: { actionId, originalName: resolution.originalName, capability: resolution.capability, method: resolution.method },
  });
  rec({
    type: "CUSTOM",
    name: STUDIO_EVENT.actionPending,
    value: { actionId, scenario: spec.scenarioId, name: spec.action.name, capability: spec.action.capability, context: resolution.context },
  });
  await beat();
  // The agent's answer, from the same responder the /action route calls.
  const response = spec.respond(String(spec.action.capability ?? spec.action.name), resolution.context ?? {});
  if (response.ops.length > 0) {
    for (const e of a2uiDeliveryEvents(response.ops as Array<Record<string, unknown>>, `action-${actionId}`)) rec(e);
  }
  rec({
    type: EventType.CUSTOM,
    name: response.outcome === "accepted" ? STUDIO_EVENT.actionAccepted : STUDIO_EVENT.actionRejected,
    value: { actionId, name: spec.action.name, context: resolution.context, detail: response.detail },
  });
  console.log(`agent responded: ${response.outcome}${response.detail ? ` — ${response.detail}` : ""}`);
  if (response.outcome !== "rejected") {
    console.error("expected a recoverable rejection; fixture not written");
    process.exit(5);
  }
}

const fixture = recorder.finish();
const target = resolve(out);
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(fixture, null, 2) + "\n");
console.log(`fixture (${fixture.events.length} events, mode ${fixture.mode}) -> ${target}`);
