"use client";

/**
 * The studio shell: scenario-driven. A scenario contributes only data
 * (intent, seed prompts, curated fixtures); the experience — replay with the
 * timeline, live streaming, gate ticker, failure panel, inspection — is the
 * same substrate for every scenario. Planned scenarios appear on the shelf
 * with what they are waiting on, stated honestly.
 */
import { useEffect, useState } from "react";
import { breakConditions, capabilitiesByScenario, readyScenarios, resolveAction, scenarios, type Scenario } from "@dspack-studio/scenarios";
import { dataModelAt, forkFixture, importFixture, parseFixture, surfaceComponentsAt, MAX_IMPORT_BYTES, type ReplayFixture } from "@dspack-studio/replay";
import { dispatchAction } from "./action-dispatch";
import { buildPermalink, parsePermalink, type PermalinkState } from "./permalink";
import { TOUR_STEPS, TourBar } from "./tour";
import { RunView } from "./run-view";

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:8787";
import { LiveView } from "./live-view";
import { BreakView } from "./break-view";
import { RestyleView } from "./restyle-view";
import { TakeHomeView } from "./take-home-view";
import { useAgentStatus } from "./use-agent-status";
import { btnClass, linkClass } from "./ui";

/** One plain sentence of context per view, shown under the switcher. */
function viewHelp(view: "replay" | "live" | "break" | "canvas" | "home", agentOnline: boolean | null): string {
  const offline = agentOnline === false;
  switch (view) {
    case "replay":
      return "Recorded real runs, replayed from their event streams. Works everywhere, no setup.";
    case "home":
      return "The ecosystem in your own editor: the MCP config, the contract, the validator, and the local agent. Same packages, published versions.";
    case "live":
      return offline
        ? "Streams a new run from an agent on your machine. The local agent is offline; start it: pnpm --filter agent dev. Replay works without it."
        : "Streams a new run from an agent on your machine. No credentials pass through the browser.";
    case "break":
      return offline
        ? "Deliberate failures, caught and explained by the same pipeline. The local agent is offline: recorded catches replay here; the rest needs it."
        : "Deliberate failures, caught and explained by the same pipeline. Deterministic variants are labeled scripted; live variants run a local model.";
    case "canvas":
      return "One governed surface, restyled by the design system's themes. The structure never changes.";
  }
}

/** AF eyebrow: mono micro-label with the 22px green rule (af.css .eyebrow). */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontFamily: "var(--mono)",
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: "0.22em",
        textTransform: "uppercase",
        color: "var(--fg-dim)",
        margin: "0 0 8px",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <span aria-hidden style={{ width: 22, height: 1, background: "var(--green)", flex: "0 0 auto" }} />
      {children}
    </p>
  );
}

/** Green pipeline arrow, decorative only. */
function Arrow() {
  return (
    <span aria-hidden style={{ color: "var(--green)" }}>
      →
    </span>
  );
}

/**
 * FM-3: the original and a fork, side by side at their own endings. Shared
 * history to the fork point, then each branch's real final state: data
 * model and rendered components. Two branches, plainly labeled; no graph.
 */
