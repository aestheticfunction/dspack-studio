/**
 * The AG-UI agent server (live mode).
 *
 *   POST /        RunAgentInput ({ threadId, runId, forwardedProps:
 *                 { prompt, intent, modelRef } }) -> AG-UI SSE of the
 *                 governed pipeline — the same events, byte for byte, that
 *                 the recorder captures into replay fixtures.
 *   GET  /        health: { ok, name, version }
 *   GET  /models  available model refs: "scripted" + local Ollama models.
 *
 * BYO inference: the server holds no model credentials in code and accepts
 * none from requests. modelRef selects a local Ollama model, "scripted"
 * (deterministic), or anthropic:<id> — which requires ANTHROPIC_API_KEY in
 * this process's environment, never from the browser.
 */
import { createServer, type ServerResponse } from "node:http";
import {
  a2uiDeliveryEvents,
  createPipelineEventMapper,
  createSseEncoder,
  runErrorEvent,
  EventType,
  STUDIO_EVENT,
  type BaseEvent,
  type PipelineEvent,
} from "@dspack-studio/agui-bridge";
import { governedQuestion, governedRun } from "./pipeline.js";
import { handleProjectRoute } from "./project.js";
import {
  bookingRespond,
  bookingStartOps,
  enhanceGeneratedOps,
  enhanceQuestionOps,
  resetBookingSession,
} from "./scenarios/appointment-booking.js";
import { enhanceGeneratedRecipeOps, recipeRespond, recipeStartOps, resetRecipeSessions, restoreRecipeGrounding } from "./scenarios/recipe-creator.js";

/** Scenario registry: start ops + HITL responders (scenario-neutral shell). */
interface ScenarioEntry {
  start: () => unknown[];
  respond: (name: string, ctx: Record<string, unknown>) => { outcome: "accepted" | "rejected"; detail?: string; ops: unknown[] };
  enhance?: (ops: any[]) => { ops: any[]; notes: string[]; grounding?: unknown };
  /** FM-3: wipe scenario state before a fork rebuilds it (omit if stateless). */
  reset?: () => void;
  /** FM-3: restore grounded update targets recorded in a prefix's enhanced event. */
  restoreGrounding?: (grounding: unknown) => void;
}
const SCENARIOS: Record<string, ScenarioEntry> = {
  "appointment-booking": { start: bookingStartOps, respond: bookingRespond, enhance: enhanceGeneratedOps, reset: resetBookingSession },
  "recipe-creator": {
    start: recipeStartOps,
    respond: recipeRespond,
    enhance: enhanceGeneratedRecipeOps,
    reset: resetRecipeSessions,
    restoreGrounding: restoreRecipeGrounding,
  },
};

/** Duplicate-action protection: correlation ids already answered. */
const answeredActions = new Map<string, unknown>();

/**
 * FM-7: run the agent's HITL question through the ORDINARY pipeline and map
 * it into this exchange's events. Run lifecycle events are stripped (the
 * question is a segment of an ongoing session); everything else — STEP,
 * dspack.gates/repair/emit/audit, the tool-call delivery — rides verbatim,
 * so the gate ticker and inspectors show the question's own governance.
 *
 * modelRef "ollama:*" generates the question live; grounding is
 * unambiguous-only (enhanceQuestionOps), and an ungroundable or undelivered
 * generation falls back to the authored question through the SAME pipeline,
 * with the fallback stated in the stream. The scripted path grounds by
 * construction.
 */
