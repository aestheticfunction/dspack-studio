"use client";

/**
 * Break-it Mode (FM-8): pick a failure condition, run it, watch the open
 * pipeline defend itself — validation, repair, refusal, or recoverable
 * rejection — through the exact same RunView, timeline, and inspectors as
 * every other run. Deterministic variants (labeled scripted) work offline;
 * live variants run the same prompt a visitor could type.
 */
import { useMemo, useState } from "react";
import { breakConditions, capabilitiesByScenario, resolveAction, scenarios, type BreakCondition } from "@dspack-studio/scenarios";
import { importFixture, parseFixture, surfaceComponentsAt } from "@dspack-studio/replay";
import { useLiveRun } from "./use-live-run";
import { RunView } from "./run-view";
import { btnClass } from "./ui";

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:8787";

export function BreakView() {
  const live = useLiveRun(AGENT_URL);
  const [conditionId, setConditionId] = useState(breakConditions[0].id);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [runSeq, setRunSeq] = useState(0);
  const [importDemo, setImportDemo] = useState<string | null>(null);

  const condition = breakConditions.find((c) => c.id === conditionId)!;
  const scenario = useMemo(() => scenarios.find((s) => s.id === condition.scenarioId)!, [condition]);
  const effectivePrompt = prompt ?? condition.prompt ?? "";
  const streaming = live.status === "streaming";

  // No local agent: conditions with an equivalent recorded real run replay
  // it, labeled as a recording; the rest say plainly what they need.
  const offline = live.agentOnline === false && condition.kind !== "malformed-import";
  const recordedCatch = useMemo(() => {
    const rc = condition.recordedCatch;
    if (!rc) return null;
    const sc = scenarios.find((s) => s.id === rc.scenarioId);
    const ref = sc?.fixtures.find((f) => f.key === rc.fixtureKey);
    return ref ? { note: rc.note, fixture: parseFixture(ref.fixture) } : null;
  }, [condition]);

  const start = (modelRef: string) => {
    setImportDemo(null);
    setRunSeq((n) => n + 1);
    live.run({
      prompt: effectivePrompt || condition.label,
      intent: condition.intent,
      modelRef,
      scenario: condition.kind === "unresolved-action" || condition.kind === "invalid-state" ? scenario.id : undefined,
    });
  };

  const dispatchBadAction = () => {
    const components = surfaceComponentsAt({ events: live.events }, live.events.length - 1);
    if (condition.kind === "unresolved-action") {
      const action = { name: "mystery_action", sourceComponentId: "intro" };
      const resolution = resolveAction(action, components as any, capabilitiesByScenario[scenario.id] ?? []);
      live.sendAction({ scenario: scenario.id, ...action, resolution } as any);
    } else {
      // invalid-state: a well-formed action carrying state the agent rejects.
      live.sendAction({
        scenario: scenario.id,
        name: "apply_constraint",
        capability: "apply_constraint",
        context: { constraint: "keto" },
        resolution: { ok: true, capability: "apply_constraint", method: "exact-name", originalName: "apply_constraint", context: { constraint: "keto" } },
      } as any);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        {breakConditions.map((c: BreakCondition) => (
          <button
            key={c.id}
            data-testid={`break-${c.id}`}
            className={btnClass(c.id === conditionId)}
            onClick={() => {
              setConditionId(c.id);
              setPrompt(null);
              setImportDemo(null);
              live.reset();
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      <p data-testid="break-expected" style={{ fontSize: 13, color: "var(--fg-dim)", margin: "0 0 10px", maxWidth: 720 }}>
        <strong>Expected:</strong> {condition.expected}
      </p>

      {condition.prompt && !offline && (
        <input
          data-testid="break-prompt"
          aria-label="the adversarial prompt this break attempt runs"
          value={effectivePrompt}
          onChange={(e) => setPrompt(e.target.value)}
          style={{ width: "100%", padding: "8px 12px", borderRadius: 2, border: "1px solid var(--line)", font: "inherit", fontSize: 13, background: "var(--bg-1)", color: "inherit", marginBottom: 8 }}
        />
      )}

      {offline && recordedCatch && (
        <p data-testid="break-recorded-note" style={{ fontSize: 13, color: "var(--fg-dim)", margin: "0 0 10px", maxWidth: 720 }}>
          The local agent is offline, so this is the recorded catch instead of a fresh run. {recordedCatch.note}
        </p>
      )}
      {offline && !recordedCatch && (
        <p data-testid="break-live-only" style={{ fontSize: 13, color: "var(--fg-dim)", margin: "0 0 14px", maxWidth: 720 }}>
          This condition runs the pipeline for real and needs the local agent (
          <code>pnpm --filter agent dev</code>). No recording substitutes for it.
        </p>
      )}
      {!offline && <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        {condition.kind === "malformed-import" ? (
          <button data-testid="break-run" className={btnClass(true)} onClick={() => setImportDemo((importFixture("{this is not json") as any).error)}>
            try the malformed import
          </button>
        ) : condition.kind === "unresolved-action" || condition.kind === "invalid-state" ? (
          <>
            <button data-testid="break-run" className={btnClass(true)} disabled={streaming} onClick={() => start("deterministic:authored")}>
              start the scenario
            </button>
            <button
              data-testid="break-dispatch"
              className={btnClass()}
              disabled={live.events.length === 0 || streaming}
              onClick={dispatchBadAction}
            >
              {condition.kind === "unresolved-action" ? "dispatch an ungroundable action" : "submit an invalid constraint"}
            </button>
          </>
        ) : (
          <>
            {condition.scriptedRef && (
              <button data-testid="break-run" className={btnClass(true)} disabled={streaming} onClick={() => start(condition.scriptedRef!)}>
                run deterministic (scripted)
              </button>
            )}
            {condition.prompt && (
              <button data-testid="break-run-live" className={btnClass()} disabled={streaming} onClick={() => start("ollama:gpt-oss:latest")}>
                run live (local model)
              </button>
            )}
          </>
        )}
        <span style={{ fontSize: 13, color: "var(--fg-dim)" }} data-testid="break-status" aria-live="polite">
          {live.status}
        </span>
      </div>}

      {importDemo && (
        <section data-testid="break-import-error" style={{ border: "1px solid var(--err-line)", background: "var(--err-soft)", borderRadius: 6, padding: "12px 16px", fontSize: 13, marginBottom: 14 }}>
          The validator said no: <code>{importDemo}</code> — and nothing was partially loaded.
        </section>
      )}

      {offline && recordedCatch ? (
        <RunView
          events={recordedCatch.fixture.events}
          resetKey={`break-recorded-${conditionId}`}
          label={`recorded catch — ${recordedCatch.fixture.name}, ${recordedCatch.fixture.mode} run, ${recordedCatch.fixture.adapterId}, ${recordedCatch.fixture.events.length} events`}
          autoStart
        />
      ) : (
        live.events.length > 0 && (
          <RunView
            events={live.events}
            streaming={streaming}
            live
            resetKey={`break-${conditionId}-${runSeq}`}
            label={`${condition.label} — ${live.events.length} events`}
          />
        )
      )}
    </div>
  );
}