function BranchCompare({ parent, fork }: { parent: { name: string; events: any[] } | null; fork: ReplayFixture }) {
  if (!parent) return null;
  const sides = [
    { key: "original", label: `original: ${parent.name}`, source: { events: parent.events } },
    { key: "fork", label: `fork at event ${fork.fork?.forkIndex}: continues on its own`, source: { events: fork.events } },
  ];
  const models = sides.map((s) => dataModelAt(s.source, s.source.events.length - 1));
  const comps = sides.map((s) => surfaceComponentsAt(s.source, s.source.events.length - 1));
  const changedPaths = Object.keys({ ...(models[0] as any), ...(models[1] as any) }).filter(
    (k) => JSON.stringify((models[0] as any)[k]) !== JSON.stringify((models[1] as any)[k]),
  );
  return (
    <details data-testid="branch-compare" style={{ margin: "0 0 14px", fontSize: 12 }}>
      <summary style={{ cursor: "pointer" }}>compare branches: original vs this fork</summary>
      <div style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "12px 14px", marginTop: 8, display: "grid", gap: 10 }}>
        <p style={{ margin: 0 }}>
          Both branches share history up to event {fork.fork?.forkIndex}; everything after is each branch's own. The
          states below are each branch's ending.
        </p>
        <div className="st-cols-2">
          {sides.map((side, i) => (
            <div key={side.key} data-testid={`branch-${side.key}`} style={{ border: "1px dashed var(--line)", borderRadius: 4, padding: 10, minWidth: 0 }}>
              <strong style={{ display: "block", marginBottom: 6 }}>{side.label}</strong>
              <div style={{ marginBottom: 6, color: "var(--fg-dim)" }}>
                {side.source.events.length} events, {comps[i].length} rendered components
              </div>
              <pre tabIndex={0} aria-label={`${side.key} final data model`} style={{ margin: 0, padding: 8, background: "var(--bg-2)", borderRadius: 3, overflow: "auto", maxHeight: 200, fontFamily: "var(--mono)" }}>
                {JSON.stringify(models[i], null, 2)}
              </pre>
            </div>
          ))}
        </div>
        <p style={{ margin: 0 }} data-testid="branch-diff">
          {changedPaths.length > 0 ? (
            <>
              the branches disagree on: {changedPaths.map((k) => <code key={k} style={{ marginRight: 6 }}>{k}</code>)}
            </>
          ) : (
            <>the branches currently agree on every shared-state path</>
          )}
        </p>
      </div>
    </details>
  );
}

