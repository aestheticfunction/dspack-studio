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
import { governedRun } from "./pipeline.js";
import { bookingRespond, bookingStartOps, enhanceGeneratedOps } from "./scenarios/appointment-booking.js";

/** Duplicate-action protection: correlation ids already answered. */
const answeredActions = new Map<string, unknown>();

const PORT = Number(process.env.PORT ?? 8787);
const OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept",
};

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", ...CORS });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const path = (req.url ?? "/").split("?")[0];

  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS).end();
    return;
  }

  if (req.method === "GET" && path === "/") {
    json(res, 200, { ok: true, name: "dspack-studio agent", protocol: "ag-ui" });
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
    json(res, 200, { models });
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

  // HITL action round-trip: a single-turn JSON response of AG-UI events the
  // client appends to its event source (UI event -> agent response, both
  // correlation-id'd; replays reconstruct the whole exchange).
  if (path === "/action") {
    const { scenario, actionId, name, capability, context } = body ?? {};
    if (typeof actionId !== "string" || typeof name !== "string") {
      json(res, 400, { error: "actionId and name are required" });
      return;
    }
    if (answeredActions.has(actionId)) {
      json(res, 200, { duplicate: true, events: answeredActions.get(actionId) });
      return;
    }
    if (scenario !== "appointment-booking") {
      json(res, 404, { error: `no interactive responder for scenario '${String(scenario)}'` });
      return;
    }
    const response = bookingRespond(String(capability ?? name), context ?? {});
    const events: BaseEvent[] = [];
    if (response.ops.length > 0) {
      events.push(...a2uiDeliveryEvents(response.ops as Array<Record<string, unknown>>, `action-${actionId}`));
    }
    events.push({
      type: EventType.CUSTOM,
      name: response.outcome === "accepted" ? STUDIO_EVENT.actionAccepted : STUDIO_EVENT.actionRejected,
      value: { actionId, name, context, detail: response.detail },
    } as BaseEvent);
    answeredActions.set(actionId, events);
    json(res, 200, { events });
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
  if (props.scenario === "appointment-booking" && modelRef === "deterministic:authored") {
    res.write(encoder.encode({ type: EventType.RUN_STARTED, threadId, runId } as BaseEvent));
    for (const e of a2uiDeliveryEvents(bookingStartOps() as Array<Record<string, unknown>>, `${runId}-start`)) {
      res.write(encoder.encode(e));
    }
    res.write(encoder.encode({ type: EventType.RUN_FINISHED, threadId, runId } as BaseEvent));
    res.end();
    return;
  }

  const map = createPipelineEventMapper({ threadId, runId });
  const enhance = props.scenario === "appointment-booking";
  const onEvent = (event: unknown) => {
    for (const agui of map(event as PipelineEvent)) {
      let toWrite: BaseEvent = agui;
      if (enhance && (agui as any).type === EventType.TOOL_CALL_RESULT) {
        try {
          const envelope = JSON.parse((agui as any).content);
          if (Array.isArray(envelope.a2ui_operations)) {
            const { ops, notes } = enhanceGeneratedOps(envelope.a2ui_operations);
            toWrite = { ...(agui as any), content: JSON.stringify({ a2ui_operations: ops }) } as BaseEvent;
            res.write(encoder.encode(toWrite));
            res.write(encoder.encode({ type: EventType.CUSTOM, name: "studio.surface.enhanced", value: { scenario: props.scenario, notes } } as BaseEvent));
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