async function questionPipelineEvents(
  q: { surface: unknown; prompt: string },
  modelRef: string | undefined,
  ctx: { actionId: string; slot: string; name: string },
): Promise<BaseEvent[]> {
  const LIFECYCLE = new Set<string>([EventType.RUN_STARTED, EventType.RUN_FINISHED]);
  const TOOL_CALL = new Set<string>([
    EventType.TOOL_CALL_START,
    EventType.TOOL_CALL_ARGS,
    EventType.TOOL_CALL_END,
    EventType.TOOL_CALL_RESULT,
  ]);

  const attempt = async (ref: string | undefined, tag: string): Promise<{ events: BaseEvent[]; grounded: boolean; reason?: string }> => {
    const buffer: BaseEvent[] = [];
    const map = createPipelineEventMapper({ threadId: `action-${ctx.actionId}`, runId: `question-${ctx.actionId}${tag}` });
    try {
      await governedQuestion({ surface: q.surface, prompt: q.prompt, modelRef: ref, onEvent: (pe) => {
        for (const e of map(pe as PipelineEvent)) buffer.push(e);
      } });
    } catch (error) {
      return { events: [], grounded: false, reason: error instanceof Error ? error.message : String(error) };
    }
    const inner = buffer.filter((e) => !LIFECYCLE.has((e as any).type));
    const resultIdx = inner.findIndex((e) => (e as any).type === EventType.TOOL_CALL_RESULT);
    if (resultIdx === -1) {
      return { events: inner, grounded: false, reason: "the pipeline shipped no question surface (refusal or exhausted repairs)" };
    }
    let envelope: { a2ui_operations?: unknown[] };
    try {
      envelope = JSON.parse((inner[resultIdx] as any).content);
    } catch {
      return { events: inner, grounded: false, reason: "the delivery envelope did not parse" };
    }
    const enhanced = enhanceQuestionOps((envelope.a2ui_operations ?? []) as any[], ctx.slot, ctx.name);
    if (!enhanced.ok) {
      // An inert question would dead-end the human: keep the gates on the
      // record, drop only the ungroundable delivery.
      return { events: inner.filter((e) => !TOOL_CALL.has((e as any).type)), grounded: false, reason: enhanced.reason };
    }
    inner[resultIdx] = { ...(inner[resultIdx] as any), content: JSON.stringify({ a2ui_operations: enhanced.ops }) } as BaseEvent;
    inner.splice(resultIdx + 1, 0, {
      type: EventType.CUSTOM,
      name: "studio.surface.enhanced",
      value: { scenario: "appointment-booking", notes: enhanced.notes },
    } as BaseEvent);
    return { events: inner, grounded: true };
  };

  const live = modelRef?.startsWith("ollama:") ? modelRef : undefined;
  if (live) {
    const first = await attempt(live, "");
    if (first.grounded) return first.events;
    const note = {
      type: EventType.CUSTOM,
      name: "studio.question.fallback",
      value: {
        reason: first.reason,
        from: live,
        to: "the authored question, played through the same pipeline (scripted)",
      },
    } as BaseEvent;
    const second = await attempt(undefined, "-fallback");
    return [...first.events, note, ...second.events];
  }
  const only = await attempt(undefined, "");
  if (!only.grounded) {
    // The authored surface grounds by construction; reaching here means a
    // real defect — fail loudly in the stream rather than dead-ending.
    return [
      ...only.events,
      { type: EventType.CUSTOM, name: "studio.question.fallback", value: { reason: only.reason, from: "scripted", to: "none: the question could not be asked" } } as BaseEvent,
    ];
  }
  return only.events;
}

const PORT = Number(process.env.PORT ?? 8787);
const OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";

/** Comma-separated allowlist; "*" (the local-dev default) allows any origin. */
const ALLOWED_ORIGINS = (process.env.AGENT_ALLOWED_ORIGINS ?? "*").split(",").map((o) => o.trim());

function corsFor(origin: string | undefined): Record<string, string> {
  const allow = ALLOWED_ORIGINS.includes("*")
    ? "*"
    : origin && ALLOWED_ORIGINS.includes(origin)
      ? origin
      : ALLOWED_ORIGINS[0] ?? "";
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, accept",
    vary: "origin",
  };
}