function ReplayPane({ scenario, deepLink, onLinkError }: { scenario: Scenario; deepLink?: PermalinkState; onLinkError?: (msg: string) => void }) {
  const [key, setKey] = useState(
    deepLink?.fixture && scenario.fixtures.some((f) => f.key === deepLink.fixture) ? deepLink.fixture : scenario.fixtures[0]?.key,
  );
  const [imported, setImported] = useState<ReplayFixture | null>(null);
  const [importSeq, setImportSeq] = useState(0);
  const [importError, setImportError] = useState<string | null>(null);
  // FM-3: forked runs live beside the curated fixtures for this session.
  const [forks, setForks] = useState<ReplayFixture[]>([]);
  const [forkError, setForkError] = useState<string | null>(null);
  // Continuation: the fork id whose agent session has been rebuilt from its
  // prefix (deterministic responders) and now accepts NEW actions.
  const [continuingId, setContinuingId] = useState<string | null>(null);
  const [continueError, setContinueError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setImportError(null);
    if (file.size > MAX_IMPORT_BYTES) {
      setImportError(`"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB: fixtures are small JSON documents (limit 5 MB)`);
      return;
    }
    const result = importFixture(await file.text(), file.size);
    if (!result.ok) {
      setImportError(`"${file.name}": ${result.error}`);
      return;
    }
    setImported(result.fixture);
    setImportSeq((n) => n + 1);
    setKey("__imported__");
  };

  // Deep links: unknown fixture keys fail clearly; fork links reconstruct
  // the fork deterministically from the bundled parent (same prefix, fresh
  // identity) rather than pretending a stored session exists.
  useEffect(() => {
    if (!deepLink) return;
    if (deepLink.fixture && !scenario.fixtures.some((f) => f.key === deepLink.fixture)) {
      onLinkError?.(`this scenario has no recording '${deepLink.fixture}'`);
      return;
    }
    if (deepLink.fork) {
      const parentRef = scenario.fixtures.find((f) => f.key === deepLink.fork!.parentKey);
      if (!parentRef) {
        onLinkError?.(`this scenario has no recording '${deepLink.fork.parentKey}' to fork`);
        return;
      }
      const result = forkFixture(parseFixture(parentRef.fixture), deepLink.fork.forkIndex);
      if (!result.ok) {
        onLinkError?.(`cannot fork '${deepLink.fork.parentKey}' at event ${deepLink.fork.forkIndex}: ${result.reason}`);
        return;
      }
      setForks([result.fixture]);
      setKey(result.fixture.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedFork = forks.find((f) => f.id === key) ?? null;
  const ref =
    selectedFork || (key === "__imported__" && imported)
      ? null
      : (scenario.fixtures.find((f) => f.key === key) ?? scenario.fixtures[0]);
  const fixture = ref ? parseFixture(ref.fixture) : (selectedFork ?? imported);

  const handleFork = (playhead: number) => {
    if (!fixture) return;
    setForkError(null);
    const result = forkFixture(fixture, playhead);
    if (!result.ok) {
      setForkError(result.reason);
      return;
    }
    setForks((prev) => [...prev, result.fixture]);
    setKey(result.fixture.id);
  };

  // POST the fork's prefix to the agent: reset scenario state, restore the
  // recorded grounding, replay accepted actions — then new actions continue
  // the branch. Refused (409) if a replay diverges; nothing is invented.
  const startContinuation = async (fork: ReplayFixture) => {
    setContinueError(null);
    try {
      const r = await fetch(`${AGENT_URL}/fork`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenario: scenario.id, events: fork.events }),
      });
      const body = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !body.ok) throw new Error(body.error ?? `agent responded ${r.status}`);
      setContinuingId(fork.id);
    } catch (err) {
      setContinueError(err instanceof Error ? err.message : String(err));
    }
  };

  // Append a continuation event to the forked run (and only to it).
  const appendToFork = (forkId: string, event: Record<string, unknown>) => {
    setForks((prev) =>
      prev.map((f) =>
        f.id === forkId
          ? { ...f, events: [...f.events, { atMs: (f.events.at(-1)?.atMs ?? 0) + 1000, event: event as any }] }
          : f,
      ),
    );
  };

  const continuationAction = (fork: ReplayFixture) => (a: any) => {
    const components = surfaceComponentsAt({ events: fork.events }, fork.events.length - 1);
    const resolution = resolveAction(
      { name: a?.name ?? "unknown", sourceComponentId: a?.sourceComponentId, context: a?.context },
      components as any,
      capabilitiesByScenario[scenario.id] ?? [],
    );
    void dispatchAction(
      AGENT_URL,
      {
        scenario: scenario.id,
        name: a?.name ?? "unknown",
        capability: resolution.ok ? resolution.capability : undefined,
        surfaceId: a?.surfaceId,
        sourceComponentId: a?.sourceComponentId,
        context: resolution.ok ? resolution.context : a?.context,
        resolution: resolution as any,
      },
      (event) => appendToFork(fork.id, event),
    );
  };

  const downloadFork = (fork: ReplayFixture) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(fork, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fork.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file) void handleFile(file);
      }}
    >
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8, alignItems: "center" }}>
        {scenario.fixtures.map((f) => (
          <button key={f.key} data-testid={`fixture-${f.key}`} className={btnClass(f.key === ref?.key)} onClick={() => setKey(f.key)}>
            {f.label}
          </button>
        ))}
        {imported && (
          <button data-testid="fixture-imported" className={btnClass(key === "__imported__")} onClick={() => setKey("__imported__")}>
            imported session
          </button>
        )}
        {forks.map((f) => (
          <button
            key={f.id}
            data-testid={`fork-${f.fork?.forkIndex}`}
            className={btnClass(f.id === key, true)}
            title={`forked from ${f.fork?.parentName ?? f.fork?.parentId} at event ${f.fork?.forkIndex}`}
            onClick={() => setKey(f.id)}
          >
            ⑂ fork @ {f.fork?.forkIndex}
          </button>
        ))}
        <label className={btnClass()} style={{ marginLeft: "auto" }} data-testid="import-label">
          open a session file…
          <input
            data-testid="import-input"
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {importError && (
        <p data-testid="import-error" style={{ fontSize: 13, color: "var(--err)", margin: "0 0 10px" }}>
          could not import: {importError}
        </p>
      )}
      {forkError && (
        <p data-testid="fork-error" style={{ fontSize: 13, color: "var(--err)", margin: "0 0 10px" }}>
          cannot fork here: {forkError}
        </p>
      )}
      {ref && <p style={{ fontSize: 13, color: "var(--fg-dim)", margin: "0 0 14px" }}>{ref.blurb}</p>}
      {selectedFork && (
        <p style={{ fontSize: 13, color: "var(--fg-dim)", margin: "0 0 14px" }} data-testid="fork-blurb">
          A new run forked from “{selectedFork.fork?.parentName}” at event {selectedFork.fork?.forkIndex}: it shares
          history up to that moment and nothing after. The original is untouched.{" "}
          <button
            data-testid="fork-download"
            onClick={() => downloadFork(selectedFork)}
            className={linkClass}
          >
            download this fork
          </button>
          ; it reopens like any session file, provenance included.
          {scenario.interactive && continuingId !== selectedFork.id && (
            <>
              {" "}
              <button
                data-testid="fork-continue"
                onClick={() => void startContinuation(selectedFork)}
                className={linkClass}
              >
                continue this fork
              </button>
              ; the agent rebuilds its state from the prefix (deterministic responders), then your next actions
              diverge the branch for real.
            </>
          )}
          {continuingId === selectedFork.id && (
            <em data-testid="fork-continuing"> · continuation active: act on the surface to grow this branch.</em>
          )}
        </p>
      )}
      {selectedFork && (() => {
        const parentFix = scenario.fixtures.map((f) => parseFixture(f.fixture)).find((f) => f.id === selectedFork.fork?.parentId)
          ?? (imported?.id === selectedFork.fork?.parentId ? imported : null)
          ?? forks.find((f) => f.id === selectedFork.fork?.parentId)
          ?? null;
        return <BranchCompare parent={parentFix} fork={selectedFork} />;
      })()}
      {continueError && (
        <p data-testid="continue-error" style={{ fontSize: 13, color: "var(--err)", margin: "0 0 10px" }}>
          cannot continue this fork: {continueError}
        </p>
      )}
      {!ref && !selectedFork && imported && (
        <p style={{ fontSize: 13, color: "var(--fg-dim)", margin: "0 0 14px" }}>
          Imported session · recorded {imported.recordedAt || "(unknown time)"}, prompt: “{imported.prompt || "(none)"}”. Drag another
          file anywhere here to replace it.
        </p>
      )}
      {fixture ? (
        <RunView
          events={fixture.events}
          resetKey={ref ? `${scenario.id}:${ref.key}` : selectedFork ? selectedFork.id : `imported-${importSeq}`}
          label={
            selectedFork
              ? `⑂ ${fixture.name} · ${fixture.mode} run, ${fixture.events.length} events`
              : `${fixture.name} · ${fixture.mode} run, ${fixture.adapterId}, ${fixture.events.length} events${ref ? "" : " (imported)"}`
          }
          onFork={handleFork}
          meta={{ id: fixture.id, name: fixture.name, mode: fixture.mode, adapterId: fixture.adapterId, intent: fixture.intent, prompt: fixture.prompt, recordedAt: fixture.recordedAt, fork: fixture.fork }}
          initial={deepLink && (ref?.key === deepLink.fixture || (deepLink.fork && selectedFork)) ? { playhead: deepLink.event, xray: deepLink.xray, panel: deepLink.panel } : undefined}
          autoStart={!deepLink && ref?.key === scenario.fixtures[0]?.key}
          permalink={
            // Imported sessions live on the visitor's disk; links cover
            // bundled recordings and forks of them.
            ref || (selectedFork && scenario.fixtures.some((f) => parseFixture(f.fixture).id === selectedFork.fork?.parentId))
              ? (playhead, xrayOn) =>
                  location.origin +
                  location.pathname +
                  buildPermalink({
                    scenario: scenario.id,
                    fixture: ref?.key,
                    fork: selectedFork
                      ? { parentKey: scenario.fixtures.find((f) => parseFixture(f.fixture).id === selectedFork.fork?.parentId)!.key, forkIndex: selectedFork.fork!.forkIndex }
                      : undefined,
                    event: playhead >= 0 ? playhead : undefined,
                    xray: xrayOn || undefined,
                  })
              : undefined
          }
          live={Boolean(selectedFork && continuingId === selectedFork.id)}
          onAction={selectedFork && continuingId === selectedFork.id ? continuationAction(selectedFork) : undefined}
        />
      ) : (
        <p style={{ color: "var(--fg-dim)" }}>No recordings yet for this scenario: open a session file, or run it live and download one.</p>
      )}
    </div>
  );
}

