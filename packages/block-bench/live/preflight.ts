/**
 * Preconditions (docs/BLOCKS.md, 1B): the harness probes the deployed Worker
 * before it spends anything, and records what it found with the run.
 *
 * The Worker probe costs no provider call: an empty body is refused with 400
 * by every Worker version, and only the Phase 0.5 Worker reports `calls: []`
 * on that refusal. The build id identifies the deployed artifact (Next's
 * static export names its manifest by build id). Canonical usage and `cause`
 * can only be seen on real replies; the first metered call checks usage,
 * and a 502 is checked for `cause` when one arrives.
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

export async function readBuildId(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const base = baseUrl.replace(/\/+$/, "");
  const res = await fetchImpl(`${base}/`, { headers: { accept: "text/html" } });
  const html = await res.text();
  const match = /_next\/static\/([A-Za-z0-9_-]+)\/_buildManifest\.js/.exec(html);
  return match ? match[1]! : null;
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

export async function preflight(options: { references: readonly LoadedReference[]; baseUrl?: string; fetchImpl?: typeof fetch; clock?: () => string }): Promise<Preflight> {
  const at = (options.clock ?? (() => new Date().toISOString()))();
  const base = { at, ...sidecarSummary(options.references) };
  if (!options.baseUrl) return base;
  const fetchImpl = options.fetchImpl ?? fetch;
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
