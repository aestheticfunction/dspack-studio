/**
 * A fixture LOCAL PROVIDER for the Settings suite.
 *
 * "Local AI" in Composer means *any* OpenAI-compatible server or Ollama on the
 * user's own machine, reached through the local agent. This is one such server:
 * a real HTTP endpoint speaking the two discovery protocols the agent actually
 * probes, so `POST /provider/test` runs its real code against a real socket.
 *
 * It deliberately does NOT generate. Provider *configuration* — reach the
 * endpoint, discover the models, choose one, carry a credential — is what
 * Settings owns and what the specs drive. Generation is a model call, and no
 * spec makes one.
 *
 *   GET /api/tags        Ollama discovery. Includes one embedding model, which
 *                        the agent is expected to filter out.
 *   GET /v1/models       OpenAI-compatible discovery, two models.
 *   GET /silent/models   404 — "reachable, but doesn't enumerate": the agent
 *                        reports ok with an empty list and the UI falls back to
 *                        manual model entry.
 *   GET /keyed/models    401 without the exact expected credential, one model
 *                        with it. Proves a key typed in the browser reached the
 *                        provider THROUGH the agent — the only path it may take.
 */
import { createServer } from "node:http";

const port = Number(process.env.PROVIDER_FIXTURE_PORT ?? 3314);

/** Must match FIXTURE_KEY in e2e/composer-settings.spec.ts. */
const EXPECTED_KEY = "sk-fixture-credential-0123456789";

const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  const path = (req.url ?? "/").split("?")[0];

  if (path === "/api/tags") {
    return send(res, 200, {
      models: [{ name: "fixture-small:1b" }, { name: "fixture-coder:7b" }, { name: "fixture-embedding:latest" }],
    });
  }
  if (path === "/v1/models") {
    return send(res, 200, { object: "list", data: [{ id: "fixture-openai-a" }, { id: "fixture-openai-b" }] });
  }
  if (path === "/silent/models") {
    return send(res, 404, { error: "this server does not enumerate models" });
  }
  if (path === "/keyed/models") {
    const auth = req.headers.authorization ?? "";
    if (auth !== `Bearer ${EXPECTED_KEY}`) return send(res, 401, { error: "missing or wrong credential" });
    return send(res, 200, { object: "list", data: [{ id: "credentialed-model" }] });
  }
  return send(res, 404, { error: "not found" });
}).listen(port, () => console.log(`provider fixture on http://localhost:${port}`));