export function Studio() {
  const [scenarioId, setScenarioId] = useState(readyScenarios[0]?.id);
  const [view, setView] = useState<"replay" | "live" | "break" | "canvas" | "home">("replay");
  // A planned scenario the visitor tapped: its "what it needs" line replaces
  // the tagline until a ready scenario is chosen or it is tapped again.
  const [revealedPlanned, setRevealedPlanned] = useState<string | null>(null);
  const agentOnline = useAgentStatus(AGENT_URL);
  const [deepLink, setDeepLink] = useState<PermalinkState | undefined>();
  const [linkError, setLinkError] = useState<string | null>(null);

  // Guided tour: drives the SAME deep-link mechanism as permalinks, so
  // every step is a real, reachable UI state. Non-blocking, restartable.
  const [tourStep, setTourStep] = useState<number | null>(null);
  const [tourOffered, setTourOffered] = useState(false);
  useEffect(() => {
    try {
      if (!localStorage.getItem("dspack-studio-tour-done") && !location.hash) setTourOffered(true);
    } catch { /* storage unavailable: no offer, tour stays reachable via the header button */ }
  }, []);
  const startTour = (n = 0) => {
    setTourOffered(false);
    setLinkError(null);
    setView("replay");
    setScenarioId(TOUR_STEPS[n].state.scenario!);
    setDeepLink(TOUR_STEPS[n].state);
    setTourStep(n);
  };
  const endTour = () => {
    setTourStep(null);
    setDeepLink(undefined);
    try { localStorage.setItem("dspack-studio-tour-done", "1"); } catch { /* fine */ }
  };

  useEffect(() => {
    if (!location.hash || location.hash === "#") return;
    const { state, error } = parsePermalink(location.hash);
    if (error) {
      setLinkError(`that link did not parse: ${error}. Showing the studio's default view instead.`);
      return;
    }
    let linkScenario = readyScenarios[0];
    if (state.scenario) {
      const target = scenarios.find((sc) => sc.id === state.scenario);
      if (!target || target.status !== "ready") {
        setLinkError(`that link points at unknown or not-yet-ready scenario '${state.scenario}'. Showing the default view instead.`);
        return;
      }
      setScenarioId(state.scenario);
      linkScenario = target;
    }
    // The scenario always wins: a break condition that does not belong to the
    // named scenario never drags the scenario along — the view opens on the
    // scenario's own valid default, with the mismatch stated.
    let breakCondition = state.breakCondition;
    if (state.view === "break" && breakCondition) {
      const condition = breakConditions.find((c) => c.id === breakCondition);
      if (!condition) {
        setLinkError(`that link did not fully resolve: there is no failure condition '${breakCondition}'. Showing this scenario's conditions instead.`);
        breakCondition = undefined;
      } else if (!(condition.scenarioIndependent || condition.scenarioId === linkScenario?.id)) {
        setLinkError(`that link did not fully resolve: '${breakCondition}' is not a failure condition for ${linkScenario?.name}. Showing this scenario's conditions instead.`);
        breakCondition = undefined;
      }
    }
    setView(state.view ?? "replay");
    setDeepLink({ ...state, breakCondition });
  }, []);
  const scenario = scenarios.find((s) => s.id === scenarioId) ?? readyScenarios[0];

  return (
    <main className="st-main" style={{ maxWidth: 900, margin: "0 auto" }}>
      <header style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", paddingBottom: 14, borderBottom: "1px solid var(--line-soft)", marginBottom: 16 }}>
          <img src="/af-mark.png" alt="" height={28} width={32} style={{ display: "block" }} />
          <h1
            style={{
              fontFamily: "var(--geo)",
              fontSize: 13,
              fontWeight: 400,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "var(--fg)",
              margin: 0,
            }}
          >
            Aesthetic Function <span style={{ color: "var(--green-bright)" }}>/ Studio</span>
          </h1>
          <a
            href="https://aesthetic-function.com"
            style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 12, color: "var(--fg-dim)", textDecoration: "none" }}
          >
            aesthetic-function.com ↗
          </a>
        </div>
        <p
          style={{
            fontFamily: "var(--hl)",
            fontSize: "clamp(20px, 3vw, 26px)",
            fontWeight: 600,
            lineHeight: 1.1,
            letterSpacing: "-0.01em",
            color: "var(--fg)",
            margin: 0,
            textWrap: "balance",
          }}
        >
          The design system governs what the agent ships.
        </p>
        <p style={{ fontSize: 14, color: "var(--fg-body)", margin: "10px 0 0", maxWidth: 720, lineHeight: 1.55 }}>
          An agent proposes an interface. The design system checks it. Invalid patterns are explained and repaired,
          with the rule and its written rationale on the record. The result can be replayed, rewound, forked,
          restyled, and inspected, because its structure, its events, and its rules stay separate and visible.
        </p>
        <p style={{ fontSize: 13, color: "var(--fg-dim)", margin: "8px 0 0", maxWidth: 720, lineHeight: 1.55 }}>
          dspack-studio is Aesthetic Function&apos;s reference application for governed generative interfaces. Every
          curated recording is a real run; recorded and live modes are labeled.
        </p>
        <p style={{ fontSize: 13, margin: "10px 0 0" }}>
          <button data-testid="tour-start" onClick={() => startTour(0)} className={linkClass}>
            {tourOffered ? "first time here? take the one-minute tour" : "guided tour"}
          </button>
        </p>
      </header>

      {/* The scenario shelf. Planned scenarios are real buttons whose only
          action is revealing what they are waiting on — reachable by touch
          and keyboard, never mistakable for a working scenario. */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        {scenarios.map((s) =>
          s.status === "ready" ? (
            <button
              key={s.id}
              data-testid={`scenario-${s.id}`}
              className={btnClass(s.id === scenario?.id)}
              onClick={() => {
                setRevealedPlanned(null);
                setScenarioId(s.id);
              }}
            >
              {s.name}
            </button>
          ) : (
            <button
              key={s.id}
              data-testid={`scenario-${s.id}`}
              title={`Planned. Needs: ${(s.needs ?? []).join("; ")}`}
              className={btnClass(false, true)}
              style={{ color: "var(--fg-dim)" }}
              onClick={() => setRevealedPlanned((cur) => (cur === s.id ? null : s.id))}
            >
              {s.name} <em style={{ fontSize: 11 }}>(planned)</em>
            </button>
          ),
        )}
      </div>
      {revealedPlanned ? (
        <p data-testid="planned-needs" style={{ fontSize: 13, color: "var(--fg-dim)", margin: "0 0 16px" }}>
          {(() => {
            const p = scenarios.find((s) => s.id === revealedPlanned);
            return p ? `${p.name} is planned, not built. It needs: ${(p.needs ?? []).join("; ")}.` : null;
          })()}
        </p>
      ) : (
        scenario && <p style={{ fontSize: 13, color: "var(--fg-dim)", margin: "0 0 16px" }}>{scenario.tagline}</p>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <button data-testid="view-replay" className={btnClass(view === "replay")} onClick={() => setView("replay")}>
          replay a recorded run
        </button>
        <button
          data-testid="view-live"
          className={btnClass(view === "live")}
          title={agentOnline === false ? "runs on a local agent; offline right now" : undefined}
          onClick={() => setView("live")}
        >
          run it live{agentOnline === false && <span> · offline</span>}
        </button>
        <button
          data-testid="view-break"
          className={btnClass(view === "break")}
          title={agentOnline === false ? "recorded catches replay here; fresh runs need the local agent" : undefined}
          onClick={() => setView("break")}
        >
          break it on purpose{agentOnline === false && <span> · recorded</span>}
        </button>
        <button data-testid="view-canvas" className={btnClass(view === "canvas")} onClick={() => setView("canvas")}>
          restyle it
        </button>
        <button data-testid="view-home" className={btnClass(view === "home")} onClick={() => setView("home")}>
          take it home
        </button>
      </div>
      <p data-testid="view-help" style={{ fontSize: 13, color: "var(--fg-dim)", margin: "0 0 20px", maxWidth: 720 }}>
        {viewHelp(view, agentOnline)}
      </p>

      {linkError && (
        <p data-testid="link-error" role="alert" style={{ fontSize: 13, color: "var(--err)", margin: "0 0 12px" }}>
          {linkError}
        </p>
      )}
      {view === "replay" && scenario && (
        <ReplayPane
          key={`${scenario.id}${deepLink ? `:linked:${tourStep ?? "url"}` : ""}`}
          scenario={scenario}
          deepLink={deepLink}
          onLinkError={(msg) => setLinkError(`that link did not fully resolve: ${msg}. Showing the scenario's default recording instead.`)}
        />
      )}
      {view === "live" && scenario && <LiveView key={scenario.id} scenario={scenario} />}
      {view === "break" && scenario && (
        <BreakView
          key={scenario.id}
          scenario={scenario}
          initialConditionId={deepLink?.view === "break" ? deepLink.breakCondition : undefined}
          initial={deepLink?.view === "break" ? { playhead: deepLink.event, xray: deepLink.xray, panel: deepLink.panel } : undefined}
        />
      )}
      {view === "canvas" && scenario && <RestyleView scenario={scenario} />}
      {view === "home" && <TakeHomeView agentOnline={agentOnline} />}
      {/* Orientation, below the primary experience: the approved pipeline
          language and the existing capabilities, stated once, compactly. */}
      <section aria-label="how it works" style={{ marginTop: 44, fontSize: 12 }}>
        <Eyebrow>How it works</Eyebrow>
        {/* The pipeline diagram: real text in DOM order, decorative bus SVG
            below it (af-site's .dgm idiom). Collapses to a 2-up grid without
            the bus on narrow viewports. */}
        <figure data-testid="pipeline-diagram" className="dgm" style={{ marginLeft: 0, marginRight: 0 }}>
          <div className="dgm-grid">
            <div className="dgm-node">
              <p className="dgm-node__k">Intent</p>
              <p className="dgm-node__t">Prompt / agent</p>
              <p className="dgm-node__s">what should exist</p>
            </div>
            <div className="dgm-node dgm-node--contract">
              <p className="dgm-node__k">Governs</p>
              <p className="dgm-node__t">dspack contract</p>
              <p className="dgm-node__s">rules + gates S1 S2 S3</p>
            </div>
            <div className="dgm-node">
              <p className="dgm-node__k">Compiles</p>
              <p className="dgm-node__t">dspack-emit</p>
              <p className="dgm-node__s">gates A1 A2 A3</p>
            </div>
            <div className="dgm-node">
              <p className="dgm-node__k">Transports</p>
              <p className="dgm-node__t">AG-UI</p>
              <p className="dgm-node__s">the wire</p>
            </div>
            <div className="dgm-node">
              <p className="dgm-node__k">Describes</p>
              <p className="dgm-node__t">A2UI</p>
              <p className="dgm-node__s">the surface</p>
            </div>
            <div className="dgm-node">
              <p className="dgm-node__k">Renders</p>
              <p className="dgm-node__t">Astryx</p>
              <p className="dgm-node__s">components + themes</p>
            </div>
          </div>
          <svg className="dgm-bus" viewBox="0 0 720 40" preserveAspectRatio="none" aria-hidden="true">
            {[60, 180, 300, 420, 540, 660].map((x) => (
              <line key={`v${x}`} x1={x} y1={2} x2={x} y2={20} stroke="#4a4a40" strokeWidth={1} strokeDasharray="4 4" />
            ))}
            <line x1={60} y1={20} x2={660} y2={20} stroke="#7e9652" strokeWidth={1.5} />
            {[60, 180, 300, 420, 540, 660].map((x) => (
              <circle key={`c${x}`} cx={x} cy={20} r={2.5} fill="#7e9652" />
            ))}
            <line x1={660} y1={20} x2={660} y2={38} stroke="#7e9652" strokeWidth={1.5} />
          </svg>
          <figcaption className="dgm-caption">
            One pipeline, inspectable at every joint: the contract constrains what the agent may propose, the gates
            check it, the emitter compiles it, the wire carries it, the surface describes it, and Astryx renders it.
            Structure, events, and rules never collapse into each other.
          </figcaption>
        </figure>
        <p style={{ fontFamily: "var(--mono)", color: "var(--fg-dim)", margin: 0, lineHeight: 2 }}>
          <a className={linkClass} href="https://github.com/aestheticfunction/dspack">dspack</a> constrains and
          validates <Arrow /> <a className={linkClass} href="https://github.com/aestheticfunction/dspack-emit">dspack-emit</a>{" "}
          compiles <Arrow /> <a className={linkClass} href="https://github.com/ag-ui-protocol/ag-ui">AG-UI</a> transports{" "}
          <Arrow /> <a className={linkClass} href="https://github.com/google/A2UI">A2UI</a> describes <Arrow />{" "}
          <a className={linkClass} href="https://github.com/facebook/astryx">Astryx</a> renders.
        </p>
        <p style={{ color: "var(--fg-dim)", margin: "6px 0 0" }}>
          In any run, the pipeline view shows the layers each event touches, and the wire shows the raw protocol
          session.
        </p>
        <details style={{ marginTop: 8, color: "var(--fg-dim)" }}>
          <summary style={{ cursor: "pointer" }}>what each layer does</summary>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, lineHeight: 1.7 }}>
            <li>Agent: intent routing, governed generation, human-in-the-loop pauses, data-model patching.</li>
            <li>dspack contract: constrains generation, validates S1/S2/S3, carries rationale.</li>
            <li>dspack-emit: compiles the contract to catalogs and the surface to A2UI; gates A1/A2/A3.</li>
            <li>AG-UI: transport for lifecycle, tool calls, gate telemetry, and state deltas.</li>
            <li>A2UI: the declarative surface, data model, and actions.</li>
            <li>Astryx: real components and theming behind the catalog names.</li>
          </ul>
        </details>
        <details data-testid="boundary" style={{ marginTop: 8, color: "var(--fg-dim)" }}>
          <summary style={{ cursor: "pointer" }}>what this is not</summary>
          <p style={{ margin: "6px 0 0" }}>
            This application demonstrates the open ecosystem: dspack, dspack-gen, dspack-emit, AG-UI, A2UI, and
            Astryx. It does not include Aesthetic Function&apos;s proprietary reconciliation engine.
          </p>
        </details>
        <div style={{ marginTop: 20 }}>
          <Eyebrow>What you can do</Eyebrow>
          <p style={{ fontFamily: "var(--mono)", color: "var(--fg-dim)", margin: 0, lineHeight: 1.9 }}>
            Replay a real governed run · Rewind the interface through its event history · Fork from a previous moment
            · Break a rule on purpose · X-ray pixels back to protocol and contract evidence · Download the run and its
            audit receipt
          </p>
        </div>
      </section>
      {tourStep !== null && <TourBar step={tourStep} onStep={(n) => startTour(n)} onDone={endTour} />}
      <footer style={{ marginTop: 44, paddingTop: 16, borderTop: "1px solid var(--line)", fontSize: 12, color: "var(--fg-dim)" }}>
        <p style={{ margin: 0 }}>
          dspack-studio demonstrates the open ecosystem only: dspack, dspack-gen, dspack-emit, AG-UI, A2UI, and
          Astryx. Aesthetic Function&apos;s proprietary reconciliation technology is not included and is not demonstrated
          here. Curated recordings are real runs; each carries its provenance and its receipt.
        </p>
        <p style={{ fontFamily: "var(--mono)", margin: "12px 0 0", display: "flex", gap: 14, flexWrap: "wrap" }}>
          <a className={linkClass} href="https://github.com/aestheticfunction/dspack-studio">source</a>
          <a className={linkClass} href="https://github.com/aestheticfunction/dspack-studio#readme">readme</a>
          <a className={linkClass} href="https://github.com/aestheticfunction/dspack-gen">dspack-gen</a>
          <a className={linkClass} href="https://aesthetic-function.com/open-source.html">open source</a>
          <a className={linkClass} href="https://aesthetic-function.com">aesthetic-function.com</a>
        </p>
        <p style={{ fontFamily: "var(--mono)", margin: "12px 0 0", color: "var(--fg-dim)" }}>© 2026 Aesthetic Function LLC</p>
      </footer>
    </main>
  );
}
