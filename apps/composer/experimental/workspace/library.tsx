"use client";

/**
 * The Composition Library: the first application integration of the approved canvas-first workspace
 * (docs/repositioning/prototypes/composer-workspace.html, owner decisions 11 and 18). Read-only.
 *
 * Real: the packaged compositions and their versions (versions.ts), each version re-checked against its
 * declared scenarios on load (recheck), a host per version (createHost) that governs every instance the
 * canvas shows, rendering through Composer's own canvas and Astryx registry (the Preview path), the
 * refusal and needs-recheck states as the host reports them, and the selection kept in experimental
 * storage (storage.ts).
 * Not here: authoring (Compose), running flows and actions (Playground), publishing. They are named in the
 * workspace bar as not yet available, never as controls.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { A2uiCanvas, type A2uiClientAction } from "@dspack-studio/a2ui-ingest";
import { versionKey, type CompositionDefinition, type Governor, type Host, type ShowResult } from "@dspack-studio/composer-core/compositions";
import { canvasScopeFor, registryFor } from "../../app/registries";
import { checkVersion, governorFor, hostFor, loadLibrary, type LoadedLibrary, type VersionCheck } from "./runtime";
import { browserStore, DEFAULT_PREFS, readRecord, writeRecord, type LibraryPrefs, type ReadResult } from "./storage";

type Json = Record<string, any>;
type WhatIf = "none" | "four-options";
type Layout = "wide" | "medium" | "narrow";
type Panel = "library" | "inspector";

const PURPOSE: Record<string, string> = {
  "data-collection": "Collect information",
  "transactional-review": "Review before a transaction",
  "destructive-action": "Confirm a consequential action",
};
const purposeLabel = (p: string) => PURPOSE[p] ?? p;
const short = (h: string) => h.slice(0, 12);
const STAGE: Record<string, string> = {
  lint: "the design system's rules",
  data: "the data checks",
  state: "the state's guard",
  expand: "expansion",
  emit: "emission",
  attach: "input and payload attachment",
  layout: "the binding layout",
  gates: "the catalog gates",
};

function useLayout(): Layout {
  const read = (): Layout => (typeof window === "undefined" ? "medium" : window.matchMedia("(min-width: 1440px)").matches ? "wide" : window.matchMedia("(min-width: 900px)").matches ? "medium" : "narrow");
  const [layout, setLayout] = useState<Layout>(read);
  useEffect(() => {
    const queries = ["(min-width: 1440px)", "(min-width: 900px)"].map((q) => window.matchMedia(q));
    const update = () => setLayout(read());
    queries.forEach((q) => q.addEventListener("change", update));
    return () => queries.forEach((q) => q.removeEventListener("change", update));
  }, []);
  return layout;
}

interface Ready {
  loaded: LoadedLibrary;
  governors: Map<WhatIf, Governor>;
  checks: Map<string, VersionCheck>;
  hosts: Map<string, Host>;
  storage: ReadResult<LibraryPrefs>["status"];
}

export function LibraryWorkspace() {
  const layout = useLayout();
  const [ready, setReady] = useState<Ready | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<LibraryPrefs>(DEFAULT_PREFS);
  const [open, setOpen] = useState<Record<Panel, boolean>>({ library: true, inspector: false });
  const [whatIf, setWhatIf] = useState<WhatIf>("none");
  const [shown, setShown] = useState<ShowResult | null>(null);
  const [showing, setShowing] = useState(false);
  const [recheckNote, setRecheckNote] = useState<VersionCheck | null>(null);
  const [lastAction, setLastAction] = useState<{ name: string; context: Json; consequential: boolean } | null>(null);
  const [filter, setFilter] = useState("");
  const [announce, setAnnounce] = useState("");
  const request = useRef(0);
  const canvasHeading = useRef<HTMLHeadingElement>(null);
  const toggles = useRef<Record<Panel, HTMLButtonElement | null>>({ library: null, inspector: null });
  const panels = useRef<Record<Panel, HTMLElement | null>>({ library: null, inspector: null });

  // Load: the packaged versions, each re-checked under the packaged rules, a host per version.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const store = browserStore();
        const stored = readRecord("library", store);
        const governor = await governorFor("none");
        const loaded = await loadLibrary();
        const checks = new Map<string, VersionCheck>();
        const hosts = new Map<string, Host>();
        for (const entry of loaded.library.entries) {
          for (const v of entry.versions) {
            const check = await checkVersion(governor, v, store);
            checks.set(versionKey(v.id, v.version), check);
            hosts.set(versionKey(v.id, v.version), await hostFor(governor, check));
          }
        }
        if (cancelled) return;
        const first = loaded.library.entries[0];
        const known = stored.value.composition ? loaded.library.get(stored.value.composition, stored.value.version ?? 0) : undefined;
        const start: LibraryPrefs = known
          ? stored.value
          : { ...DEFAULT_PREFS, panel: stored.value.panel, composition: first?.id ?? null, version: first ? (first.approved ?? first.versions[0]!).version : null };
        setPrefs(start);
        // A phone starts on the canvas alone; wider screens reopen the side panel last used.
        const narrow = !window.matchMedia("(min-width: 900px)").matches;
        setOpen(narrow ? { library: false, inspector: false } : start.panel === "inspector" ? { library: false, inspector: true } : { library: true, inspector: false });
        setReady({ loaded, governors: new Map([["none", governor]]), checks, hosts, storage: stored.status });
      } catch (error) {
        if (!cancelled) setFailed(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Narrow screens start with the canvas alone.
  const narrowSeen = useRef(false);
  useEffect(() => {
    if (layout === "narrow" && !narrowSeen.current) {
      narrowSeen.current = true;
      setOpen({ library: false, inspector: false });
    }
  }, [layout]);

  const definition: CompositionDefinition | undefined = ready && prefs.composition && prefs.version ? ready.loaded.library.get(prefs.composition, prefs.version) : undefined;
  const key = definition ? versionKey(definition.id, definition.version) : "";
  const check = ready?.checks.get(key);
  const scenario = definition?.scenarios.find((s) => s.id === prefs.scenario) ?? definition?.scenarios[0];

  const persist = useCallback((next: LibraryPrefs) => {
    setPrefs(next);
    writeRecord("library", next);
  }, []);

  // Show the selection through its version's host. Late answers to earlier selections are dropped.
  useEffect(() => {
    if (!ready || !definition || !scenario) return;
    const mine = ++request.current;
    const host = ready.hosts.get(key)!;
    setShowing(true);
    setLastAction(null);
    void host.show(definition.id, { data: scenario.data as Json, ...(prefs.state ? { state: prefs.state } : {}) }).then((r) => {
      if (mine !== request.current) return;
      setShown(r);
      setShowing(false);
      const what = `${definition.name} v${definition.version}, scenario ${scenario.id}`;
      setAnnounce(r.ok ? `Showing ${what}: ${r.instance.state}.` : `${what} is not shown: ${r.refusal.stage === "needs-recheck" ? "it needs a re-check" : "the rules refuse it"}.`);
    });
  }, [ready, key, scenario?.id, prefs.state, whatIf]);

  const select = (composition: string) => {
    if (!ready) return;
    const entry = ready.loaded.library.entry(composition)!;
    persist({ ...prefs, composition, version: (entry.approved ?? entry.versions[0]!).version, scenario: null, state: null });
    setRecheckNote(null);
    if (layout === "narrow") {
      setOpen({ library: false, inspector: false });
      setTimeout(() => canvasHeading.current?.focus(), 0);
    }
  };

  const togglePanel = (panel: Panel) => {
    const next = !open[panel];
    const other: Panel = panel === "library" ? "inspector" : "library";
    // Below 1440 px, one side panel at a time (decision 18); on a phone, panels are drawers over the canvas.
    setOpen(layout === "wide" ? { ...open, [panel]: next } : { [panel]: next, [other]: false } as Record<Panel, boolean>);
    if (next) {
      persist({ ...prefs, panel });
      if (layout === "narrow") setTimeout(() => panels.current[panel]?.focus(), 0);
    }
  };

  const closeDrawer = (panel: Panel) => {
    setOpen({ ...open, [panel]: false });
    toggles.current[panel]?.focus();
  };

  const changeRules = async (next: WhatIf) => {
    if (!ready) return;
    const governor = ready.governors.get(next) ?? (await governorFor(next));
    ready.governors.set(next, governor);
    for (const host of ready.hosts.values()) host.setGovernor(governor);
    setRecheckNote(null);
    setWhatIf(next);
  };

  const recheckNow = async () => {
    if (!ready || !definition) return;
    const governor = ready.governors.get(whatIf)!;
    // A what-if is never stored: its re-check writes no approval record.
    const result = await checkVersion(governor, definition, whatIf === "none" ? browserStore() : null);
    if (result.approval) ready.hosts.get(key)!.approve(definition.id, result.approval);
    if (whatIf === "none") ready.checks.set(key, result);
    setRecheckNote(result);
    // A new object, so the selection is shown again through the (possibly re-approved) host.
    setReady({ ...ready });
  };

  const onAction = useCallback(
    (action: A2uiClientAction) => {
      if (!ready || !definition) return;
      const a = action as unknown as { name: string; surfaceId: string; sourceComponentId: string; context?: Json };
      const host = ready.hosts.get(key)!;
      // Shown in its recordable form only: a sensitive value is replaced, never displayed or kept.
      const recordable = host.redact({ name: a.name, surfaceId: a.surfaceId, sourceComponentId: a.sourceComponentId, context: a.context ?? {} });
      const declared = definition.actions.find((x) => x.name === a.name);
      setLastAction({ name: a.name, context: recordable.context, consequential: !!declared?.consequential });
      setAnnounce(`${a.name} was pressed. In the Library actions are shown, not run.`);
    },
    [ready, key, definition],
  );

  // Escape closes a drawer on a phone.
  useEffect(() => {
    if (layout !== "narrow") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const which = (Object.keys(open) as Panel[]).find((p) => open[p]);
      if (which) closeDrawer(which);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const entries = useMemo(() => {
    const all = ready?.loaded.library.entries ?? [];
    const q = filter.trim().toLowerCase();
    if (!q) return all;
    return all.filter((e) => {
      const v = e.approved ?? e.versions[0]!;
      return [v.name, v.summary, ...v.states.map((s) => purposeLabel(s.purpose))].join(" ").toLowerCase().includes(q);
    });
  }, [ready, filter]);

  if (failed) {
    return (
      <Frame layout={layout} open={open} bar={<Bar />}>
        <div className="cl-canvas" role="alert">
          <Empty title="The Library could not start">{failed}</Empty>
        </div>
      </Frame>
    );
  }
  if (!ready) {
    return (
      <Frame layout={layout} open={open} bar={<Bar />}>
        <div className="cl-canvas" aria-busy="true">
          <p className="cl-loading" role="status">Preparing the governed pipeline: loading the compositions and re-checking every version…</p>
        </div>
      </Frame>
    );
  }

  const entry = definition ? ready.loaded.library.entry(definition.id) : undefined;
  const governed = whatIf === "none";
  const toolchain = ready.governors.get(whatIf)!.toolchain;

  const libraryPanel = (
    <aside
      id="cl-library"
      className={`cl-panel cl-panel--library${open.library ? " cl-panel--open" : ""}`}
      aria-label="Compositions"
      hidden={!open.library}
      tabIndex={-1}
      ref={(el) => void (panels.current.library = el)}
    >
      <div className="cl-panel__head">
        <h2 className="cl-h">Compositions</h2>
        {layout === "narrow" && (
          <button className="st-btn" onClick={() => closeDrawer("library")}>
            Close
          </button>
        )}
      </div>
      <p className="cl-dim">Packaged compositions for the Astryx sample. Each one is a definition the agent fills with data; every instance is governed.</p>
      <label className="cl-label" htmlFor="cl-filter">
        Filter by name or purpose
      </label>
      <input id="cl-filter" className="af-input" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="For example “review”" />
      {entries.length === 0 ? (
        <Empty title="No composition matches">Clear the filter to see all {ready.loaded.library.entries.length}.</Empty>
      ) : (
        <ul className="cl-list" data-testid="library-list">
          {entries.map((e) => {
            const shownVersion = e.approved ?? e.versions[0]!;
            const selected = e.id === definition?.id;
            return (
              <li key={e.id}>
                <button className={`cl-item${selected ? " cl-item--selected" : ""}`} aria-current={selected ? "true" : undefined} onClick={() => select(e.id)} data-testid={`library-item-${e.id}`}>
                  <span className="cl-item__name">{shownVersion.name}</span>
                  <span className="cl-item__summary">{shownVersion.summary}</span>
                  <span className="cl-item__versions">
                    {e.versions.map((v) => (
                      <span key={v.version} className={`cl-badge${v.status === "approved" ? " cl-badge--ok" : ""}`}>
                        v{v.version} · {v.status === "approved" ? "Approved" : "Draft"}
                      </span>
                    ))}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {ready.loaded.issues.length > 0 && (
        <details className="cl-issues">
          <summary>{ready.loaded.issues.length} packaged version(s) left out</summary>
          <ul>
            {ready.loaded.issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </details>
      )}
    </aside>
  );

  const canvas = (
    <section className="cl-canvas" aria-labelledby="cl-canvas-title">
      {!definition || !entry ? (
        <Empty title="Nothing selected">Choose a composition from the list.</Empty>
      ) : (
        <>
          <div className="cl-canvas__head">
            <nav aria-label="Breadcrumb" className="cl-crumbs">
              <span>Library</span>
              <span aria-hidden="true"> / </span>
              <span aria-current="page">{definition.name}</span>
            </nav>
            <h2 id="cl-canvas-title" className="cl-title" tabIndex={-1} ref={canvasHeading}>
              {definition.name}{" "}
              <span className={`cl-badge${definition.status === "approved" ? " cl-badge--ok" : ""}`}>
                v{definition.version} · {definition.status === "approved" ? "Approved" : "Draft"}
              </span>
            </h2>
            <div className="cl-controls">
              {entry.versions.length > 1 && (
                <fieldset className="cl-seg">
                  <legend className="cl-label">Version</legend>
                  {entry.versions.map((v) => (
                    <label key={v.version} className={`cl-seg__opt${v.version === definition.version ? " cl-seg__opt--on" : ""}`}>
                      <input type="radio" name="cl-version" checked={v.version === definition.version} onChange={() => persist({ ...prefs, version: v.version, state: null })} />v{v.version} {v.status === "approved" ? "Approved" : "Draft"}
                    </label>
                  ))}
                </fieldset>
              )}
              <div className="cl-field">
                <label className="cl-label" htmlFor="cl-scenario">
                  Scenario
                </label>
                <select id="cl-scenario" className="af-select" value={scenario?.id ?? ""} onChange={(e) => persist({ ...prefs, scenario: e.target.value })} data-testid="scenario-select">
                  {definition.scenarios.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.id}
                      {s.expect === "refused" ? " (the rules refuse it)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="cl-field">
                <label className="cl-label" htmlFor="cl-state">
                  State
                </label>
                <select id="cl-state" className="af-select" value={prefs.state ?? ""} onChange={(e) => persist({ ...prefs, state: e.target.value || null })} data-testid="state-select">
                  <option value="">Chosen by the data</option>
                  {definition.states.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.id}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          {definition.status === "draft" && (
            <p className="cl-note" data-testid="draft-note">
              A draft: newer than approved v{entry.approved?.version}, not approved for use. It is previewed under the same checks, and v{entry.approved?.version} is unchanged.
            </p>
          )}
          {!governed && (
            <p className="cl-note cl-note--warn" role="status">
              What-if, this session only: a review now needs four options. Nothing is saved, and the packaged rules are unchanged.
            </p>
          )}
          <CanvasBody shown={shown} showing={showing} definition={definition} onAction={onAction} catalog={ready.governors.get(whatIf)!.catalog("0.9.1")} recheck={recheckNow} recheckNote={recheckNote} />
          {lastAction && (
            <p className="cl-note" role="status" data-testid="action-note">
              <strong>{lastAction.name}</strong> would send <code>{JSON.stringify(lastAction.context)}</code>
              {lastAction.consequential ? ". It is consequential, accepted once and only from this confirmation." : "."} In the Library actions are shown, not run: running a flow belongs to the Playground, which is not available yet.
            </p>
          )}
        </>
      )}
    </section>
  );

  const instance = shown?.ok ? shown.instance : null;
  const inspector = (
    <aside
      id="cl-inspector"
      className={`cl-panel cl-panel--inspector${open.inspector ? " cl-panel--open" : ""}`}
      aria-label="Inspector"
      hidden={!open.inspector}
      tabIndex={-1}
      ref={(el) => void (panels.current.inspector = el)}
      data-testid="inspector"
    >
      <div className="cl-panel__head">
        <h2 className="cl-h">Inspector</h2>
        {layout === "narrow" && (
          <button className="st-btn" onClick={() => closeDrawer("inspector")}>
            Close
          </button>
        )}
      </div>
      {definition && (
        <>
          <p className="cl-crumbs" aria-label="Inspecting">
            {definition.name} · v{definition.version}
          </p>
          <Section title="Composition">
            <p className="cl-text">{definition.summary}</p>
            <Facts
              rows={[
                ["Id", <code key="id">{definition.id}</code>],
                ["Version", `v${definition.version} · ${definition.status === "approved" ? "Approved, immutable" : "Draft"}`],
                ["Versions", entry!.versions.map((v) => `v${v.version} ${v.status}`).join(", ")],
                ["Definition hash", check?.approval ? short(check.approval.pins.compositionSha256) : "not approved"],
              ]}
            />
          </Section>
          <Section title="Governance">
            {check?.approval && governed ? (
              <p className="cl-ok" data-testid="approval-status">
                Re-checked on load: {check.scenarios.filter((s) => s.matches).length} of {check.scenarios.length} scenarios behave as declared under the packaged rules.
              </p>
            ) : (
              <p className="cl-bad" data-testid="approval-status">
                {governed ? "Not approved: a scenario does not behave as declared." : "Under the what-if rules this version needs a re-check before anything runs."}
              </p>
            )}
            {check && (
              <table className="cl-table">
                <thead>
                  <tr>
                    <th scope="col">Scenario</th>
                    <th scope="col">Declared</th>
                    <th scope="col">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {(recheckNote && !governed ? recheckNote.scenarios : check.scenarios).map((s) => (
                    <tr key={s.id}>
                      <td>{s.id}</td>
                      <td>{s.expect === "refused" ? `refused by ${s.refusedBy}` : "shown"}</td>
                      <td className={s.matches ? "cl-ok" : "cl-bad"}>{s.matches ? "as declared" : `not as declared (${s.outcome})`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {check && (
              <p className="cl-dim" data-testid="device-record">
                {check.previous.status === "none"
                  ? "On this device: the first approval of this version was recorded."
                  : check.previous.status === "current"
                    ? "On this device: matches the approval recorded earlier."
                    : `On this device: the earlier approval was made under another ${check.previous.changed.join(", ")}; re-checked now.`}
              </p>
            )}
            <Facts
              rows={[
                ["Contract", `Astryx reference · ${short(ready.governors.get(whatIf)!.contractSha256)}`],
                ["Toolchain", `lint ${toolchain.lint} · emit ${toolchain.emit} · runtime ${toolchain.runtime}`],
              ]}
            />
            <button className="st-btn" aria-pressed={!governed} onClick={() => changeRules(governed ? "four-options" : "none")} data-testid="what-if">
              {governed ? "What-if: require four options" : "Restore the packaged rules"}
            </button>
            <p className="cl-dim">A session-only change to one rule, to see a needs-recheck state. Nothing is stored.</p>
          </Section>
          {instance && (
            <Section title="This instance">
              <Facts
                rows={[
                  ["State", `${instance.state}${prefs.state ? " (requested)" : " (chosen by the data)"}`],
                  ["Purpose", purposeLabel(instance.purpose)],
                  ["Inputs", instance.inputs.length ? instance.inputs.map((i) => `${i.name}${i.sensitive ? " (sensitive: never kept)" : ""}`).join(", ") : "none"],
                  ["Instantiation", `${instance.timings.totalMs.toFixed(1)} ms in this browser`],
                ]}
              />
              <table className="cl-table">
                <thead>
                  <tr>
                    <th scope="col">Action</th>
                    <th scope="col">Sends</th>
                  </tr>
                </thead>
                <tbody>
                  {instance.actions.map((a) => (
                    <tr key={a.componentId}>
                      <td>
                        {a.name}
                        {a.consequential ? " (consequential)" : ""}
                      </td>
                      <td>
                        <code>{JSON.stringify({ ...a.payload, ...Object.fromEntries(a.carries.map((c) => [c, "typed"])) })}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}
          {ready.storage !== "ok" && ready.storage !== "missing" && (
            <Section title="Workspace settings">
              <p className="cl-dim" data-testid="storage-note">
                {ready.storage === "unavailable"
                  ? "Browser storage is unavailable, so the selection is kept for this session only."
                  : ready.storage === "incompatible"
                    ? "Saved settings come from another version of Composer. They are kept as they are, and the defaults are used."
                    : "Saved settings could not be read. The defaults are used, and the earlier record is kept aside."}
              </p>
            </Section>
          )}
        </>
      )}
    </aside>
  );

  return (
    <Frame
      layout={layout}
      open={open}
      bar={
        <Bar>
          {(["library", "inspector"] as Panel[]).map((p) => (
            <button
              key={p}
              ref={(el) => void (toggles.current[p] = el)}
              className={`st-btn${open[p] ? " st-btn--active" : ""}`}
              aria-expanded={open[p]}
              aria-controls={`cl-${p}`}
              onClick={() => togglePanel(p)}
              data-testid={`toggle-${p}`}
            >
              {p === "library" ? "Compositions" : "Inspector"}
            </button>
          ))}
        </Bar>
      }
    >
      {layout === "narrow" && (open.library || open.inspector) && <div className="cl-scrim" aria-hidden="true" onClick={() => closeDrawer(open.library ? "library" : "inspector")} />}
      {libraryPanel}
      {canvas}
      {inspector}
      <div className="cl-sr" aria-live="polite">
        {announce}
      </div>
    </Frame>
  );
}

function CanvasBody({
  shown,
  showing,
  definition,
  onAction,
  catalog,
  recheck,
  recheckNote,
}: {
  shown: ShowResult | null;
  showing: boolean;
  definition: CompositionDefinition;
  onAction: (a: A2uiClientAction) => void;
  catalog: Json;
  recheck: () => void;
  recheckNote: VersionCheck | null;
}) {
  const registry = useMemo(() => registryFor("astryx", catalog), [catalog]);
  const scope = canvasScopeFor("astryx");
  const frame = (instance: NonNullable<Extract<ShowResult, { ok: true }>["instance"]>, dimmed = false) => (
    <div {...scope.attrs} className={`cl-frame${dimmed ? " cl-frame--kept" : ""}`} style={{ background: scope.background }} data-project-canvas="composer" data-surface={instance.surfaceId} inert={dimmed || undefined}>
      <A2uiCanvas key={instance.surfaceId} catalog={catalog} registry={registry} messages={instance.messages as unknown[]} onAction={dimmed ? undefined : onAction} />
    </div>
  );
  if (!shown) return <p className="cl-loading" role="status">Instantiating…</p>;
  if (shown.ok) {
    return (
      <>
        <p className="cl-status" data-testid="instance-status">
          State <strong>{shown.instance.state}</strong> · {purposeLabel(shown.instance.purpose)} · <span className="cl-ok">governed: S1–S3 and A1–A3 pass</span>
          {showing ? " · updating…" : ""}
        </p>
        {frame(shown.instance)}
      </>
    );
  }
  const refusal = shown.refusal as Json;
  const rule = refusal.failures?.[0]?.rule as string | undefined;
  const needsRecheck = refusal.stage === "needs-recheck";
  return (
    <>
      <div className={`cl-refusal${needsRecheck ? " cl-refusal--recheck" : ""}`} role="status" data-testid="refusal" data-stage={refusal.stage}>
        <p className="cl-refusal__title">{needsRecheck ? "Needs re-check before anything runs" : `Not shown: refused by ${STAGE[refusal.stage] ?? refusal.stage}`}</p>
        {rule && (
          <p>
            <code>{rule}</code>
          </p>
        )}
        <p>{needsRecheck ? `The rules changed since ${definition.name} v${definition.version} was approved, so the host shows nothing new from it until its scenarios pass again.` : String(refusal.reason)}</p>
        {needsRecheck && (
          <button className="st-btn" onClick={recheck} data-testid="recheck">
            Re-check this version
          </button>
        )}
        {recheckNote && !recheckNote.approval && (
          <p data-testid="recheck-failed">
            Re-check failed: {recheckNote.scenarios.filter((s) => !s.matches).map((s) => s.id).join(", ")} no longer behave as declared. This version stays unapproved under these rules, and nothing it showed before is replaced.
          </p>
        )}
      </div>
      {shown.kept && (
        <>
          <p className="cl-dim">The last valid instance, which stays on screen in a running flow:</p>
          {frame(shown.kept, true)}
        </>
      )}
    </>
  );
}

function Bar({ children }: { children?: ReactNode }) {
  return (
    <div className="cl-bar">
      <nav aria-label="Workspace" className="cl-dest">
        <span className="cl-dest__item cl-dest__item--current" aria-current="page">
          Library
        </span>
        <span className="cl-dest__item cl-dest__item--later" aria-disabled="true">
          Compose · Playground · Publish <small>not yet available</small>
        </span>
      </nav>
      <div className="cl-bar__tools">{children}</div>
    </div>
  );
}

function Frame({ layout, open, bar, children }: { layout: Layout; open: Record<Panel, boolean>; bar: ReactNode; children: ReactNode }) {
  return (
    <div className="cl" data-testid="composition-library" data-layout={layout} data-library={open.library ? "open" : "closed"} data-inspector={open.inspector ? "open" : "closed"}>
      <style>{CSS}</style>
      {bar}
      <div className="cl-body">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="cl-section">
      <h3 className="cl-label">{title}</h3>
      {children}
    </section>
  );
}

function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="cl-facts">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="cl-empty">
      <p className="cl-empty__title">{title}</p>
      <p>{children}</p>
    </div>
  );
}

const CSS = `
.cl { --cl-panel-l: 272px; --cl-panel-r: 340px; display: flex; flex-direction: column; min-height: calc(100vh - 60px); color: var(--fg-body); }
.cl :focus-visible { outline: 2px solid var(--green-bright); outline-offset: 2px; }
.cl-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 10px max(16px, env(safe-area-inset-left)); border-bottom: 1px solid var(--line); }
.cl-dest { display: flex; gap: 4px 14px; flex-wrap: wrap; align-items: baseline; min-width: 0; }
.cl-dest__item { font-family: var(--mono); font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; padding: 4px 0; }
.cl-dest__item--current { color: var(--fg); border-bottom: 2px solid var(--green); }
.cl-dest__item--later { color: var(--fg-faint); }
.cl-dest__item--later small { font-size: 10px; letter-spacing: 0.04em; text-transform: none; margin-left: 4px; }
.cl-bar__tools { display: flex; gap: 6px; margin-left: auto; }
.cl-body { position: relative; flex: 1; display: grid; grid-template-columns: minmax(0, 1fr); min-height: 0; }
.cl[data-layout="wide"] .cl-body, .cl[data-layout="medium"] .cl-body { grid-template-columns: auto minmax(0, 1fr) auto; }
.cl-panel { background: var(--bg-1); border-color: var(--line); border-style: solid; border-width: 0; padding: 16px; overflow: auto; min-width: 0; outline: none; }
.cl-panel[hidden] { display: none; }
.cl-panel--library { width: var(--cl-panel-l); border-right-width: 1px; grid-column: 1; grid-row: 1; }
.cl-canvas { grid-column: 2; grid-row: 1; }
.cl-panel--inspector { width: var(--cl-panel-r); border-left-width: 1px; grid-column: 3; grid-row: 1; }
.cl[data-layout="narrow"] .cl-canvas { grid-column: 1; }
.cl-scrim { position: absolute; inset: 0; z-index: 15; background: rgba(0, 0, 0, 0.45); }
.cl[data-layout="narrow"] .cl-panel { position: absolute; inset: 0 auto 0 0; width: min(88vw, 380px); z-index: 20; box-shadow: var(--shadow-menu); }
.cl[data-layout="narrow"] .cl-panel--inspector { inset: 0 0 0 auto; }
.cl-panel__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.cl-h { font-family: var(--hl); font-weight: 600; text-transform: uppercase; font-size: 18px; color: var(--fg); margin: 0; }
.cl-label { display: block; font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--fg-dim); margin: 0 0 6px; padding: 0; }
.cl-dim { color: var(--fg-dim); font-size: 13px; line-height: 1.5; margin: 8px 0; }
.cl-body p { overflow-wrap: anywhere; }
.cl-list { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 8px; }
.cl-item { width: 100%; text-align: left; display: grid; gap: 6px; padding: 12px; border: 1px solid var(--line); border-radius: 3px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.cl-item:hover { border-color: var(--fg-faint); }
.cl-item--selected { border-color: var(--green); box-shadow: inset 3px 0 0 var(--green); }
.cl-item__name { color: var(--fg); font-weight: 600; font-size: 15px; }
.cl-item__summary { font-size: 13px; color: var(--fg-dim); line-height: 1.45; }
.cl-item__versions { display: flex; gap: 6px; flex-wrap: wrap; }
.cl-badge { display: inline-block; font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.06em; text-transform: uppercase; padding: 2px 7px; border: 1px solid var(--line); border-radius: 2px; color: var(--fg-dim); vertical-align: middle; }
.cl-badge--ok { border-color: var(--green-deep); color: var(--green-bright); }
.cl-canvas { padding: 16px max(16px, env(safe-area-inset-left)) 32px; min-width: 0; overflow: auto; }
.cl-canvas__head { display: grid; gap: 10px; margin-bottom: 12px; }
.cl-crumbs { font-family: var(--mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--fg-dim); margin: 0; }
.cl-title { font-family: var(--hl); font-weight: 600; text-transform: uppercase; color: var(--fg); font-size: clamp(20px, 2.4vw, 28px); margin: 0; outline: none; }
.cl-controls { display: flex; flex-wrap: wrap; gap: 12px 16px; align-items: flex-end; }
.cl-field { display: grid; min-width: 0; }
.cl-field .af-select { min-width: 12rem; max-width: 100%; }
.cl-seg { border: 0; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.cl-seg legend { width: 100%; }
.cl-seg__opt { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 2px; font-family: var(--mono); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; cursor: pointer; }
.cl-seg__opt input { margin: 0; accent-color: var(--green); }
.cl-seg__opt--on { border-color: var(--green); color: var(--fg); }
.cl-status { font-size: 13px; color: var(--fg-dim); margin: 0 0 10px; }
.cl-ok { color: var(--green-bright); }
.cl-bad { color: var(--err, #d9826b); }
p.cl-ok, p.cl-bad { font-size: 14px; line-height: 1.5; margin: 0 0 8px; }
.cl-note { font-size: 13px; line-height: 1.5; border-left: 3px solid var(--fg-faint); padding: 8px 12px; margin: 0 0 12px; background: var(--bg-1); }
.cl-note--warn { border-left-color: var(--warn, #c9a35a); }
.cl-note code, .cl-refusal code, .cl-table code { font-family: var(--mono); font-size: 12px; overflow-wrap: anywhere; }
.cl-frame { border: 1px solid var(--line); border-radius: 4px; padding: clamp(12px, 2.5vw, 24px); color: #111; }
.cl-frame--kept { opacity: 0.55; margin-top: 8px; }
.cl-refusal { border: 1px solid var(--line); border-left: 4px solid var(--err, #d9826b); border-radius: 3px; padding: 12px 14px; margin-bottom: 12px; background: var(--bg-1); display: grid; gap: 6px; }
.cl-refusal p { margin: 0; font-size: 14px; line-height: 1.5; }
.cl-refusal--recheck { border-left-color: var(--warn, #c9a35a); }
.cl-refusal__title { color: var(--fg); font-weight: 600; }
.cl-section { border-top: 1px solid var(--line); padding-top: 12px; margin-top: 12px; }
.cl-body .cl-section .st-btn { margin-top: 4px; }
.cl-facts { display: grid; gap: 6px; margin: 8px 0; font-size: 13px; }
.cl-facts div { display: grid; grid-template-columns: 7.5rem minmax(0, 1fr); gap: 8px; }
.cl-facts dt { color: var(--fg-dim); }
.cl-facts dd { margin: 0; overflow-wrap: anywhere; }
.cl-table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin: 8px 0; }
.cl-table th, .cl-table td { text-align: left; padding: 5px 6px 5px 0; border-bottom: 1px solid var(--line-soft); vertical-align: top; }
.cl-table th { font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--fg-dim); font-weight: 500; }
.cl-text { font-size: 14px; line-height: 1.5; margin: 0 0 8px; }
.cl-empty { border: 1px dashed var(--line); border-radius: 3px; padding: 20px; margin-top: 12px; }
.cl-empty__title { color: var(--fg); font-weight: 600; margin: 0 0 4px; }
.cl-loading { color: var(--fg-dim); padding: 24px 0; }
.cl-issues { margin-top: 12px; font-size: 12px; color: var(--fg-dim); }
.cl-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (prefers-reduced-motion: reduce) { .cl * { transition: none !important; } }
`;
