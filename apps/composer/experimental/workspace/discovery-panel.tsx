"use client";

/**
 * What a local agent can discover (experimental): the designer's view of `discovery.ts`. Human-readable first,
 * with the machine-readable answer one disclosure deeper. Every list is evaluated on request from the
 * authorization authority, never from what the interface last showed.
 */
import { useEffect, useState } from "react";
import { discover, resolve, type CompositionReference, type DiscoveryContext, type DiscoveryResult, type Resolution } from "./discovery";

const short = (sha: string) => `${sha.slice(0, 8)}…`;

export type LastResolution = { ref: CompositionReference; title: string; resolution: Resolution } | null;

export function DiscoveryPanel({ context, revision, open, last, setLast }: { context: () => DiscoveryContext | null; revision: unknown; open: (composition: string, version: number) => void; last: LastResolution; setLast: (l: LastResolution) => void }) {
  const [result, setResult] = useState<DiscoveryResult | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const ctx = context();
    if (!ctx) return;
    setBusy(true);
    setResult(await discover(ctx));
    setBusy(false);
  };
  useEffect(() => void refresh(), [revision]);

  /** Resolve an exact reference as a local agent would: with the composition's first example, synthetic. */
  const run = async (ref: CompositionReference, title: string) => {
    const ctx = context();
    if (!ctx) return;
    const def = ctx.loaded.library.get(ref.composition, ref.version);
    const example = def?.scenarios.find((s) => s.expect === "ok");
    const resolution = await resolve(ctx, ref, { data: (example?.data ?? {}) as Record<string, unknown>, ...(example?.state ? { state: example.state } : {}) });
    setLast({ ref, title, resolution });
    await refresh();
  };

  if (!result) return <p className="cl-dim">Asking what a local agent can discover…</p>;
  return (
    <section className="cl-discovery" aria-labelledby="cl-discovery-title" data-testid="discovery" data-generation={result.authorizationGeneration}>
      <h3 className="cl-label" id="cl-discovery-title">
        What a local agent can discover
      </h3>
      <p className="cl-dim">Evaluated now, from this device's approvals, each time it is asked. Not published: no external agent can see any of this.</p>
      <button className="cl-tool" onClick={() => void refresh()} disabled={busy} data-testid="discovery-refresh">
        {busy ? "Checking…" : "Ask again"}
      </button>

      <h4 className="cl-discovery__heading">Eligible for local agent evaluation ({result.eligible.length})</h4>
      {result.eligible.length === 0 ? (
        <p className="cl-dim" data-testid="discovery-none">
          Nothing is eligible now.
        </p>
      ) : (
        <ul className="cl-discovery__list">
          {result.eligible.map((e) => (
            <li key={`${e.reference.composition}@${e.reference.version}`} className="cl-discovery__item cl-discovery__item--ok" data-testid={`discovery-eligible-${e.reference.composition}-${e.reference.version}`}>
              <span className="cl-item__name">
                {e.title} <span className="cl-badge cl-badge--ok">v{e.reference.version}</span>
              </span>
              <span className="cl-dim">Exact approved version available · not published</span>
              <span className="cl-discovery__actions">
                <button className="cl-tool" onClick={() => void run(e.reference, e.title)} data-testid={`discovery-resolve-${e.reference.composition}-${e.reference.version}`}>
                  Resolve as a local agent
                </button>
                <button className="cl-link" onClick={() => open(e.reference.composition, e.reference.version)}>
                  Open
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <h4 className="cl-discovery__heading">Not eligible ({result.excluded.length})</h4>
      <ul className="cl-discovery__list">
        {result.excluded.map((x) => (
          <li key={`${x.reference.composition}@${x.reference.version}`} className="cl-discovery__item" data-testid={`discovery-excluded-${x.reference.composition}-${x.reference.version}`}>
            <span className="cl-item__name">
              {x.title} <span className="cl-badge">v{x.reference.version} · {x.status === "draft" ? "Draft" : "Approved"}</span>
            </span>
            <ul className="cl-plain">
              {x.reasons.map((r) => (
                <li key={r.kind + r.text} data-kind={r.kind}>
                  {r.text}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      {last && (
        <div className={`cl-eligibility${last.resolution.ok ? " cl-eligibility--ok" : ""}`} role="status" data-testid="discovery-resolution" data-ok={last.resolution.ok}>
          <p className="cl-eligibility__headline">
            {last.resolution.ok
              ? `Resolved ${last.title} v${last.ref.version} (${short(last.ref.definitionSha256)}) through the governed pipeline: ${last.resolution.state} state, ${last.resolution.components} components.`
              : `Refused: ${last.resolution.reason}.`}
          </p>
          {!last.resolution.ok && last.resolution.reasons && (
            <ul className="cl-plain">
              {last.resolution.reasons.map((r) => (
                <li key={r.kind + r.text}>{r.text}</li>
              ))}
            </ul>
          )}
          <button className="cl-tool" onClick={() => void run(last.ref, last.title)} data-testid="discovery-resolve-again">
            Resolve this exact reference again
          </button>
        </div>
      )}

      <details className="cl-tech" data-testid="discovery-machine">
        <summary>Machine-readable result</summary>
        <pre className="cl-discovery__json" data-testid="discovery-json" tabIndex={0}>
          {JSON.stringify(result, null, 2)}
        </pre>
      </details>
    </section>
  );
}
