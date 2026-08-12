"use client";

import { useCallback, useRef } from "react";
import { gatesSummary } from "@dspack-studio/composer-core";
import { useComposer } from "../state";
import type { View } from "../composer";

const STATE_COLOR: Record<string, string> = {
  "tool-owned": "var(--info)",
  "human-owned": "var(--ok)",
  "human-authored": "var(--ok)",
  unattributed: "var(--ok)",
  orphaned: "var(--warn)",
  // --fg-faint is 3.25:1 on the app background: below AA for this 11px
  // text. Decided states must stay legible, so they use --fg-dim (5.40:1).
  tombstoned: "var(--fg-dim)",
  absent: "var(--fg-dim)",
};

/**
 * The authorship progress model: what remains between "connected" and "a
 * governed catalog", every row derived (never stored) and linked to the
 * view where the work happens. This is awaitingAuthorship turned into a
 * product surface.
 */
function progressRows(state: ReturnType<typeof useComposer>): Array<{ label: string; done: boolean; detail: string; view: View }> {
  const { contract, profile, emit } = state;
  if (!contract) return [];
  const components = Object.entries((contract.components ?? {}) as Record<string, any>);
  const described = components.filter(([, c]) => c.whenToUse).length;
  const bare = components.filter(([, c]) => Object.keys(c.props ?? {}).length === 0).length;
  const plans = new Set(((profile?.components ?? []) as any[]).map((p) => p.dspackId));
  const casualties = new Set(((profile?.casualtyComponents ?? []) as any[]).map((c) => c.dspackId));
  const unmapped = components.filter(([id]) => !plans.has(id) && !casualties.has(id)).length;
  const intents = (contract.intents ?? []).length;
  const rules = (contract.rules ?? []).length;
  const examples = (contract.examples ?? []).length;
  // Acknowledged casualties are decisions, not unresolved work: they never
  // count as errors, and never make a failing project look green.
  const gates = gatesSummary(emit?.findings ?? [], emit !== null);
  return [
    { label: "Components described", done: described === components.length, detail: `${described}/${components.length} carry whenToUse`, view: "inventory" },
    { label: "Props enriched", done: bare === 0, detail: bare ? `${bare} component(s) have no props — discovery is variant-centric; add content props` : "every component declares props", view: "inventory" },
    { label: "Mapping decided", done: unmapped === 0, detail: unmapped ? `${unmapped} component(s) neither mapped nor declared casualties` : "every component mapped or a declared casualty", view: "mapper" },
    { label: "Intents authored", done: intents > 0, detail: `${intents} intent(s) — the scoping vocabulary generation runs under`, view: "governance" },
    { label: "Rules authored", done: rules > 0, detail: `${rules} rule(s), each carrying its written rationale`, view: "governance" },
    { label: "Surfaces", done: examples > 0, detail: `${examples} surface(s) — what Preview shows and what the next build learns from`, view: "surfaces" },
    { label: "Gates green", done: (emit?.ok ?? false) && gates.done, detail: gates.detail, view: "validate" },
  ];
}

/**
 * The rediscovery report, rendered as decisions rather than a log line.
 * Every entry-level class from dspack-export's ratified table appears;
 * the ones that need a person (deletions, conflicts, fresh facts on
 * enriched entries) carry their explicit actions. Nothing here acts on
 * its own — the buttons ARE the acceptance.
 */
