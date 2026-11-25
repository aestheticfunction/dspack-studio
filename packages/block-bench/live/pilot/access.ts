/**
 * Access control for the pilot (docs/repositioning/LIVE-PILOT-RUNBOOK.md). Hosted generation is reachable only
 * through a Cloudflare Access application on the Composer hostname's /api path, which admits the pilot's service token;
 * the public site stays open and keeps Demo replay. Before any request that can spend, the pilot checks, with no
 * model call:
 *
 * 1. without the token, /api/propose does not reach the Worker (Access answers instead), so nobody outside the
 *    harness can generate;
 * 2. without the token, /api/models does not offer hosted-ai, so a public visitor is never offered a model it
 *    cannot use;
 * 3. with the token, /api/models offers hosted-ai;
 * 4. with the token, the Worker refuses an empty body before any provider call and reports per-call model attribution
 *    (preflight.ts probeWorker), so every reply can be held to the model it names.
 *
 * Any failure refuses the pilot before it spends anything. The token is read from the environment and never written
 * to a record or a log.
 */
import { PER_CALL_MODEL, probeWorker } from "../preflight";

export interface AccessToken {
  clientId: string;
  clientSecret: string;
}

/** The token from the environment: PILOT_ACCESS_CLIENT_ID and PILOT_ACCESS_CLIENT_SECRET, or undefined. */
export function tokenFromEnv(env: NodeJS.ProcessEnv = process.env): AccessToken | undefined {
  const clientId = env.PILOT_ACCESS_CLIENT_ID?.trim();
  const clientSecret = env.PILOT_ACCESS_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

/** A fetch that adds the Access service-token headers to every request. */
export function withToken(token: AccessToken, fetchImpl: typeof fetch = fetch): typeof fetch {
  return ((input: Parameters<typeof fetch>[0], init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("CF-Access-Client-Id", token.clientId);
    headers.set("CF-Access-Client-Secret", token.clientSecret);
    return fetchImpl(input, { ...init, headers });
  }) as typeof fetch;
}

export interface AccessCheck {
  ok: boolean;
  /** One line per check, safe to print: no token material. */
  lines: string[];
}

/** Whether a response came from the Composer Worker (its JSON shape), rather than from Access in front of it. */
async function fromWorker(res: Response): Promise<{ worker: boolean; body?: Record<string, unknown> }> {
  if (res.status >= 300 && res.status < 400) return { worker: false };
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) return { worker: false };
  try {
    const body = (await res.json()) as Record<string, unknown>;
    return { worker: typeof body === "object" && body !== null && ("capabilities" in body || "models" in body || typeof body.error === "string"), body };
  } catch {
    return { worker: false };
  }
}

export async function checkAccess(baseUrl: string, token: AccessToken | undefined, fetchImpl: typeof fetch = fetch): Promise<AccessCheck> {
  const base = baseUrl.replace(/\/+$/, "");
  const lines: string[] = [];
  let ok = true;
  const fail = (line: string) => {
    ok = false;
    lines.push(`FAIL ${line}`);
  };
  const pass = (line: string) => lines.push(`ok   ${line}`);
  const attempt = async (url: string, init: RequestInit, f: typeof fetch): Promise<Response | undefined> => {
    try {
      return await f(url, { ...init, redirect: "manual" });
    } catch (error) {
      fail(`${init.method ?? "GET"} ${url.replace(base, "")} could not be reached (${error instanceof Error ? error.message : String(error)})`);
      return undefined;
    }
  };

  // 1. Public generation must be closed.
  const publicPropose = await attempt(`${base}/api/propose`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }, fetchImpl);
  if (publicPropose) {
    const seen = await fromWorker(publicPropose);
    if (seen.worker) fail(`without the token, /api/propose reached the Worker (${publicPropose.status}): generation is not restricted to the pilot`);
    else pass(`without the token, /api/propose is answered by Access (${publicPropose.status}), not the Worker`);
  }
  // 2. The public is never offered hosted-ai.
  const publicModels = await attempt(`${base}/api/models`, { method: "GET" }, fetchImpl);
  if (publicModels) {
    const seen = await fromWorker(publicModels);
    const models = Array.isArray(seen.body?.models) ? (seen.body!.models as unknown[]) : [];
    if (seen.worker && models.includes("hosted-ai")) fail("without the token, /api/models offers hosted-ai to the public");
    else pass(`without the token, /api/models offers no hosted model (${seen.worker ? `Worker: ${JSON.stringify(models)}` : `Access: ${publicModels.status}`})`);
  }
  if (!token) {
    fail("no Access service token in PILOT_ACCESS_CLIENT_ID and PILOT_ACCESS_CLIENT_SECRET");
    return { ok, lines };
  }
  const authed = withToken(token, fetchImpl);
  // 3. The pilot is offered hosted-ai.
  const models = await attempt(`${base}/api/models`, { method: "GET" }, authed);
  if (models) {
    const seen = await fromWorker(models);
    const list = Array.isArray(seen.body?.models) ? (seen.body!.models as unknown[]) : [];
    if (seen.worker && list.includes("hosted-ai")) pass("with the token, /api/models offers hosted-ai");
    else fail(`with the token, /api/models does not offer hosted-ai (${seen.worker ? JSON.stringify(list) : `status ${models.status}: the token was not admitted`}); is HOSTED_AI on?`);
  }
  // 4. The Worker reports per-call model attribution (no model call: an empty body is refused first).
  const probe = await probeWorker(base, authed);
  if (probe.shape === PER_CALL_MODEL) pass("with the token, the Worker refuses an empty body before any provider call and reports per-call models");
  else fail(`with the token, the Worker probe answered ${probe.shape}${probe.status ? ` (${probe.status})` : ""}: the pilot needs a Worker that names each call's model`);
  return { ok, lines };
}