function json(res: ServerResponse, status: number, body: unknown, cors: Record<string, string> = corsFor(undefined)): void {
  res.writeHead(status, { "content-type": "application/json", ...cors });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const path = (req.url ?? "/").split("?")[0];
  const CORS = corsFor(req.headers.origin);

  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS).end();
    return;
  }

  if (req.method === "GET" && path === "/") {
    json(res, 200, { ok: true, name: "dspack-studio agent", protocol: "ag-ui" }, CORS);
    return;
  }

  if (req.method === "GET" && path === "/models") {
    const models: string[] = ["scripted"];
    try {
      const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(1500) });
      const tags = (await r.json()) as { models?: Array<{ name: string }> };
      for (const m of tags.models ?? []) {
        if (!m.name.includes("embedding") && !m.name.includes("flux")) models.push(`ollama:${m.name}`);
      }
    } catch {
      // Ollama offline: scripted mode still works.
    }
    json(res, 200, { models }, CORS);
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { "content-type": "text/plain", ...CORS }).end("POST a RunAgentInput");
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);

  let body: any;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    res.writeHead(400, { "content-type": "text/plain", ...CORS }).end("body must be JSON");
    return;
  }

  // Composer project routes (connect/discover/emit/validate/save/run) — thin
  // orchestration over published packages against a local project directory.
  if (await handleProjectRoute(path, body ?? {}, res, CORS, req.headers.accept, json)) return;

  // FM-3 deterministic continuation: rebuild the scenario's state from a
  // fork's event prefix — reset, restore recorded grounding, then replay
  // the prefix's ACCEPTED actions through the same responders. Nothing is
  // invented: if a replayed action no longer produces "accepted", the fork
  // is refused with the divergence named.
  if (path === "/fork") {
    const { scenario, events } = body ?? {};
    const responder = SCENARIOS[String(scenario)];
    if (!responder) {
      json(res, 404, { error: `no interactive responder for scenario '${String(scenario)}'` }, CORS);
      return;
    }
    if (!Array.isArray(events)) {
      json(res, 400, { error: "events (the fork's prefix) are required" }, CORS);
      return;
    }
    responder.reset?.();
    const pendings = new Map<string, { name?: string; capability?: string; context?: Record<string, unknown> }>();
    let replayed = 0;
    for (const wrapped of events) {
      const ev = wrapped?.event ?? wrapped;
      if (ev?.type !== "CUSTOM") continue;
      if (ev.name === "studio.surface.enhanced") responder.restoreGrounding?.(ev.value?.grounding);
      if (ev.name === STUDIO_EVENT.actionPending && ev.value?.actionId) pendings.set(String(ev.value.actionId), ev.value);
      if (ev.name === STUDIO_EVENT.actionAccepted && ev.value?.actionId) {
        const p = pendings.get(String(ev.value.actionId));
        if (!p) continue;
        const outcome = responder.respond(String(p.capability ?? p.name), p.context ?? {});
        if (outcome.outcome !== "accepted") {
          json(res, 409, { error: `replaying '${String(p.capability ?? p.name)}' diverged: ${outcome.detail ?? outcome.outcome}`, replayed }, CORS);
          return;
        }
        replayed++;
      }
    }
    json(res, 200, { ok: true, replayed }, CORS);
    return;
  }

  // HITL action round-trip: a single-turn JSON response of AG-UI events the
  // client appends to its event source (UI event -> agent response, both
  // correlation-id'd; replays reconstruct the whole exchange).
  if (path === "/action") {
    const { scenario, actionId, name, capability, context, modelRef } = body ?? {};
    if (typeof actionId !== "string" || typeof name !== "string") {
      json(res, 400, { error: "actionId and name are required" }, CORS);
      return;
    }
    if (answeredActions.has(actionId)) {
      json(res, 200, { duplicate: true, events: answeredActions.get(actionId) }, CORS);
      return;
    }
    const responder = SCENARIOS[String(scenario)];
    if (!responder) {
      json(res, 404, { error: `no interactive responder for scenario '${String(scenario)}'` }, CORS);
      return;
    }
    const response = responder.respond(String(capability ?? name), context ?? {});
    const events: BaseEvent[] = [];
    if (response.ops.length > 0) {
      events.push(...a2uiDeliveryEvents(response.ops as Array<Record<string, unknown>>, `action-${actionId}`));
    }
    events.push({
      type: EventType.CUSTOM,
      name: response.outcome === "accepted" ? STUDIO_EVENT.actionAccepted : STUDIO_EVENT.actionRejected,
      value: { actionId, name, context, detail: response.detail },
    } as BaseEvent);
    // FM-7: the agent's follow-up question is a REAL pipeline run — gates,
    // emission, audit — appended to this exchange, never synthesized.
    if (response.outcome === "accepted" && (response as any).question) {
      const q = (response as any).question as { surface: unknown; prompt: string };
      events.push(
        ...(await questionPipelineEvents(q, typeof modelRef === "string" ? modelRef : undefined, {
          actionId,
          slot: String((context as any)?.slot ?? ""),
          name: String((context as any)?.name ?? ""),
        })),
      );
    }
    answeredActions.set(actionId, events);
    json(res, 200, { events }, CORS);
    return;
  }

  const threadId = String(body.threadId ?? "thread");
  const runId = String(body.runId ?? `run-${Date.now()}`);
  const props = body.forwardedProps ?? {};
  const prompt = String(props.prompt ?? body.messages?.at(-1)?.content ?? "");
  const intent = String(props.intent ?? "destructive-action");
  const modelRef = String(props.modelRef ?? "scripted");

  const encoder = createSseEncoder(req.headers.accept);
  res.writeHead(200, {
    "content-type": encoder.contentType,
    "cache-control": "no-cache",
    connection: "keep-alive",
    ...CORS,
  });

  // Deterministic interactive-scenario start: the authored, contract-emitted
  // surface plus its interaction overlay, streamed as a normal run.
  if (SCENARIOS[String(props.scenario)] && modelRef === "deterministic:authored") {
    res.write(encoder.encode({ type: EventType.RUN_STARTED, threadId, runId } as BaseEvent));
    for (const e of a2uiDeliveryEvents(SCENARIOS[String(props.scenario)].start() as Array<Record<string, unknown>>, `${runId}-start`)) {
      res.write(encoder.encode(e));
    }
    res.write(encoder.encode({ type: EventType.RUN_FINISHED, threadId, runId } as BaseEvent));
    res.end();
    return;
  }

  const map = createPipelineEventMapper({ threadId, runId });
  const enhancer = SCENARIOS[String(props.scenario)]?.enhance;
  const onEvent = (event: unknown) => {
    for (const agui of map(event as PipelineEvent)) {
      let toWrite: BaseEvent = agui;
      if (enhancer && (agui as any).type === EventType.TOOL_CALL_RESULT) {
        try {
          const envelope = JSON.parse((agui as any).content);
          if (Array.isArray(envelope.a2ui_operations)) {
            const { ops, notes, grounding } = enhancer(envelope.a2ui_operations);
            toWrite = { ...(agui as any), content: JSON.stringify({ a2ui_operations: ops }) } as BaseEvent;
            res.write(encoder.encode(toWrite));
            // grounding rides the stream so forks can rebuild it (FM-3).
            res.write(encoder.encode({ type: EventType.CUSTOM, name: "studio.surface.enhanced", value: { scenario: props.scenario, notes, grounding } } as BaseEvent));
            continue;
          }
        } catch { /* not an ops envelope */ }
      }
      res.write(encoder.encode(toWrite));
    }
  };

  try {
    await governedRun({ prompt, intent, modelRef, onEvent });
  } catch (error) {
    res.write(encoder.encode(runErrorEvent(error instanceof Error ? error.message : String(error))));
  }
  res.end();
});

server.listen(PORT, () => {
  console.log(`dspack-studio agent listening on http://localhost:${PORT} (AG-UI SSE)`);
});
