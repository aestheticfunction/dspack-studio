/**
 * The AG-UI agent server (live mode). POST / with a RunAgentInput-shaped body
 * ({ threadId, runId, forwardedProps: { prompt, intent, modelRef } }) streams
 * the governed pipeline as AG-UI SSE — the same events, byte for byte, that
 * the recorder captures into replay fixtures.
 *
 * BYO inference: the server holds no model credentials. modelRef selects a
 * local Ollama model, "scripted" (deterministic), or anthropic:<id> (which
 * requires ANTHROPIC_API_KEY in this process's environment — never accepted
 * from the request).
 */
import { createServer } from "node:http";
import {
  createPipelineEventMapper,
  createSseEncoder,
  runErrorEvent,
  type PipelineEvent,
} from "@dspack-studio/agui-bridge";
import { governedRun } from "./pipeline.js";

const PORT = Number(process.env.PORT ?? 8787);

const server = createServer(async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405, { "content-type": "text/plain" }).end("POST a RunAgentInput");
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);

  let body: any;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    res.writeHead(400, { "content-type": "text/plain" }).end("body must be JSON");
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
    "access-control-allow-origin": "*",
  });

  const map = createPipelineEventMapper({ threadId, runId });
  const onEvent = (event: unknown) => {
    for (const agui of map(event as PipelineEvent)) res.write(encoder.encode(agui));
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
