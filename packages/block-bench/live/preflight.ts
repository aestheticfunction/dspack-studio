/**
 * Preconditions (docs/BLOCKS.md, 1B): the harness probes the deployed Worker
 * before it spends anything, and records what it found with the run.
 *
 * The Worker probe costs no provider call: an empty body is refused with 400
 * by every Worker version, and only the Phase 0.5 Worker reports `calls: []`
 * on that refusal. The build id identifies the deployed artifact (Next
 * mints one per build and serves the build's manifest under it). Canonical usage and `cause`
 * can only be seen on real replies; the first metered call checks usage,
 * and a 502 is checked for `cause` when one arrives. A local model is
 * identified by the digest Ollama reports for its tag, so a resume cannot
 * mix two pulls of one tag.
 */
import type { LoadedReference } from "./references";

export interface WorkerProbe {
  shape: "phase-0.5" | "pre-0.5" | "unexpected" | "unreachable";
  status?: number;
  error?: string;
  calls?: unknown;
  detail?: string;
}

export interface Preflight {
  at: string;
  baseUrl?: string;
  buildId?: string | null;
  worker?: WorkerProbe;
  models?: string[] | null;
  /** The local model (Ollama runs): the tag and the digest of the weights behind it. */
  model?: OllamaModel;
  sidecars: Array<{ reference: string; status: string; binding: string; usable: string[]; disabled: Array<{ block: string; issues: string[] }> }>;
  /** Whether any sidecar in use is a draft: results are provisional until the owner approves (ADR-B3). */
  drafts: boolean;
}

export async function probeWorker(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<WorkerProbe> {
  const base = baseUrl.replace(/\/+$/, "");
  let res: Response;
  try {
    res = await fetchImpl(`${base}/api/propose`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  } catch (error) {
    return { shape: "unreachable", detail: error instanceof Error ? error.message : String(error) };
  }
  let body: Record<string, unknown> | undefined;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    return { shape: "unexpected", status: res.status, detail: "the refusal was not JSON" };
  }
  if (res.status !== 400 || body?.error !== "invalid-request") return { shape: "unexpected", status: res.status, error: String(body?.error ?? ""), detail: String(body?.message ?? "") };
  if (Array.isArray(body.calls) && body.calls.length === 0) return { shape: "phase-0.5", status: res.status, error: "invalid-request", calls: body.calls };
  return { shape: "pre-0.5", status: res.status, error: "invalid-request", detail: "the refusal carries no calls list: the Worker predates Phase 0.5 accounting" };
}

/**
 * The deployed build id. The pages router names its build manifest in the HTML; the app router's static export
 * (Composer's) names none and carries the id in its flight payload, as "b". Either way the id counts only when the
 * deployment serves that build's manifest, so a stray match is never recorded as the deployed build.
 */
export async function readBuildId(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const base = baseUrl.replace(/\/+$/, "");
  const res = await fetchImpl(`${base}/`, { headers: { accept: "text/html" } });
  const html = await res.text();
  const match = /_next\/static\/([A-Za-z0-9_-]+)\/_buildManifest\.js/.exec(html) ?? /\\?"b\\?":\\?"([A-Za-z0-9_-]+)\\?"/.exec(html);
  if (!match) return null;
  const id = match[1]!;
  const manifest = await fetchImpl(`${base}/_next/static/${id}/_buildManifest.js`);
  await manifest.arrayBuffer().catch(() => undefined);
  return manifest.ok ? id : null;
}

export async function readModels(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<string[] | null> {
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/api/models`);
    const body = (await res.json()) as { models?: unknown };
    return Array.isArray(body.models) ? body.models.map(String) : null;
  } catch {
    return null;
  }
}

export interface OllamaModel {
  name: string;
  digest: string | null;
  detail?: string;
}

/** The digest Ollama lists for a tag (a bare name means its `latest` tag, as Ollama reads it). */
export async function readOllamaModel(host: string, model: string, fetchImpl: typeof fetch = fetch): Promise<OllamaModel> {
  const name = model.includes(":") ? model : `${model}:latest`;
  try {
    const res = await fetchImpl(`${host.replace(/\/+$/, "")}/api/tags`);
    const body = (await res.json()) as { models?: Array<{ name?: unknown; model?: unknown; digest?: unknown }> };
    const found = (Array.isArray(body.models) ? body.models : []).find((m) => m?.name === name || m?.model === name);
    if (found && typeof found.digest === "string" && found.digest) return { name, digest: found.digest };
    return { name, digest: null, detail: `the host lists no model ${name}` };
  } catch (error) {
    return { name, digest: null, detail: error instanceof Error ? error.message : String(error) };
  }
}

export function sidecarSummary(references: readonly LoadedReference[]): Pick<Preflight, "sidecars" | "drafts"> {
  const sidecars = references.map((r) => ({
    reference: r.id,
    status: r.sidecar?.status ?? "invalid",
    binding: r.binding,
    usable: r.blocks.map((b) => `${b.id}@${b.version}${b.status === "draft" ? " (draft)" : ""}`),
    disabled: r.disabled,
  }));
  return { sidecars, drafts: references.some((r) => r.sidecar?.status !== "approved" || r.blocks.some((b) => b.status !== "approved")) };
}

export async function preflight(options: {
  references: readonly LoadedReference[];
  baseUrl?: string;
  ollama?: { host: string; model: string };
  fetchImpl?: typeof fetch;
  clock?: () => string;
}): Promise<Preflight> {
  const at = (options.clock ?? (() => new Date().toISOString()))();
  const base = { at, ...sidecarSummary(options.references) };
  const fetchImpl = options.fetchImpl ?? fetch;
  if (options.ollama) return { ...base, model: await readOllamaModel(options.ollama.host, options.ollama.model, fetchImpl) };
  if (!options.baseUrl) return base;
  const worker = await probeWorker(options.baseUrl, fetchImpl);
  let buildId: string | null = null;
  try {
    buildId = await readBuildId(options.baseUrl, fetchImpl);
  } catch {
    buildId = null;
  }
  const models = await readModels(options.baseUrl, fetchImpl);
  return { ...base, baseUrl: options.baseUrl, buildId, worker, models };
}