function RediscoveryReport() {
  const { rediscovery, resolveDeletion, resolveConflict, acceptFreshFact, busy } = useComposer();
  // A decided row disappears from under the pointer; keyboard users would
  // otherwise be dropped to the document body. Focus returns to the report
  // heading, next to the status message that says what happened.
  const heading = useRef<HTMLHeadingElement>(null);
  const decide = useCallback(
    (run: () => Promise<void>) => () => {
      void run().then(() => heading.current?.focus());
    },
    [],
  );
  if (!rediscovery) return null;
  const c = rediscovery.components;
  const line = (label: string, ids: string[], color = "var(--fg-body)") =>
    ids.length > 0 && (
      <li style={{ padding: "4px 0", borderTop: "1px solid var(--line-soft)" }}>
        <span style={{ fontFamily: "var(--mono)", fontSize: 11, textTransform: "uppercase", color }}>{label}</span>{" "}
        <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--fg-body)" }}>{ids.join(", ")}</span>
      </li>
    );
  const enrichedWithFacts = c.preservedEnriched.filter((p) => p.freshDelta.length > 0);

  return (
    <div style={{ marginTop: 18 }} data-testid="rediscovery-report">
      <h2 ref={heading} tabIndex={-1} style={{ fontFamily: "var(--hl)", fontSize: 15, textTransform: "uppercase", color: "var(--fg)" }}>
        Last rediscovery
      </h2>
      <ul style={{ listStyle: "none", padding: 0, fontSize: 13, margin: "6px 0 0" }}>
        {line("added", c.added, "var(--ok)")}
        {line("refreshed", c.refreshed, "var(--info)")}
        {line("readopted", c.readopted, "var(--info)")}
        {line("preserved (yours)", c.preservedEnriched.map((p) => p.id), "var(--ok)")}
        {line("removed with source", c.removedWithSource, "var(--warn)")}
        {line("kept, missing in source", c.keptMissingInFresh, "var(--warn)")}
        {line("skipped (tombstoned)", c.suppressed, "var(--fg-dim)")}
        {line("tombstoned but present", c.suppressedButPresent, "var(--warn)")}
        {line("restored top-level (both exist)", c.restoredTopLevel.map((x) => (x.parent ? `${x.id} (nested in ${x.parent} kept)` : x.id)), "var(--ok)")}
      </ul>

      {c.deletedAwaitingDecision.length > 0 && (
        <div style={{ marginTop: 10 }} data-testid="deletions-awaiting" role="group" aria-labelledby="decisions-deletions">
          <h3 id="decisions-deletions" style={{ fontSize: 13, color: "var(--warn)" }}>Deletions awaiting your decision</h3>
          <p style={{ fontSize: 12, color: "var(--fg-dim)" }}>
            These exist in source but not in your document — either you deleted them, or they appeared after a snapshot
            this tool could not attribute. Rediscovery never adds them on its own: restore to bring one in from source
            next time, tombstone it so it is never re-added, or decide later — the memory keeps.
          </p>
          {c.deletedAwaitingDecision.map((id) => (
            <div key={id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0" }} data-testid={`deletion-${id}`}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 12, flex: 1 }}>{id}</span>
              <button
                className="st-btn"
                disabled={busy !== null}
                aria-label={`Restore ${id}`}
                onClick={decide(() => resolveDeletion(id, "restore"))}
                data-testid={`restore-${id}`}
              >
                Restore
              </button>
              <button
                className="st-btn st-btn--dashed"
                disabled={busy !== null}
                aria-label={`Never rediscover ${id}`}
                onClick={decide(() => resolveDeletion(id, "tombstone"))}
                data-testid={`tombstone-${id}`}
              >
                Never rediscover
              </button>
            </div>
          ))}
        </div>
      )}

      {c.restoredConflict.length > 0 && (
        <div style={{ marginTop: 10 }} data-testid="conflicts-awaiting" role="group" aria-labelledby="decisions-conflicts">
          <h3 id="decisions-conflicts" style={{ fontSize: 13, color: "var(--warn)" }}>Restructured, not re-added</h3>
          <p style={{ fontSize: 12, color: "var(--fg-dim)" }}>
            Each of these exists in source as a top-level component, but you authored it as a sub-component of another
            entry. Rediscovery never decides which representation you meant: keep yours nested, restore the top-level
            entry alongside it, or decide later — nothing changes until you choose.
          </p>
          {c.restoredConflict.map(({ id, parent }) => (
            <div key={id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0" }} data-testid={`conflict-${id}`}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 12, flex: 1 }}>
                {id} <span style={{ color: "var(--fg-dim)" }}>nested in {parent}</span>
              </span>
              <button
                className="st-btn"
                disabled={busy !== null}
                aria-label={`Keep ${id} nested`}
                onClick={decide(() => resolveConflict(id, "keep-nested"))}
                data-testid={`keep-nested-${id}`}
              >
                Keep nested
              </button>
              <button
                className="st-btn st-btn--dashed"
                disabled={busy !== null}
                aria-label={`Restore ${id} as a top-level component`}
                onClick={decide(() => resolveConflict(id, "restore-top-level"))}
                data-testid={`restore-top-level-${id}`}
              >
                Restore top-level
              </button>
            </div>
          ))}
        </div>
      )}

      {enrichedWithFacts.length > 0 && (
        <div style={{ marginTop: 10 }} data-testid="fresh-facts" role="group" aria-labelledby="decisions-facts">
          <h3 id="decisions-facts" style={{ fontSize: 13, color: "var(--fg)" }}>Fresh facts on entries you own</h3>
          <p style={{ fontSize: 12, color: "var(--fg-dim)" }}>
            Review information from the latest extraction — never merged on its own. Accepting writes the one fact into
            your entry (which stays yours); anything more than a scalar or a pure addition is authored by hand.
          </p>
          {enrichedWithFacts.map((p) =>
            p.freshDelta.map((fact) => (
              <div key={`${p.id}${fact.path}`} style={{ display: "flex", gap: 8, alignItems: "center", padding: "3px 0" }}>
                <span style={{ fontFamily: "var(--mono)", fontSize: 12, flex: 1 }}>
                  {p.id}
                  <span style={{ color: "var(--fg-dim)" }}>{fact.path}</span> ={" "}
                  <span style={{ color: "var(--fg-body)" }}>{JSON.stringify(fact.fresh)}</span>
                </span>
                <button
                  className="st-btn"
                  disabled={busy !== null}
                  aria-label={`Accept ${fact.path} for ${p.id}`}
                  onClick={decide(() => acceptFreshFact(p.id, fact))}
                  data-testid={`accept-${p.id}${fact.path.replaceAll("/", "-")}`}
                >
                  Accept
                </button>
              </div>
            )),
          )}
        </div>
      )}
    </div>
  );
}

export function RepositoryView({ onNavigate }: { onNavigate: (view: View) => void }) {
  const state = useComposer();
  const { mode, manifest, ledger, discover, rediscover, clearTombstone, resolveDeletion, busy } = state;
  const rows = progressRows(state);

  return (
    <section style={{ display: "grid", gap: 24, gridTemplateColumns: "minmax(280px, 1fr) minmax(280px, 1fr)" }}>
      <div>
        <h2 style={{ fontFamily: "var(--hl)", fontSize: 15, textTransform: "uppercase", color: "var(--fg)" }}>Repository</h2>
        <p style={{ fontSize: 13, color: "var(--fg-body)" }}>
          This project reads and writes files in your repository through the local agent. Refresh the discovered catalog,
          and decide what happens to entries you have edited or removed &mdash; nothing leaves your machine.
        </p>
        {mode === "agent" && manifest?.exportConfigPath && (
          <div style={{ marginTop: 14, display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
            <button className="st-btn" disabled={busy !== null} onClick={() => void rediscover()} data-testid="rediscover">
              Rediscover
            </button>
            <button className="st-btn st-btn--dashed" disabled={busy !== null} onClick={() => void discover()} data-testid="discover">
              First bootstrap
            </button>
            <p style={{ fontSize: 12, color: "var(--fg-dim)", flexBasis: "100%" }}>
              Rediscover merges per component entry (ledger v2): tool-owned entries refresh, entries you edited are
              preserved verbatim, new components are added, deleted ones stay deleted until you decide below. First
              bootstrap keeps the whole-file refusal table; refusals are shown verbatim.
            </p>
          </div>
        )}

        {rows.length > 0 && (
          <>
            <h2 style={{ fontFamily: "var(--hl)", fontSize: 15, textTransform: "uppercase", color: "var(--fg)", marginTop: 20 }}>
              What remains
            </h2>
            <p style={{ fontSize: 12, color: "var(--fg-dim)" }}>Set up your design system, then build with it — this checklist is the runway.</p>
            {state.readiness.ready && state.mode === "agent" && (
              <p>
                <button className="st-btn" onClick={() => onNavigate("build")} data-testid="start-building">
                  Start building
                </button>
              </p>
            )}
            <ul style={{ listStyle: "none", padding: 0, fontSize: 13 }} data-testid="progress">
              {rows.map((row) => (
                <li key={row.label} style={{ borderTop: "1px solid var(--line-soft)", padding: "7px 0", display: "flex", gap: 10, alignItems: "baseline" }}>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: row.done ? "var(--ok)" : "var(--warn)", width: 14 }}>
                    {row.done ? "✓" : "•"}
                  </span>
                  <button className="st-link" style={{ fontSize: 13 }} onClick={() => onNavigate(row.view)} data-testid={`progress-${row.view}-${row.label.split(" ")[0].toLowerCase()}`}>
                    {row.label}
                  </button>
                  <span style={{ fontSize: 12, color: "var(--fg-dim)" }}>{row.detail}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div>
        <h2 style={{ fontFamily: "var(--hl)", fontSize: 15, textTransform: "uppercase", color: "var(--fg)" }}>Ownership</h2>
        {ledger ? (
          <>
            <table style={{ fontSize: 13, borderCollapse: "collapse" }}>
              <tbody>
                {ledger.sections
                  .filter((s) => s.state !== "absent")
                  .map((s) => (
                    <tr key={s.section}>
                      <td style={{ padding: "3px 12px 3px 0", fontFamily: "var(--mono)", fontSize: 12 }}>{s.section}</td>
                      <td style={{ padding: "3px 0", fontFamily: "var(--mono)", fontSize: 11, color: STATE_COLOR[s.state] }} data-testid={`ledger-${s.section}`}>
                        {s.state}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {ledger.entryLevel && (
              <>
                <h3 style={{ fontSize: 13, color: "var(--fg)", marginTop: 14 }}>Components, per entry</h3>
                <p style={{ fontSize: 12, color: "var(--fg-dim)" }}>
                  Ledger v2: ownership is decided entry by entry. Orphaned means you deleted the entry and the memory of
                  that deletion is kept — rediscovery skips it until you decide. Tombstoned means never re-add.
                </p>
                <table style={{ fontSize: 13, borderCollapse: "collapse" }} data-testid="entry-ledger">
                  <tbody>
                    {ledger.componentEntries.map((e) => (
                      <tr key={e.id}>
                        <td style={{ padding: "3px 12px 3px 0", fontFamily: "var(--mono)", fontSize: 12 }}>{e.id}</td>
                        <td style={{ padding: "3px 12px 3px 0", fontFamily: "var(--mono)", fontSize: 11, color: STATE_COLOR[e.state] }} data-testid={`entry-${e.id}`}>
                          {e.state === "unattributed" ? "human-owned" : e.state}
                          {e.alsoTombstoned ? " · tombstoned" : ""}
                        </td>
                        <td style={{ padding: "3px 0" }}>
                          {e.state === "orphaned" && (
                            <>
                              <button
                                className="st-btn"
                                disabled={busy !== null}
                                aria-label={`Restore ${e.id} from the ownership panel`}
                                onClick={() => void resolveDeletion(e.id, "restore")}
                                data-testid={`ownership-restore-${e.id}`}
                              >
                                Restore
                              </button>{" "}
                              <button
                                className="st-btn st-btn--dashed"
                                disabled={busy !== null}
                                aria-label={`Never rediscover ${e.id}, from the ownership panel`}
                                onClick={() => void resolveDeletion(e.id, "tombstone")}
                                data-testid={`ownership-tombstone-${e.id}`}
                              >
                                Never rediscover
                              </button>
                            </>
                          )}
                          {(e.state === "tombstoned" || e.alsoTombstoned) && (
                            <button
                              className="st-btn st-btn--dashed"
                              disabled={busy !== null}
                              aria-label={`Remove the tombstone from ${e.id}`}
                              onClick={() => void clearTombstone(e.id)}
                              data-testid={`ownership-untombstone-${e.id}`}
                            >
                              Remove tombstone
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {ledger.awaitingAuthorship.length > 0 && (
              <>
                <h3 style={{ fontSize: 13, color: "var(--fg)", marginTop: 14 }}>Awaiting authorship</h3>
                <p style={{ fontSize: 12, color: "var(--fg-dim)" }}>
                  The tool never writes these; they are yours. Sections you have since authored show above as human-authored.
                </p>
                <ul style={{ fontSize: 12, fontFamily: "var(--mono)", color: "var(--fg-body)", paddingLeft: 18 }}>
                  {ledger.awaitingAuthorship.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </>
            )}
          </>
        ) : (
          <p style={{ fontSize: 13, color: "var(--fg-dim)" }}>No contract loaded.</p>
        )}
        <RediscoveryReport />
      </div>
    </section>
  );
}
