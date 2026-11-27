"use client";

/**
 * The Composition Library: the first application integration of the approved canvas-first workspace
 * (docs/repositioning/prototypes/composer-workspace.html, owner decisions 11 and 18), refined designer-first
 * (D0, docs/repositioning/DESIGNER-FIRST-PROPOSAL.md), with the first authoring increment (A1 to A4,
 * docs/repositioning/m1/authoring/README.md): create and discard a draft, edit its details, parameters and
 * examples (editors.tsx), run its checks, and approve it on this device (authoring.ts).
 *
 * What a designer meets first answers five questions: what am I designing, what does it look like, how does
 * it behave with different data, does it satisfy the design rules, and what can I do next. Ids, hashes,
 * gate names, toolchain versions and raw payloads stay available under "Technical details", closed.
 *
 * Real: the packaged compositions and their versions (versions.ts), each version checked against its
 * declared examples on load (recheck), a host per version (createHost) that governs every instance the
 * canvas shows, rendering through Composer's own canvas and Astryx registry (the Preview path), the
 * refusal and needs-a-new-check states as the host reports them, and the selection and first-run guide kept
 * in experimental storage (storage.ts).
 * Not here: structure editing (templates, states, inputs, actions), running flows and actions (Playground),
 * publishing. They are named in the header as not yet available, never offered as controls.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { A2uiCanvas, type A2uiClientAction } from "@dspack-studio/a2ui-ingest";
import {
  createHost,
  createSessionId,
  findInStructure,
  guardHolds,
  instanceElements,
  statesWithElement,
  structureOf,
  instantiate,
  pinsFor,
  redactEvent,
  samePins,
  surfaceIdFor,
  versionKey,
  type CompositionDefinition,
  type Governor,
  type Guard,
  type Host,
  type Instance,
  type Scenario,
  type ShowResult,
} from "@dspack-studio/composer-core/compositions";
import { canvasScopeFor, registryFor } from "../../app/registries";
import { checkVersion, governorFor, hostFor, loadLibrary, type LoadedLibrary, type VersionCheck } from "./runtime";
import { approveVersion, createDraft, discardDraftVersion, editDraft, plainDataReason } from "./authoring";
import { DetailsEditor, ExamplesEditor, ParametersEditor } from "./editors";
import { applyInputChange, describeInteractionChanges, interactionIssues, withoutMasks } from "./interaction";
import { ElementInspector, type ItemContext } from "./element-inspector";
import { SelectionLayer } from "./selection-layer";
import { COMPONENT_LABEL, elementName, StructurePanel } from "./structure-panel";
import { TemplateTools } from "./template-tools";
import { applyContent, applyInsert, assignId as assignElementId, contentProblem, moveNode, plainTemplateIssue, removeNode, renameId as renameElementId, statesShowing, type Insertable } from "./template-editing";
import { uniqueId, type Position } from "@dspack-studio/composer-core/compositions";
import { definitionDifferences, RULE_LEADS, SAMPLE_NAMES, VERSION_CHANGES } from "./presentation";
import { browserStore, DEFAULT_PREFS, KEYS, readRecord, writeRecord, type LibraryPrefs, type ReadResult, type StoredAuthorization } from "./storage";
import { applyWithdrawals, restoreApproval, withdrawApproval } from "./withdrawal";

type Json = Record<string, any>;
type WhatIf = "none" | "four-options";
type Layout = "wide" | "medium" | "narrow";
type Panel = "library" | "inspector";
/** A draft adds an Examples tab; its Design tab is editable (M1 authoring). */
type Tab = "design" | "examples" | "checks";
type Notice = { tone: "ok" | "warn" | "bad"; text: string };

// ---- Plain language ----------------------------------------------------------------------------------------

const PURPOSE: Record<string, string> = {
  "data-collection": "Collect information",
  "transactional-review": "Review before a transaction",
  "destructive-action": "Confirm a consequential action",
};
const purposeLabel = (p: string) => PURPOSE[p] ?? humanize(p);
const short = (h: string) => h.slice(0, 12);

/** "hotelId" -> "hotel id", "new_search" -> "new search", "rule.review-offers-alternatives" -> "review offers alternatives". */
function humanize(name: string): string {
  return name
    .replace(/^rule\./, "")
    .replace(/[_.-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
}
const sentence = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
/** An example's human name: its own `title`, else the sample label (presentation.ts), else its id in words. */
const scenarioName = (s: Scenario, compositionId: string) => s.title ?? SAMPLE_NAMES[compositionId]?.[s.id] ?? sentence(humanize(s.id));

/** A rule's rationale, without its parenthetical scope notes: the part a designer needs. */
function plainRationale(rationale: string | undefined): string | null {
  if (!rationale) return null;
  const cut = rationale.indexOf(" (");
  return (cut > 0 ? rationale.slice(0, cut) : rationale).trim();
}

function plainGuard(guard: Guard): string {
  if ("always" in guard) return "always applies";
  if ("present" in guard) return `needs ${humanize(guard.present)}`;
  if ("empty" in guard) return `needs no ${humanize(guard.empty)}`;
  if ("minItems" in guard) return `needs at least ${guard.minItems.min} ${humanize(guard.minItems.path)}`;
  return guard.all.map(plainGuard).join(" and ");
}

function plainValue(key: string, value: unknown): string {
  if (value === "[sensitive]") return `${humanize(key)} (private: not shown, never kept)`;
  if (value === "" || value === undefined) return `${humanize(key)} (empty)`;
  return `${humanize(key)} ${typeof value === "string" ? value : JSON.stringify(value)}`;
}

function typeLabel(spec: Json): string {
  const t = String(spec.type ?? "");
  if (t === "array") return "a list";
  if (t === "integer" || t === "number") return "a number";
  if (t === "object") return "a group of values";
  if (t === "boolean") return "yes or no";
  return "text";
}

/** The visible label of the component that sent an action, read from the instance's own messages. */
function controlLabel(instance: Instance | null, componentId: string): string | null {
  if (!instance) return null;
  for (const m of instance.messages as Json[]) {
    for (const c of (m.updateComponents?.components ?? []) as Json[]) {
      if (c.id === componentId) return typeof c.label === "string" ? c.label : typeof c.confirmLabel === "string" ? c.confirmLabel : null;
    }
  }
  return null;
}

// ---- Layout ------------------------------------------------------------------------------------------------

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

/** The app header's height, so the workspace can fill exactly the rest of the window (a fixed frame). */
function useHeaderHeight(): number {
  const [height, setHeight] = useState(60);
  useEffect(() => {
    const header = document.querySelector<HTMLElement>(".af-top");
    if (!header || typeof ResizeObserver === "undefined") return;
    const update = () => setHeight(header.offsetHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  return height;
}

function useTallEnough(): boolean {
  const read = () => typeof window === "undefined" || window.matchMedia("(min-height: 600px)").matches;
  const [tall, setTall] = useState(read);
  useEffect(() => {
    const q = window.matchMedia("(min-height: 600px)");
    const update = () => setTall(q.matches);
    q.addEventListener("change", update);
    return () => q.removeEventListener("change", update);
  }, []);
  return tall;
}

interface Ready {
  loaded: LoadedLibrary;
  governors: Map<WhatIf, Governor>;
  /** The latest check of each version under each rule set: what the canvas and the inspector both read (R2). */
  checks: Map<WhatIf, Map<string, VersionCheck>>;
  hosts: Map<string, Host>;
  storage: ReadResult<LibraryPrefs>["status"];
  /** Approvals withdrawn on this device (decision 34): an authorization decision, never a definition change. */
  authorization: StoredAuthorization;
}

/** The four guided examples of the first-run guide: each changes the selection, nothing else. */
const GUIDE: Array<{ id: string; title: string; detail: string; composition: string; version: number; scenario: string }> = [
  { id: "data", title: "See a screen with real data", detail: "Hotel results, filled with three hotels an agent found.", composition: "hotel-results", version: 1, scenario: "three" },
  { id: "rules", title: "See what the design rules prevent", detail: "The same screen with one hotel: not a real choice, so it is not shown.", composition: "hotel-results", version: 1, scenario: "one" },
  { id: "draft", title: "Compare a draft with the approved version", detail: "Version 2 rewords two pieces of text; “What changed” beside its status lists them. Version 1 stays approved and unchanged.", composition: "hotel-results", version: 2, scenario: "three" },
  { id: "confirm", title: "Try a confirmation step", detail: "Press Reserve: Composer shows what it would send. Nothing is booked.", composition: "hotel-results", version: 1, scenario: "confirm" },
];

export function LibraryWorkspace() {
  const layout = useLayout();
  const headerHeight = useHeaderHeight();
  const tall = useTallEnough();
  const [ready, setReady] = useState<Ready | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<LibraryPrefs>(DEFAULT_PREFS);
  const [open, setOpen] = useState<Record<Panel, boolean>>({ library: true, inspector: false });
  const [whatIf, setWhatIf] = useState<WhatIf>("none");
  const [shown, setShown] = useState<ShowResult | null>(null);
  const [showing, setShowing] = useState(false);
  // `name` is null for a button that sends nothing (an Astryx confirmation's "Not now"): the note says so (D0.1).
  const [lastAction, setLastAction] = useState<{ name: string | null; label: string | null; context: Json; consequential: boolean } | null>(null);
  const [filter, setFilter] = useState("");
  const [announce, setAnnounce] = useState("");
  const [tab, setTab] = useState<Tab>("design");
  const [fitWidth, setFitWidth] = useState(false);
  const [guide, setGuide] = useState(false);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const request = useRef(0);
  const canvasHeading = useRef<HTMLHeadingElement>(null);
  const toggles = useRef<Record<Panel, HTMLButtonElement | null>>({ library: null, inspector: null });
  const panels = useRef<Record<Panel, HTMLElement | null>>({ library: null, inspector: null });
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ design: null, examples: null, checks: null });
  // Authoring (A1 to A4): the version being checked, a notice for the last authoring step, and an open
  // confirmation. Edits run one at a time against the latest library, so fast typing never loses a change.
  const [checking, setChecking] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirm, setConfirm] = useState<"approve" | "discard" | null>(null);
  // Approval lifecycle on an approved version (decision 34): an open confirmation, and an operation in progress.
  const [lifecycle, setLifecycle] = useState<"withdraw" | "restore" | null>(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  // Advanced authoring: one selection shared by the structure, the canvas and the inspector. It names a template
  // element (definition-level, never a rendered id), and the item picked on the canvas when the element repeats.
  const [selection, setSelection] = useState<{ key: string; item: number | null } | null>(null);
  const [leftView, setLeftView] = useState<"compositions" | "structure">("compositions");
  const [selectMode, setSelectMode] = useState(false);
  const [structureState, setStructureState] = useState<string | null>(null);
  // Visual template editing: where keyboard focus goes after an edit, and a session-only undo history per draft.
  const [treeFocus, setTreeFocus] = useState<{ key: string; n: number } | null>(null);
  const history = useRef(new Map<string, { past: CompositionDefinition[]; future: CompositionDefinition[] }>());
  const [, setHistoryTick] = useState(0);
  const readyRef = useRef<Ready | null>(null);
  const editQueue = useRef<Promise<unknown>>(Promise.resolve());
  const lastValid = useRef(new Map<string, Instance>());
  const previewSession = useRef(createSessionId());
  const previewCounter = useRef(0);
  const guideRef = useRef<HTMLElement>(null);
  const actionSeen = useRef(false);
  const chipsRef = useRef<HTMLDivElement>(null);
  const [chipEdges, setChipEdges] = useState({ start: false, end: false });
  /** Which edges of the example chips have more beyond them, so a scrolling row says so (D0.1). */
  const measureChips = useCallback(() => {
    const el = chipsRef.current;
    if (!el) return;
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setChipEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);

  useEffect(() => setSlot(document.getElementById("cl-header-slot")), []);

  // Load: the packaged versions, each checked under the packaged rules, a host per version.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const store = browserStore();
        const stored = readRecord("library", store);
        const onboarding = readRecord("onboarding", store);
        const governor = await governorFor("none");
        const loaded = await loadLibrary(store);
        const checks = new Map<string, VersionCheck>();
        const hosts = new Map<string, Host>();
        for (const entry of loaded.library.entries) {
          for (const v of entry.versions) {
            const check = await checkVersion(governor, v, store);
            checks.set(versionKey(v.id, v.version), check);
            hosts.set(versionKey(v.id, v.version), await hostFor(governor, check));
          }
        }
        // Withdrawals recorded on this device apply before anything is shown (decision 34).
        const authorization = readRecord("authorization", store).value;
        await applyWithdrawals(authorization, loaded.library.entries.flatMap((e) => e.versions.map((v) => ({ definition: v, host: hosts.get(versionKey(v.id, v.version)) }))));
        if (cancelled) return;
        const first = loaded.library.entries[0];
        const known = stored.value.composition ? loaded.library.get(stored.value.composition, stored.value.version ?? 0) : undefined;
        const start: LibraryPrefs = known
          ? stored.value
          : { ...DEFAULT_PREFS, panel: stored.value.panel, composition: first?.id ?? null, version: first ? (first.approved ?? first.versions[0]!).version : null };
        setPrefs(start);
        const firstRun = !onboarding.value.dismissed;
        setGuide(firstRun);
        // A phone starts on the canvas alone. Wider screens reopen the side panel last used; on a first run, the
        // Compositions panel, where the guide is.
        const narrow = !window.matchMedia("(min-width: 900px)").matches;
        setOpen(narrow ? { library: false, inspector: false } : !firstRun && start.panel === "inspector" ? { library: false, inspector: true } : { library: true, inspector: false });
        setReady({ loaded, governors: new Map([["none", governor]]), checks: new Map([["none", checks]]), hosts, storage: stored.status, authorization });
      } catch (error) {
        if (!cancelled) setFailed(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const el = chipsRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    measureChips();
    const observer = new ResizeObserver(measureChips);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ready, prefs.composition, prefs.version, layout, open.library, open.inspector, measureChips]);

  // Narrow screens start with the canvas alone.
  const narrowSeen = useRef(false);
  useEffect(() => {
    if (layout === "narrow" && !narrowSeen.current) {
      narrowSeen.current = true;
      setOpen({ library: false, inspector: false });
    }
  }, [layout]);

  readyRef.current = ready;
  const definition: CompositionDefinition | undefined = ready && prefs.composition && prefs.version ? ready.loaded.library.get(prefs.composition, prefs.version) : undefined;
  const key = definition ? versionKey(definition.id, definition.version) : "";
  // One authoritative result per version and rule set; undefined means not checked under these rules yet.
  const check = ready?.checks.get(whatIf)?.get(key);
  // A draft's check counts only for the exact definition it checked: an edit makes a new definition (A3).
  const checkCurrent = !!check && check.definition === definition;
  const scenario = definition?.scenarios.find((s) => s.id === prefs.scenario) ?? definition?.scenarios[0];
  // A selection belongs to one composition; it survives a change of version or example (its key is stable).
  useEffect(() => {
    setSelection(null);
    setStructureState(null);
    setSelectMode(false);
  }, [definition?.id]);
  useEffect(() => setStructureState(null), [scenario?.id, prefs.state]);
  // A selection names an element of the draft as it is now: one an edit or undo removed leaves no stale selection.
  useEffect(() => {
    if (selection && definition && statesWithElement(definition, selection.key).length === 0) setSelection(null);
  }, [definition, selection]);
  useEffect(() => {
    if (!selectMode) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelectMode(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectMode]);

  const persist = useCallback((next: LibraryPrefs) => {
    setPrefs(next);
    writeRecord("library", next);
  }, []);

  // Show the selection through its version's host. Late answers to earlier selections are dropped.
  // A draft edited since its last check has no approval to show it with; it is previewed instead, through the
  // same pipeline (instantiate), labelled as not checked, with the last valid preview kept when an edit cannot
  // be shown (A2). Nothing runs from a preview: actions only ever show what they would send.
  const preview = !!definition && definition.status === "draft" && whatIf === "none" && !(checkCurrent && check?.approval);
  useEffect(() => {
    if (!ready || !definition || !scenario) return;
    const mine = ++request.current;
    setShowing(true);
    setLastAction(null);
    const input = { data: scenario.data as Json, ...(prefs.state ? { state: prefs.state } : {}) };
    const what = `${definition.name}, version ${definition.version}, with ${scenarioName(scenario, definition.id)}`;
    if (preview) {
      const governor = ready.governors.get("none")!;
      void instantiate(governor, definition, { surfaceId: surfaceIdFor(definition.id, previewSession.current, ++previewCounter.current), data: input.data, state: input.state }).then((r) => {
        if (mine !== request.current) return;
        if (r.ok) lastValid.current.set(key, r.instance);
        setShown((r.ok ? { ok: true, instance: r.instance } : { ok: false, refusal: r, kept: lastValid.current.get(key) ?? null }) as ShowResult);
        setPreviewing(true);
        setShowing(false);
        setAnnounce(r.ok ? `Previewing ${what}, not checked yet.` : `${what} cannot be shown: ${plainRationale(r.reason) ?? r.stage}.`);
      });
      return;
    }
    void (async () => {
      // A draft edited since its last check has no host until its checks run; under a rule try-out it gets an
      // unapproved one, which shows nothing new until checked (needs-recheck), as every version does there.
      let host = ready.hosts.get(key);
      if (!host) {
        host = await createHost({ governor: ready.governors.get(whatIf)!, compositions: [definition] });
        ready.hosts.set(key, host);
      }
      return host.show(definition.id, input);
    })().then((r) => {
      if (mine !== request.current) return;
      if (r.ok) lastValid.current.set(key, r.instance);
      setShown(r);
      setPreviewing(false);
      setShowing(false);
      setAnnounce(r.ok ? `Showing ${what}.` : `${what} is not shown: ${r.refusal.stage === "withdrawn" ? "its approval is withdrawn on this device" : r.refusal.stage === "needs-recheck" ? "it needs a new check" : "the design rules refuse it"}.`);
    });
  }, [ready, key, definition, scenario, prefs.state, whatIf, preview]);

  const focusCanvasOnPhone = () => {
    if (layout === "narrow") {
      setOpen({ library: false, inspector: false });
      setTimeout(() => canvasHeading.current?.focus(), 0);
    }
  };

  const select = (composition: string) => {
    if (!ready) return;
    const entry = ready.loaded.library.entry(composition)!;
    persist({ ...prefs, composition, version: (entry.approved ?? entry.versions[0]!).version, scenario: null, state: null });
    focusCanvasOnPhone();
  };

  const takeGuide = (step: (typeof GUIDE)[number]) => {
    if (!ready?.loaded.library.get(step.composition, step.version)) return;
    persist({ ...prefs, composition: step.composition, version: step.version, scenario: step.scenario, state: null });
    setAnnounce(step.detail);
    focusCanvasOnPhone();
  };

  const dismissGuide = () => {
    setGuide(false);
    writeRecord("onboarding", { dismissed: true });
  };

  const showGuide = () => {
    setGuide(true);
    writeRecord("onboarding", { dismissed: false });
    if (!open.library) togglePanel("library");
    setTimeout(() => guideRef.current?.focus(), 0);
  };

  /** The phone's first-run link: open the Compositions sheet at the guide. */
  const openGuide = () => {
    togglePanel("library");
    setTimeout(() => guideRef.current?.focus(), 0);
  };

  const togglePanel = (panel: Panel) => {
    const next = !open[panel];
    const other: Panel = panel === "library" ? "inspector" : "library";
    // Below 1440 px, one side panel at a time (decision 18); on a phone, panels are modal sheets over the canvas.
    setOpen(layout === "wide" ? { ...open, [panel]: next } : ({ [panel]: next, [other]: false } as Record<Panel, boolean>));
    if (next) {
      persist({ ...prefs, panel });
      if (layout === "narrow") setTimeout(() => panels.current[panel]?.focus(), 0);
    }
  };

  const closeDrawer = (panel: Panel) => {
    setOpen({ ...open, [panel]: false });
    // After the commit: until then the toggle is still inert behind the modal sheet and cannot take focus.
    setTimeout(() => toggles.current[panel]?.focus(), 0);
  };

  /**
   * Switch rule sets (R2). Every host is governed by the new rules at once. A host gets an approval back only
   * when a check under exactly these rules issued it for exactly that version and its pins still match;
   * otherwise it shows nothing new until checked. So restoring the packaged rules restores the packaged
   * check's authorization, and nothing from the try-out survives into the packaged rules.
   */
  const changeRules = async (next: WhatIf) => {
    if (!ready) return;
    const governor = ready.governors.get(next) ?? (await governorFor(next));
    ready.governors.set(next, governor);
    for (const e of ready.loaded.library.entries) {
      for (const v of e.versions) {
        const k = versionKey(v.id, v.version);
        const host = ready.hosts.get(k);
        if (!host) continue;
        host.setGovernor(governor);
        const issued = ready.checks.get(next)?.get(k)?.approval;
        if (issued && samePins(issued.pins, await pinsFor(governor, v))) host.approve(v.id, issued);
      }
    }
    setWhatIf(next);
  };

  /**
   * Run checks (A3): re-check every example of the selected version under the current rules. A draft gets a
   * fresh host for the exact definition checked, approved only if every example behaves as expected.
   */
  const recheckNow = async () => {
    if (!ready || !definition) return;
    const governor = ready.governors.get(whatIf)!;
    setChecking(key);
    setNotice(null);
    setAnnounce("Running the checks…");
    // A try-out is never stored: its check writes no record, and it is kept only for this session.
    const [result] = await Promise.all([checkVersion(governor, definition, whatIf === "none" ? browserStore() : null), new Promise((r) => setTimeout(r, 250))]);
    const latest = readyRef.current ?? ready;
    if (definition.status === "draft") latest.hosts.set(key, await hostFor(governor, result));
    else if (result.approval) latest.hosts.get(key)!.approve(definition.id, result.approval);
    const forRules = latest.checks.get(whatIf) ?? new Map<string, VersionCheck>();
    forRules.set(key, result);
    latest.checks.set(whatIf, forRules);
    setChecking(null);
    const failed = result.scenarios.filter((x) => !x.matches).length;
    setAnnounce(result.approval ? `Checks pass: all ${result.scenarios.length} examples behave as expected.` : `Checks fail: ${failed} of ${result.scenarios.length} examples do not behave as expected.`);
    // A new object, so the selection is shown again through the (possibly re-approved) host.
    setReady({ ...latest });
  };

  // ---- Authoring (A1, A2, A4) ---------------------------------------------------------------------------------

  /**
   * Put a new library in place. A rebuilt library holds fresh frozen copies of every version, so versions are
   * compared by content: an unchanged version keeps its host and its checks (re-pointed at the new copy); a
   * changed or removed one loses both, and must be checked again.
   */
  const adopt = (current: Ready, loaded: LoadedLibrary): Ready => {
    const next: Ready = { ...current, loaded };
    for (const e of current.loaded.library.entries)
      for (const v of e.versions) {
        const k = versionKey(v.id, v.version);
        const now = loaded.library.get(v.id, v.version);
        if (now && JSON.stringify(now) === JSON.stringify(v)) {
          for (const m of next.checks.values()) {
            const c = m.get(k);
            if (c && c.definition === v) m.set(k, { ...c, definition: now });
          }
        } else {
          next.hosts.delete(k);
          for (const m of next.checks.values()) m.delete(k);
        }
      }
    return next;
  };

  /** Open the inspector without touching the stored selection (the caller persists it). */
  const showInspector = () => {
    if (open.inspector) return;
    setOpen(layout === "wide" ? { ...open, inspector: true } : { library: false, inspector: true });
    if (layout === "narrow") setTimeout(() => panels.current.inspector?.focus(), 0);
  };

  const startDraft = async () => {
    if (!ready || !definition) return;
    const r = await createDraft(ready.loaded, definition.id, browserStore());
    if (!r.ok) return setNotice({ tone: "bad", text: sentence(r.reason) });
    setReady(adopt(ready, r.loaded));
    persist({ ...prefs, version: r.version, scenario: null, state: null, panel: "inspector" });
    setTab("design");
    showInspector();
    setNotice(r.warning ? { tone: "warn", text: r.warning } : { tone: "ok", text: `Draft v${r.version} created from v${definition.version}. v${definition.version} stays approved and unchanged.` });
    setAnnounce(`Draft v${r.version} created. Edit it in the inspector.`);
  };

  const openDraft = (version: number) => {
    persist({ ...prefs, version, state: null });
    setAnnounce(`Showing draft v${version}.`);
  };

  /**
   * One edit to the selected draft (A2), queued after any edit still being applied, and applied to the latest
   * library. Returns the reason when the edit is not a valid composition; nothing is changed then.
   */
  const applyEdit = (edit: (draft: CompositionDefinition) => void): Promise<string | null> => {
    if (!definition || definition.status !== "draft") return Promise.resolve("only a draft can be edited");
    const { id, version } = definition;
    const run = editQueue.current.then(async () => {
      const current = readyRef.current;
      if (!current) return "not loaded";
      const r = await editDraft(current.loaded, id, version, edit, browserStore());
      if (!r.ok) return sentence(r.reason);
      const next = adopt(current, r.loaded);
      readyRef.current = next;
      setReady(next);
      setNotice(r.warning ? { tone: "warn", text: r.warning } : null);
      return null;
    });
    editQueue.current = run.catch(() => undefined);
    return run;
  };

  /** A draft's definition replaced by an earlier one (undo, redo), keeping its id, version and status. */
  const replaceDefinition = (d: CompositionDefinition, from: CompositionDefinition) => {
    const fixed = new Set(["id", "version", "status"]);
    for (const k of Object.keys(d)) if (!fixed.has(k)) delete (d as Json)[k];
    for (const [k, v] of Object.entries(from)) if (!fixed.has(k)) (d as Json)[k] = structuredClone(v);
  };
  const latestDraft = () => (definition ? readyRef.current?.loaded.library.get(definition.id, definition.version) : undefined);
  /** An edit that undo can take back: element and structure edits, kept for this session only. */
  const applyTracked = async (edit: (draft: CompositionDefinition) => void): Promise<string | null> => {
    const before = latestDraft();
    const refused = await applyEdit(edit);
    if (!refused && before) {
      const h = history.current.get(key) ?? { past: [], future: [] };
      h.past = [...h.past.slice(-29), before];
      h.future = [];
      history.current.set(key, h);
      setHistoryTick((t) => t + 1);
    }
    return refused;
  };
  const stepHistory = async (direction: "undo" | "redo") => {
    const h = history.current.get(key);
    const current = latestDraft();
    const target = direction === "undo" ? h?.past.at(-1) : h?.future.at(-1);
    if (!h || !current || !target) return;
    const refused = await applyEdit((d) => replaceDefinition(d, target));
    if (refused) return setAnnounce(`Could not ${direction}: ${refused}`);
    if (direction === "undo") {
      h.past = h.past.slice(0, -1);
      h.future = [...h.future, current];
    } else {
      h.future = h.future.slice(0, -1);
      h.past = [...h.past, current];
    }
    setHistoryTick((t) => t + 1);
    setAnnounce(direction === "undo" ? "Undone. The checks need to run again." : "Redone. The checks need to run again.");
  };

  const discardNow = async () => {
    if (!ready || !definition) return;
    const r = await discardDraftVersion(ready.loaded, definition.id, definition.version, browserStore());
    setConfirm(null);
    if (!r.ok) return setNotice({ tone: "bad", text: sentence(r.reason) });
    const entry = r.loaded.library.entry(definition.id);
    setReady(adopt(ready, r.loaded));
    lastValid.current.delete(key);
    persist({ ...prefs, version: entry?.approved?.version ?? entry?.versions[0]?.version ?? null, scenario: null, state: null });
    setTab("design");
    setNotice(r.warning ? { tone: "warn", text: r.warning } : { tone: "ok", text: `Draft v${definition.version} discarded. The approved versions are unchanged.` });
    setAnnounce(`Draft v${definition.version} discarded.`);
    setTimeout(() => canvasHeading.current?.focus(), 0);
  };

  const approveNow = async () => {
    if (!ready || !definition) return;
    const governor = ready.governors.get("none")!;
    const r = await approveVersion(ready.loaded, governor, definition.id, definition.version, ready.checks.get("none")?.get(key), browserStore());
    setConfirm(null);
    if (!r.ok) {
      setNotice({ tone: "bad", text: `Not approved: ${r.reason}.` });
      setAnnounce(`Not approved: ${r.reason}.`);
      return;
    }
    const next = adopt(ready, r.loaded);
    const result: VersionCheck = { definition: r.approved, approval: r.approval, scenarios: r.scenarios, previous: { status: "none" } };
    next.hosts.set(key, await hostFor(governor, result));
    next.checks.get("none")!.set(key, result);
    setReady({ ...next });
    setNotice({ tone: r.warning ? "warn" : "ok", text: r.warning ?? `v${definition.version} is approved on this device. It cannot change now; v${(ready.loaded.library.entry(definition.id)?.approved?.version ?? 1)} stays available. It is not published.` });
    setAnnounce(`Version ${definition.version} approved on this device.`);
  };

  /** Whether this version's approval is withdrawn on this device: its host says so. */
  const isWithdrawn = (v: CompositionDefinition | undefined) => !!v && v.status === "approved" && !!ready?.hosts.get(versionKey(v.id, v.version))?.isWithdrawn(v.id);

  /** Withdraw the selected approved version's approval on this device (decision 34). Its definition does not change. */
  const withdrawNow = async () => {
    if (!ready || !definition) return;
    const host = ready.hosts.get(key);
    if (!host) return;
    setLifecycleBusy(true);
    const r = await withdrawApproval({ definition, host, record: ready.authorization, origin: ready.loaded.origin.get(key) === "device" ? "device" : "packaged", store: browserStore() });
    setLifecycleBusy(false);
    setLifecycle(null);
    if (!r.ok) {
      setNotice({ tone: "bad", text: `Not withdrawn: ${r.reason}.` });
      setAnnounce(`Not withdrawn: ${r.reason}.`);
      return;
    }
    setReady({ ...ready, authorization: r.record });
    setNotice({ tone: "ok", text: `The approval of v${definition.version} is withdrawn on this device. v${definition.version} itself is unchanged; nothing may use it until approval is restored, and no other version is used in its place.` });
    setAnnounce(`Approval of version ${definition.version} withdrawn.`);
  };

  /** Restore a withdrawn approval: a person's decision and a check that passes now. */
  const restoreNow = async () => {
    if (!ready || !definition) return;
    const host = ready.hosts.get(key);
    if (!host) return;
    setLifecycleBusy(true);
    setAnnounce("Running the checks before restoring…");
    const r = await restoreApproval({ governor: ready.governors.get("none")!, definition, host, record: ready.authorization, store: browserStore() });
    setLifecycleBusy(false);
    setLifecycle(null);
    if (!r.ok) {
      setNotice({ tone: "bad", text: `Not restored: ${r.reason}.` });
      setAnnounce(`Not restored: ${r.reason}.`);
      return;
    }
    setReady({ ...ready, authorization: r.record });
    setNotice({ tone: "ok", text: `Approval of v${definition.version} restored on this device: its checks pass now.` });
    setAnnounce(`Approval of version ${definition.version} restored.`);
  };

  // Another tab on this device withdrew an approval: apply it here at once. (A restoration elsewhere is not
  // applied here: this tab keeps refusing until it reloads, which re-checks; the safe direction.)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEYS.authorization) return;
      const current = readyRef.current;
      if (!current) return;
      const record = readRecord("authorization").value;
      void applyWithdrawals(record, current.loaded.library.entries.flatMap((x) => x.versions.map((v) => ({ definition: v, host: current.hosts.get(versionKey(v.id, v.version)) })))).then((applied) => {
        if (applied.length) setReady({ ...current, authorization: record });
      });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Ctrl or Cmd+Z undoes, with Shift redoes, element and structure edits on a draft, outside text fields.
  const historyKeys = useRef<(e: KeyboardEvent) => void>(() => {});
  historyKeys.current = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z" || definition?.status !== "draft") return;
    const el = e.target as HTMLElement | null;
    if (el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable)) return;
    e.preventDefault();
    void stepHistory(e.shiftKey ? "redo" : "undo");
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => historyKeys.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const instanceForLabels = shown?.ok ? shown.instance : null;
  const onAction = useCallback(
    (action: A2uiClientAction) => {
      if (!ready || !definition) return;
      actionSeen.current = true;
      const a = action as unknown as { name: string; surfaceId: string; sourceComponentId: string; context?: Json };
      const host = ready.hosts.get(key);
      // Shown in its recordable form only: a sensitive value is replaced, never displayed or kept. A preview has no
      // host yet; the same redaction applies, from the definition's own sensitive inputs.
      const event = { name: a.name, surfaceId: a.surfaceId, sourceComponentId: a.sourceComponentId, context: a.context ?? {} };
      const recordable = host ? host.redact(event) : redactEvent(event, definition);
      const declared = definition.actions.find((x) => x.name === a.name);
      const label = controlLabel(instanceForLabels, a.sourceComponentId);
      setLastAction({ name: a.name, label, context: recordable.context, consequential: !!declared?.consequential });
      setAnnounce(`${label ?? sentence(humanize(a.name))}: preview only, nothing runs in the Library.`);
    },
    [ready, key, definition, instanceForLabels],
  );

  /**
   * A button on the canvas that dispatches no action (a confirmation's "Not now") still gets feedback, and
   * never leaves an earlier action's note on screen (D0.1). The click is seen in the capture phase; if no
   * action followed it, the note says the button sends nothing.
   */
  const onCanvasClick = useCallback((target: HTMLElement) => {
    const button = target.closest("button");
    if (!button) return;
    actionSeen.current = false;
    const label = button.textContent?.trim() || null;
    setTimeout(() => {
      if (actionSeen.current) return;
      setLastAction({ name: null, label, context: {}, consequential: false });
      setAnnounce(`${label ?? "That button"}: preview only, it sends nothing.`);
    }, 0);
  }, []);

  // On a phone an open panel is a modal sheet (R3): everything behind it is inert, and Tab stays inside it.
  // Wider screens keep side panels non-modal.
  useEffect(() => {
    if (layout !== "narrow") return;
    const which: Panel | null = open.library ? "library" : open.inspector ? "inspector" : null;
    const drawer = which ? panels.current[which] : null;
    if (!drawer) return;
    const changed: Array<[HTMLElement, boolean]> = [];
    let node: HTMLElement = drawer;
    while (node.parentElement && node !== document.body) {
      for (const sibling of Array.from(node.parentElement.children) as HTMLElement[]) {
        if (sibling === node || sibling.classList.contains("cl-scrim") || sibling.hasAttribute("aria-live") || ["SCRIPT", "STYLE"].includes(sibling.tagName)) continue;
        changed.push([sibling, sibling.inert]);
        sibling.inert = true;
      }
      node = node.parentElement;
    }
    const focusable = () =>
      Array.from(drawer.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')).filter((el) => el.getClientRects().length > 0);
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === drawer || !drawer.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !drawer.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onTab);
    return () => {
      document.removeEventListener("keydown", onTab);
      for (const [el, was] of changed) el.inert = was;
    };
  }, [layout, open.library, open.inspector]);

  // Escape closes a sheet on a phone.
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

  const frameMode = layout !== "narrow" && tall ? "fixed" : "flow";
  const header =
    slot &&
    createPortal(
      <span className="cl-head" data-testid="library-scope">
        <span className="cl-head__scope">Astryx sample</span>
        <details className="cl-head__next">
          <summary>Coming next</summary>
          <div className="cl-head__pop" role="note">
            <p>
              <strong>Changing a composition&rsquo;s layout</strong> (adding, removing or moving elements), <strong>Playground</strong> and <strong>Publish</strong> are not available yet.
            </p>
            <p>Today you can look at compositions, try them with different data, and make a draft: change its details and examples, select an element to set what a person types into it or what pressing it sends, run its checks and approve it on this device.</p>
          </div>
        </details>
      </span>,
      slot,
    );

  if (failed) {
    return (
      <Frame layout={layout} mode={frameMode} top={headerHeight} open={open}>
        {header}
        <div className="cl-canvas" role="alert">
          <Empty title="The Library could not start">{failed}</Empty>
        </div>
      </Frame>
    );
  }
  if (!ready) {
    return (
      <Frame layout={layout} mode={frameMode} top={headerHeight} open={open}>
        {header}
        <div className="cl-canvas" aria-busy="true">
          <p className="cl-loading" role="status">
            Loading the compositions and checking each one against the design rules…
          </p>
        </div>
      </Frame>
    );
  }

  const entry = definition ? ready.loaded.library.entry(definition.id) : undefined;
  const governed = whatIf === "none";
  const governor = ready.governors.get(whatIf)!;
  const toolchain = governor.toolchain;
  const drawerProps = (panel: Panel) => (layout === "narrow" ? { role: "dialog", "aria-modal": true, "aria-labelledby": `cl-${panel}-title` } : { "aria-labelledby": `cl-${panel}-title` });
  const rules = governed ? "the Astryx design rules" : "the stricter try-out rule";
  const failing = check && !check.approval ? check.scenarios.filter((s) => !s.matches).map((s) => s.id) : [];
  const nameOf = (id: string) => {
    const s = definition?.scenarios.find((x) => x.id === id);
    return s && definition ? scenarioName(s, definition.id) : id;
  };
  /** What a refusal by a rule leads with (a plain sentence, presentation.ts), and the contract's own rationale. */
  const ruleText = (ruleId: string | undefined) => {
    const rationale = ((governor.contract.rules ?? []) as Json[]).find((r) => r.id === ruleId)?.rationale as string | undefined;
    return { lead: (ruleId ? RULE_LEADS[ruleId] : undefined) ?? plainRationale(rationale), rationale: rationale ?? null };
  };
  const instance = shown?.ok ? shown.instance : null;
  const outcome = describeOutcome(shown, scenario, definition, check, failing, nameOf);

  // ---- Selection (advanced authoring) ----------------------------------------------------------------------
  const stateName = (id: string) => {
    const st = definition?.states.find((x) => x.id === id);
    return st ? sentence(humanize(st.id)) : id;
  };
  const shownState = instance?.state ?? null;
  const listedState = definition ? (structureState && definition.states.some((x) => x.id === structureState) ? structureState : (shownState ?? definition.states[0]!.id)) : null;
  const structure = definition && listedState ? structureOf(definition.states.find((x) => x.id === listedState)!) : null;
  // Where each rendered component came from, worked out from this instance's own evidence (null: canvas selection is off).
  const elements = definition && instance && scenario ? instanceElements(definition, instance, scenario.data as Json) : null;
  const counts = elements ? new Map([...elements.byKey].map(([k, v]) => [k, v.length])) : null;
  const statesOfSelected = selection && definition ? statesWithElement(definition, selection.key) : [];
  const homeState = selection && structure && findInStructure(structure, selection.key) ? listedState : (statesOfSelected[0] ?? null);
  const selectedTrail = selection && definition && homeState ? findInStructure(structureOf(definition.states.find((x) => x.id === homeState)!), selection.key) : null;
  const selectedIds = selection && elements ? (elements.byKey.get(selection.key) ?? []) : [];
  const pickedId = selection?.item != null ? (selectedIds[selection.item] ?? null) : null;
  const itemContext: ItemContext | null =
    selection?.item != null && instance && pickedId
      ? {
          index: selection.item,
          count: selectedIds.length,
          witness: instance.actions.find((a) => a.item?.index === selection.item)?.item?.witness ?? [],
          payload: instance.actions.find((a) => a.componentId === pickedId)?.payload,
        }
      : null;
  const selectElement = (key: string | null, item: number | null = null) => {
    setSelection(key ? { key, item } : null);
    if (key) setTab("design");
  };
  const pickOnCanvas = (componentId: string) => {
    const origin = elements?.byComponent.get(componentId);
    if (!origin || !definition) return;
    selectElement(origin.key, origin.item?.index ?? null);
    showInspector();
    const trail = statesWithElement(definition, origin.key).length ? findInStructure(structureOf(definition.states.find((x) => x.id === instance!.state)!), origin.key) : null;
    const node = trail?.at(-1);
    setAnnounce(`Selected ${node ? elementName(node) : "an element"}${origin.item ? `, item ${origin.item.index + 1}` : ""}.`);
  };

  // ---- Template editing (draft) ------------------------------------------------------------------------------
  const editable = !!definition && definition.status === "draft" && governed;
  const editState = homeState ?? listedState;
  /**
   * One structural or identity edit: tried on a copy first, so a refusal is said plainly and nothing changes;
   * then applied as one edit through editDraft (the loader decides), and the selection and keyboard focus follow
   * the element to where it now is.
   */
  const runTemplate = async (mutate: (d: CompositionDefinition) => { ok: true; key: string } | { ok: false; reason: string }, said: string): Promise<string | null> => {
    if (!definition || !editable) return "Only a draft can be edited.";
    const dry = mutate(structuredClone(definition));
    if (!dry.ok) return `${sentence(dry.reason)}.`;
    const refused = await applyTracked((d) => void mutate(d));
    if (refused) return plainTemplateIssue(refused);
    setSelection({ key: dry.key, item: null });
    setTreeFocus({ key: dry.key, n: Date.now() });
    setAnnounce(`${said} The checks need to run again.`);
    return null;
  };
  const contract = governor.contract as Json;
  const templateOps =
    editable && editState
      ? {
          insert: (at: { key: string; position: Position }, component: Insertable, label: string) => runTemplate((d) => applyInsert(d, { stateId: editState, at, component, label }), `Added a ${COMPONENT_LABEL[component]?.toLowerCase() ?? component}.`),
          move: (to: { key: string; position: Position }) => (selection ? runTemplate((d) => moveNode(d, editState, selection.key, to), "Moved.") : Promise.resolve("Select an element first.")),
          remove: (resolve: boolean) => (selection ? runTemplate((d) => removeNode(d, editState, selection.key, resolve), "Removed.") : Promise.resolve("Select an element first.")),
          undo: () => void stepHistory("undo"),
          redo: () => void stepHistory("redo"),
          canUndo: !!history.current.get(key)?.past.length,
          canRedo: !!history.current.get(key)?.future.length,
        }
      : null;
  const contentApi =
    editable && editState && selection && definition
      ? {
          set: async (field: string, value: unknown, label: string) => {
            const change = { stateId: editState, key: selection.key, field, value };
            const problem = contentProblem(definition, contract, change);
            if (problem) return problem;
            const refused = await applyTracked((d) => applyContent(d, change));
            if (refused) return plainTemplateIssue(refused);
            setAnnounce(`${label} changed. The checks need to run again.`);
            return null;
          },
          assignId: (id: string) => runTemplate((d) => assignElementId(d, editState, selection.key, id), `It now has the id ${id}.`),
          renameId: (to: string) => {
            const from = selection.key.startsWith("#") ? selection.key.slice(1) : null;
            return from ? runTemplate((d) => renameElementId(d, from, to), `Renamed to ${to}; every state and declaration that used it follows.`) : Promise.resolve("It has no id to rename.");
          },
        }
      : undefined;

  // ---- Compositions panel -----------------------------------------------------------------------------------

  const libraryPanel = (
    <aside
      id="cl-library"
      className={`cl-panel cl-panel--library${open.library ? " cl-panel--open" : ""}`}
      {...drawerProps("library")}
      hidden={!open.library}
      tabIndex={-1}
      ref={(el) => void (panels.current.library = el)}
    >
      <div className="cl-panel__head">
        <h2 className="cl-h" id="cl-library-title">
          {leftView === "structure" ? "Structure" : "Compositions"}
        </h2>
        {layout === "narrow" && (
          <button className="cl-tool" onClick={() => closeDrawer("library")}>
            Close
          </button>
        )}
      </div>
      <div className="cl-switch" role="group" aria-label="Show in this panel">
        <button className={`cl-switch__opt${leftView === "compositions" ? " cl-switch__opt--on" : ""}`} aria-pressed={leftView === "compositions"} onClick={() => setLeftView("compositions")} data-testid="view-compositions">
          Compositions
        </button>
        <button className={`cl-switch__opt${leftView === "structure" ? " cl-switch__opt--on" : ""}`} aria-pressed={leftView === "structure"} onClick={() => setLeftView("structure")} disabled={!definition} data-testid="view-structure">
          Structure
        </button>
      </div>
      {leftView === "structure" && definition && structure && listedState ? (
        <StructurePanel
          definition={definition}
          structure={structure}
          stateId={listedState}
          shownState={shownState}
          states={definition.states.map((x) => ({ id: x.id, label: stateName(x.id) }))}
          onState={setStructureState}
          selected={selection?.key ?? null}
          onSelect={(k) => selectElement(k)}
          onOpen={(k) => {
            selectElement(k);
            showInspector();
          }}
          counts={counts}
          focus={treeFocus}
          tools={templateOps && definition ? <TemplateTools definition={definition} contract={contract} stateId={listedState} selected={selection && homeState === listedState ? selection.key : null} ops={templateOps} /> : undefined}
        />
      ) : (
      <>
      <label className="cl-label" htmlFor="cl-filter">
        Find a composition
      </label>
      <input id="cl-filter" className="af-input" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Name or purpose" />
      {entries.length === 0 ? (
        <Empty title="No composition matches">Clear the search to see all {ready.loaded.library.entries.length}.</Empty>
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
                      <span key={v.version} className={`cl-badge${v.status === "approved" && !isWithdrawn(v) ? " cl-badge--ok" : ""}`}>
                        v{v.version} · {v.status === "approved" ? (isWithdrawn(v) ? "Approved · withdrawn" : "Approved") : "Draft"}
                      </span>
                    ))}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {/* The list comes first; the guide follows it, compact, and can be put away and brought back (D0.1). */}
      {guide ? (
        <section className="cl-guide" aria-labelledby="cl-guide-title" data-testid="first-run" tabIndex={-1} ref={guideRef}>
          <h3 id="cl-guide-title" className="cl-guide__title">
            New here? Four quick examples
          </h3>
          <p>
            Composer lets you design screens an AI agent can fill with real data, and keeps them on-brand. Each <strong>composition</strong> above is one screen design: an agent supplies the data, and Composer checks the result against the Astryx design system&rsquo;s rules before anyone sees it.
          </p>
          <ol className="cl-guide__steps">
            {GUIDE.map((step) => (
              <li key={step.id}>
                <button className="cl-guide__step" onClick={() => takeGuide(step)} data-testid={`guide-${step.id}`}>
                  <span className="cl-guide__step-title">{step.title}</span>
                  <span className="cl-guide__step-detail">{step.detail}</span>
                </button>
              </li>
            ))}
          </ol>
          <p className="cl-dim">To change a composition, choose “Create draft” on an approved version. Changing its layout is not available yet.</p>
          <button className="cl-tool" onClick={dismissGuide} data-testid="guide-dismiss">
            Hide the guide
          </button>
        </section>
      ) : (
        <button className="cl-link cl-guide-show" onClick={showGuide} data-testid="guide-show">
          New here? Show the guide
        </button>
      )}
      {layout === "narrow" && (
        <p className="cl-dim" data-testid="coming-next-narrow">
          Coming next: changing the layout, Playground and Publish are not available yet.
        </p>
      )}
      </>
      )}
      {ready.loaded.issues.length > 0 && (
        <details className="cl-issues">
          <summary>{ready.loaded.issues.length} packaged version(s) could not be loaded</summary>
          <ul>
            {ready.loaded.issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </details>
      )}
    </aside>
  );

  // ---- Canvas -----------------------------------------------------------------------------------------------

  const origin = definition ? ready.loaded.origin.get(key) : undefined;
  // What a draft changes from the approved version it follows: the packaged sample's own wording, or, for a
  // draft made or edited here, worked out from the two definitions (presentation.ts).
  const changes = definition?.status === "draft" ? (origin === "packaged" ? VERSION_CHANGES[key] : entry?.approved ? { summary: describeChanges(entry.approved, definition) } : undefined) : undefined;
  const approvedVersion = entry?.approved?.version;
  const draftState = definition?.status === "draft" ? (checking === key ? "checking" : !checkCurrent ? "unchecked" : check?.approval ? "pass" : "fail") : null;
  const draftLabel = { checking: "Checking…", unchecked: "Not checked", fail: "Checks fail", pass: "Not approved" } as const;
  const toolbar = definition && entry && (
    <div className="cl-toolbar">
      {/* One head row: what this is and its status on the left, view controls on the right. The view controls
          never wrap away from the title; the status wraps below the title when the canvas is narrow (D0.1). */}
      <div className="cl-toolbar__head">
        <h2 id="cl-canvas-title" className="cl-title" tabIndex={-1} ref={canvasHeading}>
          {definition.name}
        </h2>
        <div className="cl-toolbar__versions">
          {entry.versions.length > 2 ? (
            <label className="cl-version-select">
              <span className="cl-sr">Version</span>
              <select className="af-select cl-input" value={definition.version} onChange={(e) => persist({ ...prefs, version: Number(e.target.value), state: null })} data-testid="version-select">
                {[...entry.versions].reverse().map((v) => (
                  <option key={v.version} value={v.version}>
                    v{v.version} {v.status === "approved" ? `${ready.loaded.origin.get(versionKey(v.id, v.version)) === "device" ? "Approved on this device" : "Approved"}${isWithdrawn(v) ? " · withdrawn" : ""}` : "Draft"}
                  </option>
                ))}
              </select>
            </label>
          ) : entry.versions.length > 1 ? (
            <fieldset className="cl-seg">
              <legend className="cl-sr">Version</legend>
              {entry.versions.map((v) => (
                <label key={v.version} className={`cl-seg__opt${v.version === definition.version ? " cl-seg__opt--on" : ""}`}>
                  <input type="radio" name="cl-version" checked={v.version === definition.version} onChange={() => persist({ ...prefs, version: v.version, state: null })} />
                  v{v.version} {v.status === "approved" ? (isWithdrawn(v) ? "Approved · withdrawn" : "Approved") : "Draft"}
                </label>
              ))}
            </fieldset>
          ) : (
            <span className={`cl-badge${definition.status === "approved" && !isWithdrawn(definition) ? " cl-badge--ok" : ""}`}>
              v{definition.version} · {definition.status === "approved" ? (isWithdrawn(definition) ? "Approved · withdrawn" : "Approved") : "Draft"}
            </span>
          )}
        </div>
        <div className="cl-toolbar__status">
          {/* Checks only: whether a version is approved is said by its version status, never by this pill. */}
          <span className={`cl-pill cl-pill--${outcome.tone}`} data-testid="check-pill" data-state={outcome.state}>
            <span aria-hidden="true" className="cl-pill__icon">
              {outcome.icon}
            </span>{" "}
            {outcome.pill}
            {showing ? " · updating…" : ""}
          </span>
          {definition.status === "draft" && (
            <details className="cl-draft" data-testid="draft-note" data-draft={draftState ?? undefined}>
              <summary>
                <span className="cl-draft__status">{draftLabel[draftState!]}</span>
                {changes ? (
                  <span className="cl-draft__more">
                    <span className="cl-draft__dot"> ·</span> What changed
                  </span>
                ) : null}
              </summary>
              <div className="cl-draft__pop" role="note">
                <p>
                  v{definition.version} is a draft, newer than approved v{approvedVersion}. It is not approved for use by agents: passing checks does not approve it. v{approvedVersion} stays approved and unchanged.
                </p>
                {draftState !== "pass" && <p data-testid="draft-check-state">{draftState === "checking" ? "Its checks are running." : draftState === "fail" ? "Its latest checks fail: open Checks in the inspector to see which examples, and why." : "It has changed since its last check. Run the checks before it can be approved."}</p>}
                {changes && (
                  <>
                    <p className="cl-draft__lead">What changed from v{approvedVersion}</p>
                    {changes.summary.length === 0 ? (
                      <p>Nothing yet: it is the same as v{approvedVersion}.</p>
                    ) : (
                      <ul data-testid="draft-changes">
                        {changes.summary.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            </details>
          )}
          {/* An existing draft is one choice away in the version control beside this; only creating one needs a button. */}
          {definition.status === "approved" && governed && !entry.draft && (
            <button className="cl-tool cl-tool--primary" onClick={startDraft} data-testid="create-draft">
              Create draft
            </button>
          )}
          {layout === "narrow" && guide && (
            <span className="cl-guide-strip" data-testid="first-run-strip">
              <button className="cl-link" onClick={openGuide}>
                New here? Try the guide
              </button>
            </span>
          )}
        </div>
        <div className="cl-toolbar__view">
          <button
            className="cl-tool"
            aria-pressed={selectMode}
            onClick={() => {
              const next = !selectMode;
              setSelectMode(next);
              setAnnounce(next ? "Select is on: click an element on the canvas to inspect it. Press Escape to turn it off." : "Select is off: the canvas can be used again.");
            }}
            disabled={!elements && !selectMode}
            title={elements ? "Select elements on the canvas" : "Nothing on the canvas can be selected right now"}
            data-testid="select-mode"
          >
            <Icon name="select" />
            <span className="cl-tool__text">Select</span>
          </button>
          {layout !== "narrow" && (
            <button className="cl-tool" aria-pressed={fitWidth} onClick={() => setFitWidth(!fitWidth)} data-testid="fit-width" title="Fit width">
              <Icon name="fit" />
              <span className="cl-tool__text">Fit width</span>
            </button>
          )}
          <div className="cl-toolbar__panels" role="group" aria-label="Panels">
            {(["library", "inspector"] as Panel[]).map((p) => (
              <button
                key={p}
                ref={(el) => void (toggles.current[p] = el)}
                className="cl-tool cl-toggle"
                aria-expanded={open[p]}
                aria-controls={`cl-${p}`}
                onClick={() => togglePanel(p)}
                data-testid={`toggle-${p}`}
                title={p === "library" ? "Compositions" : "Inspector"}
              >
                <Icon name={p === "library" ? "panel-left" : "panel-right"} />
                <span className="cl-tool__text">{p === "library" ? "Compositions" : "Inspector"}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="cl-toolbar__row cl-toolbar__row--examples">
        <span className="cl-toolbar__label" id="cl-examples-label">
          Example data
        </span>
        <div className="cl-chips-wrap" data-more-start={chipEdges.start || undefined} data-more-end={chipEdges.end || undefined}>
          <div className="cl-chips" role="group" aria-labelledby="cl-examples-label" data-testid="scenario-chips" ref={chipsRef} onScroll={measureChips}>
            {definition.scenarios.map((s) => (
              <button
                key={s.id}
                className={`cl-chip${s.id === scenario?.id ? " cl-chip--on" : ""}`}
                aria-pressed={s.id === scenario?.id}
                onClick={() => persist({ ...prefs, scenario: s.id })}
                // A chip that takes focus is scrolled fully into view, clear of the edge fades.
                onFocus={(e) => e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" })}
                data-testid={`scenario-${s.id}`}
              >
                {scenarioName(s, definition.id)}
                {s.expect === "refused" ? <> <span className="cl-chip__note">· should be refused</span></> : null}
              </button>
            ))}
          </div>
        </div>
      </div>
      {!governed && (
        <p className="cl-note cl-note--warn" role="status">
          Try-out, this session only: a stricter rule needs four options in a review. Nothing is saved, and the Astryx rules are unchanged.
        </p>
      )}
    </div>
  );

  const canvas = (
    <section className="cl-canvas" aria-labelledby="cl-canvas-title">
      {!definition || !entry ? (
        <Empty title="Nothing selected">Choose a composition from the list.</Empty>
      ) : (
        <>
          {toolbar}
          <CanvasBody
            shown={shown}
            definition={definition}
            scenario={scenario}
            outcome={outcome}
            onAction={onAction}
            catalog={governor.catalog("0.9.1")}
            recheck={recheckNow}
            failing={failing}
            nameOf={nameOf}
            ruleText={ruleText}
            onCanvasClick={onCanvasClick}
            fitWidth={fitWidth}
            clearState={() => persist({ ...prefs, state: null })}
            editExample={definition.status === "draft" && governed && scenario ? () => editExample(scenario.id) : undefined}
            previewing={previewing && preview}
            openRestore={() => {
              setLifecycle("restore");
              setTab("design");
              showInspector();
            }}
            selection={{ ids: selectedIds, primary: pickedId, selectMode: selectMode && !!elements, onPick: pickOnCanvas, label: "Click an element to select it" }}
          />
          {selectMode && elements && (
            <p className="cl-note cl-select-note" role="status" data-testid="select-note">
              Select is on: click an element to inspect it. Buttons and fields do nothing until you turn Select off (Escape).
            </p>
          )}
          {lastAction && (
            // R4: pinned to the bottom of the visible canvas, so the feedback is seen where the button was pressed.
            <div className="cl-action" role="status" data-testid="action-note">
              <p>
                {lastAction.name === null ? (
                  <>
                    <strong>Preview only.</strong> {lastAction.label ? <>&ldquo;{lastAction.label}&rdquo;</> : "That button"} sends nothing.
                  </>
                ) : (
                  <>
                    <strong>Preview only, not run.</strong> {lastAction.label ? <>&ldquo;{lastAction.label}&rdquo;</> : sentence(humanize(lastAction.name))} would send{" "}
                    {Object.keys(lastAction.context).length ? Object.entries(lastAction.context).map(([k, v]) => plainValue(k, v)).join(", ") : "nothing else"}.
                    {lastAction.consequential ? " In a running flow, this runs only once, and only from this confirmation." : ""}
                  </>
                )}
              </p>
              <button className="cl-tool" onClick={() => setLastAction(null)} aria-label="Dismiss the action preview">
                Dismiss
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );

  // ---- Inspector --------------------------------------------------------------------------------------------

  const tabs: Tab[] = definition?.status === "draft" ? ["design", "examples", "checks"] : ["design", "checks"];
  const activeTab: Tab = tabs.includes(tab) ? tab : "design";
  const onTabKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const at = tabs.indexOf(activeTab);
    const next: Tab = e.key === "Home" ? tabs[0]! : e.key === "End" ? tabs[tabs.length - 1]! : tabs[(at + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]!;
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  /** Open the inspector at an example, to edit it (from a failing check or a refusal on the canvas). */
  const editExample = (id: string) => {
    persist({ ...prefs, scenario: id, state: null, panel: "inspector" });
    setTab("examples");
    showInspector();
  };
  const ruleLabel = (rule: string) => (rule === "data" ? "Invalid data (the data checks)" : rule === "state" ? "The chosen state does not fit (the state guard)" : (RULE_LEADS[rule] ? `${sentence(humanize(rule))}: ${RULE_LEADS[rule]}` : sentence(humanize(rule))));
  const draftResults = definition?.status === "draft" && checkCurrent && check ? new Map(check.scenarios.map((x) => [x.id, x])) : null;

  const versionsList = entry && definition && (
    <ul className="cl-versions" data-testid="versions">
      {entry.versions.map((v) => (
        <li key={v.version} className={v.version === definition.version ? "cl-versions__on" : undefined}>
          <span className={`cl-badge${v.status === "approved" && !isWithdrawn(v) ? " cl-badge--ok" : ""}`}>v{v.version}</span>{" "}
          {v.status === "approved" && isWithdrawn(v)
            ? "Approved, then its approval was withdrawn on this device: it is unchanged, and nothing may use it until approval is restored."
            : v.status === "approved"
            ? ready.loaded.origin.get(versionKey(v.id, v.version)) === "device"
              ? "Approved on this device: a person approved this exact version here, and it cannot change."
              : "Approved: a person approved this exact version, and it cannot change."
            : "Draft: not approved for use by agents."}
          {v.version === definition.version ? " (shown)" : ""}
        </li>
      ))}
    </ul>
  );

  const inspector = (
    <aside
      id="cl-inspector"
      className={`cl-panel cl-panel--inspector${open.inspector ? " cl-panel--open" : ""}`}
      {...drawerProps("inspector")}
      hidden={!open.inspector}
      tabIndex={-1}
      ref={(el) => void (panels.current.inspector = el)}
      data-testid="inspector"
    >
      <div className="cl-panel__head">
        <h2 className="cl-h" id="cl-inspector-title">
          Inspector
        </h2>
        {layout === "narrow" && (
          <button className="cl-tool" onClick={() => closeDrawer("inspector")}>
            Close
          </button>
        )}
      </div>
      {definition && (
        <>
          <p className="cl-crumbs" aria-label="Inspecting">
            {definition.name} · v{definition.version}
          </p>
          <div className="cl-tabs" role="tablist" aria-label="Inspector views">
            {tabs.map((t) => (
              <button
                key={t}
                role="tab"
                id={`cl-tab-${t}`}
                aria-selected={activeTab === t}
                aria-controls={`cl-tabpanel-${t}`}
                tabIndex={activeTab === t ? 0 : -1}
                className={`cl-tab${activeTab === t ? " cl-tab--on" : ""}`}
                onClick={() => setTab(t)}
                onKeyDown={onTabKey}
                ref={(el) => void (tabRefs.current[t] = el)}
                data-testid={`tab-${t}`}
              >
                {t === "design" ? (definition.status === "draft" ? "Details" : "Design") : t === "examples" ? "Examples" : "Checks"}
                {t === "checks" && check && checkCurrent && !check.approval ? <span className="cl-tab__flag"> · fails</span> : null}
              </button>
            ))}
          </div>

          {notice && (
            <p className={`cl-notice cl-notice--${notice.tone}`} role={notice.tone === "bad" ? "alert" : "status"} data-testid="authoring-notice">
              {notice.text}
            </p>
          )}
          <div role="tabpanel" id="cl-tabpanel-design" aria-labelledby="cl-tab-design" hidden={activeTab !== "design"} data-testid="tabpanel-design">
            {selectedTrail ? (
              <ElementInspector
                key={`${key}-${selectedTrail.at(-1)!.key}`}
                definition={definition}
                editable={definition.status === "draft" && governed}
                trail={selectedTrail}
                statesWith={statesOfSelected}
                shownState={shownState}
                onCanvas={selectedIds.length}
                item={itemContext}
                edit={applyTracked}
                select={(k) => selectElement(k)}
                stateLabel={stateName}
                componentIds={selectedIds}
                contract={contract}
                content={contentApi}
                contentStates={selection && editState ? statesShowing(definition, editState, selection.key) : []}
                suggestId={uniqueId(definition, selectedTrail.at(-1)!.component ?? "element")}
              />
            ) : (
            <>
            {definition.status === "draft" ? (
              <>
                <DetailsEditor key={key} definition={definition} edit={applyEdit} />
                <ParametersEditor key={`${key}-p`} definition={definition} edit={applyEdit} />
              </>
            ) : (
              <Section title="What it is">
                <p className="cl-text">{definition.summary}</p>
              </Section>
            )}
            <Section title="Versions">
              {versionsList}
              {definition.status === "approved" && governed && entry && (
                entry.draft ? (
                  <button className="cl-tool" onClick={() => openDraft(entry.draft!.version)} data-testid="open-draft">
                    Open draft v{entry.draft.version}
                  </button>
                ) : (
                  <p className="cl-text">To change this composition, create a draft: v{definition.version} stays approved and unchanged while you work.</p>
                )
              )}
              {definition.status === "approved" && governed && (
                <ApprovalLifecycle
                  version={definition.version}
                  withdrawn={isWithdrawn(definition)}
                  origin={ready.loaded.origin.get(key) === "device" ? "device" : "packaged"}
                  open={lifecycle}
                  setOpen={setLifecycle}
                  busy={lifecycleBusy}
                  withdraw={withdrawNow}
                  restore={restoreNow}
                />
              )}
              <p className="cl-text" data-testid="publication-note">
                <strong>Published for agents: no.</strong> Publishing is not available yet. Passing checks or being approved does not publish a version.
              </p>
            </Section>
            {definition.status === "draft" && (
              <p className="cl-dim cl-structure-note" data-testid="structure-note">To change what a person types into an element or what pressing it sends, select it on the canvas (Select) or in Structure. Adding, removing or moving elements is not available yet.</p>
            )}
            <Section title="Data it needs">
              <ul className="cl-plain">
                {[...definition.parameters, ...definition.data].map((p) => (
                  <li key={String(p.name)}>
                    <strong>{sentence(humanize(String(p.name)))}</strong>: {typeLabel(p as Json)}
                    {(p as Json).required ? "" : ", optional"}
                  </li>
                ))}
              </ul>
            </Section>
            <Section title="What a person can do">
              <ul className="cl-plain">
                {definition.actions.map((a) => (
                  <li key={a.name}>
                    <button className="cl-link" onClick={() => selectElement(`#${a.node}`)} data-testid={`inspect-action-${a.name}`}>
                      <strong>{sentence(humanize(a.name))}</strong>
                    </button>
                    {a.repeat ? `, on each ${humanize(a.repeat.as)}` : ""}
                    {a.payload && Object.keys(a.payload).length ? `: sends the ${Object.keys(a.payload).map(humanize).join(", ")}` : ""}
                    {a.carries?.length ? `${a.payload && Object.keys(a.payload).length ? " and" : ":"} sends what was typed` : ""}
                    {a.consequential ? ". Consequential: asks for confirmation first" : ""}
                  </li>
                ))}
              </ul>
            </Section>
            {definition.inputs.length > 0 && (
              <Section title="What a person can type">
                <ul className="cl-plain">
                  {definition.inputs.map((i) => (
                    <li key={i.name}>
                      <button className="cl-link" onClick={() => selectElement(`#${i.node}`)} data-testid={`inspect-input-${i.name}`}>
                        <strong>{sentence(humanize(i.name))}</strong>
                      </button>
                      {i.required ? "" : ", optional"}
                      {i.sensitive ? ". Private: used once for its action, never kept or shown" : ""}
                    </li>
                  ))}
                </ul>
              </Section>
            )}
                      </>
            )}
</div>

          {definition.status === "draft" && (
            <div role="tabpanel" id="cl-tabpanel-examples" aria-labelledby="cl-tab-examples" hidden={activeTab !== "examples"} data-testid="tabpanel-examples">
              <ExamplesEditor
                key={key}
                definition={definition}
                edit={applyEdit}
                selected={scenario}
                select={(id) => persist({ ...prefs, scenario: id, state: null })}
                contract={ready.governors.get("none")!.contract}
                ruleLabel={ruleLabel}
                nameOf={(s) => scenarioName(s, definition.id)}
                refusingRule={shown && !shown.ok ? (((shown.refusal as Json).failures?.[0]?.rule as string | undefined) ?? ((shown.refusal as Json).stage === "data" ? "data" : undefined)) : undefined}
                results={draftResults}
              />
            </div>
          )}

          <div role="tabpanel" id="cl-tabpanel-checks" aria-labelledby="cl-tab-checks" hidden={activeTab !== "checks"} data-testid="tabpanel-checks">
            <Section title="Design rules">
              {definition.status === "draft" && checking === key ? (
                <p className="cl-text" data-testid="check-status" data-check="checking" role="status">
                  Checking all {definition.scenarios.length} examples…
                </p>
              ) : definition.status === "draft" && governed && !checkCurrent ? (
                <p className="cl-warn" data-testid="check-status" data-check="unchecked">
                  {check ? "Changed since its last check." : "Not checked yet."} Run the checks to see whether every example behaves as expected.
                </p>
              ) : !check ? (
                <p className="cl-warn" data-testid="check-status" data-check="unchecked">
                  Needs a new check: not yet checked under {rules}. Nothing new is shown from this version until its examples pass.
                </p>
              ) : check.approval ? (
                <p className="cl-ok" data-testid="check-status" data-check="pass">
                  Checks pass: all {check.scenarios.length} examples behave as expected under {rules}.
                </p>
              ) : (
                <p className="cl-bad" data-testid="check-status" data-check="fail">
                  Checks fail under {rules}: {failing.map(nameOf).join(", ")} {failing.length === 1 ? "does" : "do"} not behave as expected. Nothing runs from this version under these rules.
                </p>
              )}
              {definition.status === "draft" && (
                <p className="cl-dim" data-testid="draft-check-note">
                  Still a draft: passing checks does not approve it for agents. Approving a version is a separate, explicit decision.
                </p>
              )}
              {check && !(definition.status === "draft" && !checkCurrent) && (
                <table className="cl-table">
                  <thead>
                    <tr>
                      <th scope="col">Example</th>
                      <th scope="col">Expected</th>
                      <th scope="col">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {check.scenarios.map((s) => (
                      <tr key={s.id} data-testid={`check-row-${s.id}`}>
                        <td>
                          {nameOf(s.id)}
                          {!s.matches && definition.status === "draft" && checkCurrent && (
                            <>
                              <span className="cl-check-why" data-testid={`check-why-${s.id}`}>
                                {whatToDo(s, ruleText)}
                              </span>
                              <button className="cl-tool cl-check-edit" onClick={() => editExample(s.id)} data-testid={`edit-example-${s.id}`}>
                                Edit this example
                              </button>
                            </>
                          )}
                        </td>
                        <td>{s.expect === "refused" ? "Refused by a rule" : "Shown"}</td>
                        <td className={s.matches ? "cl-ok" : "cl-bad"}>
                          {s.matches ? "✓ As expected" : `✗ ${s.outcome === "ok" ? "Shown" : "Refused"}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {check && governed && !(definition.status === "draft" && !checkCurrent) && (
                <p className="cl-dim" data-testid="device-record">
                  {check.previous.status === "none"
                    ? "On this device: these checks are recorded for the first time."
                    : check.previous.status === "current"
                      ? "On this device: the same as the checks recorded earlier."
                      : `On this device: the earlier checks ran under another ${check.previous.changed.join(", ")}; checked again now.`}
                </p>
              )}
            </Section>
            <Section title="Show a specific state">
              <label className="cl-label" htmlFor="cl-state">
                State
              </label>
              <select id="cl-state" className="af-select" value={prefs.state ?? ""} onChange={(e) => persist({ ...prefs, state: e.target.value || null })} data-testid="state-select">
                <option value="">Chosen by the example data{instance ? ` (now: ${humanize(instance.state)})` : ""}</option>
                {definition.states.map((s) => {
                  const reachable = !!scenario && guardHolds(s.guard, { ...(scenario.data as Json) });
                  return (
                    <option key={s.id} value={s.id}>
                      {sentence(humanize(s.id))}
                      {reachable ? "" : " (not available with this example)"}
                    </option>
                  );
                })}
              </select>
              <p className="cl-dim">The example data normally chooses the state. A state an example cannot reach is refused, with the reason.</p>
            </Section>
            <Section title="Try a rule change">
              <button className="cl-tool" aria-pressed={!governed} onClick={() => changeRules(governed ? "four-options" : "none")} data-testid="what-if">
                {governed ? "Try a stricter rule (this session only)" : "Restore the Astryx rules"}
              </button>
              <p className="cl-dim">Requires four options in a review instead of two, to show what happens when the rules change. Nothing is stored.</p>
            </Section>
          </div>

          <details className="cl-tech" data-testid="technical-details">
            <summary>Technical details</summary>
            <Facts
              rows={[
                ["Composition id", <code key="id">{definition.id}</code>],
                ["Version", `v${definition.version} · ${definition.status}`],
                ["Definition hash", check?.approval ? short(check.approval.pins.compositionSha256) : "after checks pass"],
                ["Contract", `Astryx reference · ${short(governor.contractSha256)}`],
                ["Toolchain", `lint ${toolchain.lint} · emit ${toolchain.emit} · runtime ${toolchain.runtime}`],
                ["What runs", "The design system's rules (S1–S3) and the catalog gates (A1–A3)"],
                ...(instance
                  ? ([
                      ["State", `${instance.state} · ${purposeLabel(instance.purpose)}`],
                      ["Surface id", <code key="sid">{instance.surfaceId}</code>],
                      ["Instantiation", `${instance.timings.totalMs.toFixed(1)} ms in this browser`],
                    ] as Array<[string, ReactNode]>)
                  : []),
                ...(check ? ([["Rules behind expected refusals", check.scenarios.filter((s) => s.refusedBy).map((s) => `${nameOf(s.id)}: ${s.refusedBy}`).join("; ") || "none"]] as Array<[string, ReactNode]>) : []),
              ]}
            />
            {instance && (
              <table className="cl-table">
                <thead>
                  <tr>
                    <th scope="col">Action</th>
                    <th scope="col">Payload</th>
                  </tr>
                </thead>
                <tbody>
                  {instance.actions.map((a) => (
                    <tr key={a.componentId}>
                      <td>
                        <code>{a.name}</code>
                        {a.consequential ? " (consequential)" : ""}
                      </td>
                      <td>
                        <code>{JSON.stringify({ ...a.payload, ...Object.fromEntries(a.carries.map((c) => [c, "typed"])) })}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {lastAction && lastAction.name !== null && (
              <p className="cl-dim">
                Last preview, recordable form: <code data-testid="action-raw">{JSON.stringify({ name: lastAction.name, context: lastAction.context })}</code>
              </p>
            )}
          </details>

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
          {(ready.loaded.stored.status.drafts === "malformed" || ready.loaded.stored.status.versions === "malformed" || ready.loaded.stored.status.drafts === "incompatible" || ready.loaded.stored.status.versions === "incompatible") && (
            <p className="cl-notice cl-notice--warn" data-testid="authoring-storage-note">
              Drafts or approvals saved on this device could not be read, so they are not shown. They are kept as they are.
            </p>
          )}
          {definition.status === "draft" && governed && (
            <AuthoringBar
              definition={definition}
              approvedVersion={approvedVersion}
              state={draftState!}
              failing={draftResults ? [...draftResults.values()].filter((x) => !x.matches).length : 0}
              confirm={confirm}
              setConfirm={setConfirm}
              runChecks={recheckNow}
              approve={approveNow}
              discard={discardNow}
              packaged={origin === "packaged"}
              blocking={interactionIssues(definition)}
              fixBlocking={() => {
                const first = interactionIssues(definition)[0];
                if (first) void applyEdit((d) => applyInputChange(d, first.fix)).then((problem) => setAnnounce(problem ? `Not applied: ${problem}` : "The private field is masked. Run the checks again."));
              }}
            />
          )}
        </>
      )}
    </aside>
  );

  return (
    <Frame layout={layout} mode={frameMode} top={headerHeight} open={open}>
      {header}
      <h1 className="cl-sr">Composition Library</h1>
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

interface Outcome {
  state: "loading" | "pass" | "expected" | "refused" | "unchecked" | "fail" | "withdrawn";
  tone: "ok" | "neutral" | "bad" | "warn";
  icon: string;
  pill: string;
}

/** What the canvas says about the current selection, in one short phrase. */
function describeOutcome(shown: ShowResult | null, scenario: Scenario | undefined, definition: CompositionDefinition | undefined, check: VersionCheck | undefined, failing: string[], nameOf: (id: string) => string): Outcome {
  void definition;
  void nameOf;
  if (!shown) return { state: "loading", tone: "neutral", icon: "…", pill: "Checking" };
  if (shown.ok) return { state: "pass", tone: "ok", icon: "✓", pill: "Passes the design rules" };
  const refusal = shown.refusal as Json;
  if (refusal.stage === "withdrawn") return { state: "withdrawn", tone: "warn", icon: "⊘", pill: "Approval withdrawn" };
  if (refusal.stage === "needs-recheck") return failing.length || (check && !check.approval) ? { state: "fail", tone: "bad", icon: "✗", pill: "Fails the changed rules" } : { state: "unchecked", tone: "warn", icon: "!", pill: "Needs a new check" };
  const rule = refusal.failures?.[0]?.rule as string | undefined;
  const expected = scenario?.expect === "refused" && !!scenario.refusedBy && (scenario.refusedBy === rule || scenario.refusedBy === refusal.stage);
  return expected ? { state: "expected", tone: "neutral", icon: "○", pill: "Not shown, as expected" } : { state: "refused", tone: "bad", icon: "✗", pill: "Not shown" };
}

function CanvasBody({
  shown,
  definition,
  scenario,
  outcome,
  onAction,
  catalog,
  recheck,
  failing,
  nameOf,
  ruleText,
  onCanvasClick,
  fitWidth,
  clearState,
  editExample,
  previewing,
  selection,
  openRestore,
}: {
  /** For a version whose approval is withdrawn: open its restore confirmation in the inspector. */
  openRestore?: () => void;
  /** Canvas selection (advanced authoring): the selected element's components, the picked one, and Select mode. */
  selection: { ids: string[]; primary: string | null; selectMode: boolean; onPick: (componentId: string) => void; label: string };
  shown: ShowResult | null;
  definition: CompositionDefinition;
  scenario: Scenario | undefined;
  outcome: Outcome;
  onAction: (a: A2uiClientAction) => void;
  catalog: Json;
  recheck: () => void;
  /** Examples that failed the latest check under the current rules, if it failed. */
  failing: string[];
  nameOf: (id: string) => string;
  ruleText: (ruleId: string | undefined) => { lead: string | null; rationale: string | null };
  onCanvasClick: (target: HTMLElement) => void;
  fitWidth: boolean;
  clearState: () => void;
  /** For a draft: open the inspector at this example (M1 authoring). */
  editExample?: () => void;
  /** The draft is shown as an unchecked preview of its edits. */
  previewing: boolean;
}) {
  const registry = useMemo(() => registryFor("astryx", catalog), [catalog]);
  const scope = canvasScopeFor("astryx");
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  // In Select mode the canvas is inert (nothing typed, pressed or focused in it); the layer beside it selects.
  const frame = (instance: Instance, dimmed = false) => (
    <div className={`cl-stage${fitWidth ? " cl-stage--fit" : ""}${!dimmed && selection.selectMode ? " cl-stage--select" : ""}`} ref={dimmed ? undefined : stageRef}>
      <div
        {...scope.attrs}
        className={`cl-frame${dimmed ? " cl-frame--kept" : ""}`}
        style={{ background: scope.background }}
        data-project-canvas="composer"
        data-surface={instance.surfaceId}
        inert={dimmed || selection.selectMode || undefined}
        onClickCapture={dimmed ? undefined : (e) => onCanvasClick(e.target as HTMLElement)}
        ref={dimmed ? undefined : frameRef}
      >
        <A2uiCanvas key={instance.surfaceId} catalog={catalog} registry={registry} messages={instance.messages as unknown[]} onAction={dimmed ? undefined : onAction} />
      </div>
      {!dimmed && <SelectionLayer key={instance.surfaceId} stage={stageRef} frame={frameRef} selected={selection.ids} primary={selection.primary} selectMode={selection.selectMode} onPick={selection.onPick} label={selection.label} />}
    </div>
  );
  if (!shown) return <p className="cl-loading" role="status">Showing the composition…</p>;
  if (shown.ok)
    return previewing ? (
      <>
        <p className="cl-preview-note" data-testid="preview-note">
          Preview of this draft: not checked yet.
        </p>
        {frame(shown.instance)}
      </>
    ) : (
      frame(shown.instance)
    );

  const refusal = shown.refusal as Json;
  const rule = refusal.failures?.[0]?.rule as string | undefined;
  const technical = (
    <details className="cl-tech cl-tech--inline">
      <summary>Technical details</summary>
      <p>
        Stage <code>{String(refusal.stage)}</code>
        {rule ? (
          <>
            {" "}
            · rule <code>{rule}</code>
          </>
        ) : null}
      </p>
      {ruleText(rule).rationale && <p data-testid="refusal-rationale">Rule rationale: {ruleText(rule).rationale}</p>}
      <p>
        <code>{String(refusal.reason)}</code>
      </p>
    </details>
  );
  let title: string;
  let body: ReactNode;
  let next: ReactNode = null;
  if (outcome.state === "withdrawn") {
    title = "Approval withdrawn on this device";
    body = <p>{definition.name} v{definition.version} is unchanged, but its approval was withdrawn: nothing new is shown from it and nothing on a screen already shown runs. No other version is used in its place.</p>;
    next = openRestore ? (
      <button className="cl-tool" onClick={openRestore} data-testid="refusal-restore">
        Restore approval…
      </button>
    ) : null;
  } else if (outcome.state === "unchecked" || outcome.state === "fail") {
    title = outcome.state === "fail" ? "Checks fail under these rules" : "Needs a new check";
    body = <p>The rules changed since {definition.name} v{definition.version} was last checked, so nothing new is shown from it until its examples pass again.</p>;
    next = (
      <>
        {failing.length > 0 && (
          <p data-testid="recheck-failed">
            {failing.map(nameOf).join(", ")} no longer {failing.length === 1 ? "behaves" : "behave"} as expected. Nothing runs from this version under these rules, and nothing shown before is replaced.
          </p>
        )}
        <button className="cl-tool" onClick={recheck} data-testid="recheck">
          Run checks under these rules
        </button>
      </>
    );
  } else if (refusal.stage === "state") {
    title = "This example cannot be shown in that state";
    const requested = definition.states.find((s) => refusal.reason?.includes(`'${s.id}'`));
    body = <p>{requested ? `The “${sentence(humanize(requested.id))}” state ${plainGuard(requested.guard)}, and the “${scenario ? nameOf(scenario.id) : "current"}” example does not fit it.` : String(refusal.reason)}</p>;
    next = (
      <button className="cl-tool" onClick={clearState}>
        Show the state the example chooses
      </button>
    );
  } else if (outcome.state === "expected") {
    title = "Not shown, as expected";
    body = <p className="cl-refusal__lead">{ruleText(rule).lead ?? "A design rule refuses this data."}</p>;
    next = <p>This example exists to show the rule at work. Choose another example to see the composition.</p>;
  } else if (refusal.stage === "data") {
    title = "Not shown: this data does not fit the composition";
    body = (
      <ul className="cl-plain cl-refusal__lead" data-testid="refusal-data">
        {plainDataReason(String(refusal.reason)).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    );
    next = editExample ? (
      <button className="cl-tool" onClick={editExample} data-testid="refusal-edit-example">
        Edit this example
      </button>
    ) : (
      <p>What you can do: choose another example, or create a draft to change this one.</p>
    );
  } else {
    title = "Not shown: this data breaks a design rule";
    body = <p className="cl-refusal__lead">{ruleText(rule).lead ?? String(refusal.reason)}</p>;
    next = editExample ? (
      <>
        <p>What you can do: change this example&rsquo;s data so the rule holds, or expect the rule to refuse it.</p>
        <button className="cl-tool" onClick={editExample} data-testid="refusal-edit-example">
          Edit this example
        </button>
      </>
    ) : (
      <p>What you can do: choose another example, or create a draft to change this one.</p>
    );
  }
  return (
    <>
      <div className={`cl-refusal cl-refusal--${outcome.tone}`} role="status" data-testid="refusal" data-stage={refusal.stage} data-expected={outcome.state === "expected" ? "true" : "false"}>
        <p className="cl-refusal__title">{title}</p>
        {body}
        {next}
        {technical}
      </div>
      {shown.kept && (
        <details className="cl-kept" data-testid="kept-instance">
          <summary>{previewing ? "Last valid preview · not interactive" : "Previous screen · not interactive"}</summary>
          <p className="cl-dim">In a running flow, the previous screen stays while the new data is refused. It is shown here for comparison only.</p>
          {frame(shown.kept, true)}
        </details>
      )}
    </>
  );
}

/** What a designer can do about an example that did not behave as expected (A3). */
function whatToDo(s: { expect: "ok" | "refused"; outcome: "ok" | "refused"; refusedBy?: string; stage?: string; rules?: string[]; reason?: string }, ruleText: (rule: string | undefined) => { lead: string | null }): string {
  const rule = s.rules?.[0];
  if (s.expect === "ok") {
    if (s.stage === "data") return `Its data does not fit: ${plainDataReason(s.reason).join("; ") || "invalid data"}. Correct the data.`;
    if (s.stage === "state") return "Its state does not fit its data. Choose another state, or let the data choose it.";
    return `A design rule refuses it: ${ruleText(rule).lead ?? humanize(rule ?? s.stage ?? "a rule")} Change its data so the rule holds, or expect the rule to refuse it.`;
  }
  if (s.outcome === "ok") return `It is shown, but it should be refused${s.refusedBy ? ` by “${humanize(s.refusedBy)}”` : ""}. Change its data so the rule applies, or expect it to be shown.`;
  return `It is refused by “${humanize(rule ?? s.stage ?? "another check")}”, not by “${humanize(s.refusedBy ?? "the rule chosen")}”. Choose that rule, or change its data.`;
}

/**
 * The draft's lifecycle actions, at the foot of the inspector (A3, A4, A1): one primary action for the state
 * it is in, and confirmations written out in full before anything irreversible happens.
 */
function AuthoringBar({
  definition,
  approvedVersion,
  state,
  failing,
  confirm,
  setConfirm,
  runChecks,
  approve,
  discard,
  packaged,
  blocking,
  fixBlocking,
}: {
  definition: CompositionDefinition;
  blocking: Array<{ text: string }>;
  fixBlocking: () => void;
  approvedVersion: number | undefined;
  state: "checking" | "unchecked" | "pass" | "fail";
  failing: number;
  confirm: "approve" | "discard" | null;
  setConfirm: (c: "approve" | "discard" | null) => void;
  runChecks: () => void;
  approve: () => void;
  discard: () => void;
  packaged: boolean;
}) {
  const v = definition.version;
  if (confirm === "approve") {
    return (
      <div key="approve" className="cl-bar cl-bar--confirm" role="group" aria-labelledby="cl-approve-title" data-testid="approve-confirm">
        <p className="cl-bar__title" id="cl-approve-title">
          Approve v{v} on this device?
        </p>
        <ul className="cl-plain">
          <li>v{v} becomes approved and can no longer change. Further changes need a new draft.</li>
          {approvedVersion !== undefined && <li>v{approvedVersion} and every other approved version stay available.</li>}
          <li>The approval is recorded on this device only.</li>
          <li>It is not published: no external agent can use it.</li>
        </ul>
        <div className="cl-bar__actions">
          <button className="cl-tool cl-tool--primary" onClick={approve} data-testid="approve-confirm-button">
            Approve v{v} on this device
          </button>
          <button className="cl-tool" onClick={() => setConfirm(null)} autoFocus>
            Cancel
          </button>
        </div>
      </div>
    );
  }
  if (confirm === "discard") {
    return (
      <div key="discard" className="cl-bar cl-bar--confirm" role="group" aria-labelledby="cl-discard-title" data-testid="discard-confirm">
        <p className="cl-bar__title" id="cl-discard-title">
          Discard draft v{v}?
        </p>
        <p className="cl-text">{packaged ? "This sample draft is withdrawn on this device. " : "Its changes and examples are removed from this device. "}The approved versions are not affected. This cannot be undone here.</p>
        <div className="cl-bar__actions">
          <button className="cl-tool cl-tool--danger" onClick={discard} data-testid="discard-confirm-button">
            Discard draft v{v}
          </button>
          <button className="cl-tool" onClick={() => setConfirm(null)} autoFocus>
            Keep the draft
          </button>
        </div>
      </div>
    );
  }
  const line =
    state === "checking"
      ? "Running the checks…"
      : state === "unchecked"
        ? "Changed since its last check. Run the checks before it can be approved."
        : state === "fail"
          ? `Checks fail: ${failing === 1 ? "1 example does" : `${failing} examples do`} not behave as expected. Fix ${failing === 1 ? "it" : "them"} in Examples, then run the checks again.`
          : "Checks pass under the Astryx rules. It can be approved; it is not approved yet.";
  return (
    <div key="bar" className="cl-bar" data-testid="authoring-bar" data-state={state}>
      <p className={`cl-bar__line${state === "fail" ? " cl-bad" : state === "pass" ? " cl-ok" : ""}`} role="status">
        {line}
      </p>
      {blocking.length > 0 && (
        <p className="cl-bar__line cl-warn" data-testid="approval-blocked">
          {blocking[0]!.text}{" "}
          <button className="cl-link" onClick={fixBlocking} data-testid="mask-fix">
            Mask the field
          </button>
        </p>
      )}
      <div className="cl-bar__actions">
        {state === "pass" && blocking.length === 0 ? (
          <button className="cl-tool cl-tool--primary" onClick={() => setConfirm("approve")} data-testid="approve">
            Approve version…
          </button>
        ) : (
          <button className="cl-tool cl-tool--primary" onClick={runChecks} disabled={state === "checking"} aria-disabled={state === "checking"} data-testid="run-checks">
            {state === "checking" ? "Checking…" : "Run checks"}
          </button>
        )}
        {state === "pass" && blocking.length === 0 && (
          <button className="cl-tool" onClick={runChecks} data-testid="run-checks-again">
            Run checks again
          </button>
        )}
        <button className="cl-tool" onClick={() => setConfirm("discard")} data-testid="discard">
          Discard draft…
        </button>
      </div>
    </div>
  );
}

/**
 * Withdraw or restore an approved version's approval on this device (decision 34), with the consequences written
 * out before anything happens. Withdrawal changes authorization only; the definition stays exactly as it is.
 */
function ApprovalLifecycle({ version, withdrawn, origin, open, setOpen, busy, withdraw, restore }: { version: number; withdrawn: boolean; origin: "packaged" | "device"; open: "withdraw" | "restore" | null; setOpen: (o: "withdraw" | "restore" | null) => void; busy: boolean; withdraw: () => void; restore: () => void }) {
  if (open === "withdraw" && !withdrawn) {
    return (
      <div className="cl-bar cl-bar--confirm" role="group" aria-labelledby="cl-withdraw-title" data-testid="withdraw-confirm">
        <p className="cl-bar__title" id="cl-withdraw-title">
          Withdraw the approval of v{version} on this device?
        </p>
        <ul className="cl-plain">
          <li>v{version} stays exactly as it is: its definition and its recorded checks do not change.</li>
          <li>Nothing may use it until its approval is restored: nothing new is shown from it, and nothing on a screen already shown runs.</li>
          <li>No other version is used in its place.</li>
          <li>{origin === "packaged" ? "It is a packaged approval: it is withdrawn on this device only, by a local record." : "It was approved on this device; the withdrawal is recorded here."}</li>
          <li>Restoring it later needs your decision and checks that pass at that time.</li>
        </ul>
        <div className="cl-bar__actions">
          <button className="cl-tool cl-tool--danger" onClick={withdraw} disabled={busy} data-testid="withdraw-confirm-button">
            Withdraw approval of v{version}
          </button>
          <button className="cl-tool" onClick={() => setOpen(null)} autoFocus>
            Keep it approved
          </button>
        </div>
      </div>
    );
  }
  if (open === "restore" && withdrawn) {
    return (
      <div className="cl-bar cl-bar--confirm" role="group" aria-labelledby="cl-restore-title" data-testid="restore-confirm">
        <p className="cl-bar__title" id="cl-restore-title">
          Restore the approval of v{version} on this device?
        </p>
        <ul className="cl-plain">
          <li>Its checks run again now; it is restored only if every example behaves as expected.</li>
          <li>v{version} itself does not change. It is not published.</li>
        </ul>
        <div className="cl-bar__actions">
          <button className="cl-tool cl-tool--primary" onClick={restore} disabled={busy} data-testid="restore-confirm-button">
            {busy ? "Checking…" : `Run checks and restore v${version}`}
          </button>
          <button className="cl-tool" onClick={() => setOpen(null)} autoFocus>
            Cancel
          </button>
        </div>
      </div>
    );
  }
  return withdrawn ? (
    <div data-testid="approval-withdrawn">
      <p className="cl-warn">The approval of v{version} is withdrawn on this device. Nothing may use it until approval is restored.</p>
      <button className="cl-tool" onClick={() => setOpen("restore")} data-testid="restore">
        Restore approval…
      </button>
    </div>
  ) : (
    <button className="cl-tool" onClick={() => setOpen("withdraw")} data-testid="withdraw">
      Withdraw approval…
    </button>
  );
}

/** What a draft changes from the approved version it follows, in a designer's words (M1 authoring). */
function describeChanges(base: CompositionDefinition, draft: CompositionDefinition): string[] {
  const paths = definitionDifferences(base, draft);
  const out: string[] = [];
  if (paths.includes("/name")) out.push(`The name reads “${draft.name}”.`);
  if (paths.includes("/summary")) out.push("The summary is reworded.");
  const params = new Set(paths.filter((p) => p.startsWith("/parameters[")).map((p) => Number(p.slice(12, p.indexOf("]")))));
  for (const i of params) out.push(`The “${humanize(String((draft.parameters[i] ?? base.parameters[i])?.name ?? "parameter"))}” parameter changed.`);
  const name = (s: Scenario, c: CompositionDefinition) => scenarioName(s, c.id);
  const before = new Map(base.scenarios.map((s) => [s.id, s]));
  const after = new Map(draft.scenarios.map((s) => [s.id, s]));
  for (const [id, s] of after) {
    const old = before.get(id);
    if (!old) out.push(`New example: “${name(s, draft)}”.`);
    else if (JSON.stringify({ ...old, title: undefined }) !== JSON.stringify({ ...s, title: undefined })) out.push(`The “${name(s, draft)}” example changed.`);
    else if (old.title !== s.title && s.title && s.title !== name(old, base)) out.push(`The “${name(old, base)}” example is renamed “${s.title}”.`);
  }
  for (const [id, s] of before) if (!after.has(id)) out.push(`The “${name(s, base)}” example was removed.`);
  out.push(...describeInteractionChanges(base, draft));
  // Typed fields, actions and masks are described above; anything else in the template is structure.
  const rest = definitionDifferences(withoutMasks(base), withoutMasks(draft));
  if (rest.some((p) => !/^\/(name|summary|parameters\[|scenarios\[|inputs\[|actions\[)/.test(p))) out.push("Its structure differs from the approved version.");
  return out;
}

function Frame({ layout, mode, top, open, children }: { layout: Layout; mode: "fixed" | "flow"; top: number; open: Record<Panel, boolean>; children: ReactNode }) {
  return (
    <div
      className="cl"
      data-testid="composition-library"
      data-layout={layout}
      data-frame={mode}
      data-library={open.library ? "open" : "closed"}
      data-inspector={open.inspector ? "open" : "closed"}
      style={{ ["--cl-top" as string]: `${top}px` }}
    >
      <style>{CSS}</style>
      <div className="cl-body">{children}</div>
    </div>
  );
}

/** Small line icons for the view controls; decorative, so the button's text names it. */
function Icon({ name }: { name: "panel-left" | "panel-right" | "fit" | "select" }) {
  if (name === "select")
    return (
      <svg className="cl-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true" focusable="false">
        <path d="M3 2.5l9 5-4 1-2 4.5z" strokeLinejoin="round" />
      </svg>
    );
  return (
    <svg className="cl-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true" focusable="false">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      {name === "panel-left" && <line x1="6" y1="2.5" x2="6" y2="13.5" />}
      {name === "panel-right" && <line x1="10" y1="2.5" x2="10" y2="13.5" />}
      {name === "fit" && <path d="M4 8h8M4 8l2-2M4 8l2 2M12 8l-2-2M12 8l-2 2" />}
    </svg>
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

const CSS = withWorkspaceChoices(`
/* The experimental workspace's own, quieter type (D0.1): sentence case in the workspace's sans face, no
   tracked uppercase mono, a 12 px floor for labels and controls and 14 px for reading text. The AF palette is
   kept; the solid accent is left for primary actions, and none is offered in the read-only Library. */
.cl { --cl-panel-l: 280px; --cl-panel-r: 340px; --cl-target: 32px; display: flex; flex-direction: column; color: var(--fg-body); font-family: var(--sans); font-size: 14px; }
.cl[data-layout="narrow"] { --cl-target: 44px; }
.cl[data-frame="fixed"] { height: calc(100dvh - var(--cl-top, 60px)); min-height: 0; overflow: hidden; }
.cl :focus-visible { outline: 2px solid var(--green-bright); outline-offset: 2px; }
.cl-header-slot { display: flex; align-items: center; min-width: 0; }
.cl-head { display: inline-flex; align-items: center; gap: 10px; margin-left: 4px; position: relative; font-family: var(--sans); }
.cl-head__scope { font-size: 12px; color: var(--fg-dim); border: 1px solid var(--line); border-radius: 4px; padding: 2px 8px; white-space: nowrap; }
.cl-head__next summary { list-style: none; cursor: pointer; font-size: 12px; color: var(--fg-dim); white-space: nowrap; padding: 4px 2px; }
.cl-head__next summary:hover { color: var(--fg-body); }
.cl-head__next summary::-webkit-details-marker { display: none; }
.cl-head__next summary::after { content: " ▾"; }
.cl-head__pop { position: absolute; top: calc(100% + 8px); left: 0; z-index: 40; width: min(320px, 80vw); background: var(--bg-1); border: 1px solid var(--line); border-radius: 4px; box-shadow: var(--shadow-menu); padding: 10px 12px; font-size: 14px; line-height: 1.5; color: var(--fg-body); }
.cl-head__pop p { margin: 0 0 6px; }
.cl-body { position: relative; flex: 1; display: grid; grid-template-columns: minmax(0, 1fr); min-height: 0; }
.cl[data-layout="wide"] .cl-body, .cl[data-layout="medium"] .cl-body { grid-template-columns: auto minmax(0, 1fr) auto; grid-template-rows: minmax(0, 1fr); }
.cl-panel { background: var(--bg-1); border-color: var(--line); border-style: solid; border-width: 0; padding: 14px 16px; overflow: auto; min-width: 0; min-height: 0; outline: none; }
.cl-panel[hidden] { display: none; }
.cl-panel--library { width: var(--cl-panel-l); border-right-width: 1px; grid-column: 1; grid-row: 1; }
.cl-canvas { grid-column: 2; grid-row: 1; padding: 0 max(16px, env(safe-area-inset-left)) 24px; min-width: 0; min-height: 0; overflow: auto; position: relative; container: canvas / inline-size; }
.cl-panel--inspector { width: var(--cl-panel-r); border-left-width: 1px; grid-column: 3; grid-row: 1; }
.cl[data-layout="narrow"] .cl-canvas { grid-column: 1; overflow: visible; }
.cl[data-layout="narrow"] .cl-panel { position: fixed; z-index: 30; box-shadow: var(--shadow-menu); }
.cl[data-layout="narrow"] .cl-panel--library { inset: 0 auto 0 0; width: min(88vw, 380px); }
.cl[data-layout="narrow"] .cl-panel--inspector { inset: auto 0 0 0; width: 100%; height: min(82dvh, 680px); border-left-width: 0; border-top-width: 1px; border-radius: 12px 12px 0 0; padding-bottom: max(16px, env(safe-area-inset-bottom)); }
.cl-scrim { position: fixed; inset: 0; z-index: 25; background: rgba(0, 0, 0, 0.5); }
.cl-panel__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.cl-h { font-family: var(--sans); font-weight: 600; font-size: 16px; color: var(--fg); margin: 0; }
.cl-label { display: block; font-size: 12px; font-weight: 600; color: var(--fg-dim); margin: 0 0 6px; padding: 0; }
.cl-dim { color: var(--fg-dim); font-size: 14px; line-height: 1.5; margin: 8px 0; }
.cl-body p { overflow-wrap: anywhere; }
.cl-link { background: none; border: 0; padding: 0; color: var(--green-bright); font: inherit; font-size: 14px; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.cl-tool { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: var(--cl-target); min-width: var(--cl-target); padding: 0 10px; font: inherit; font-size: 13px; font-weight: 500; color: var(--fg-body); background: transparent; border: 1px solid var(--line); border-radius: 4px; cursor: pointer; white-space: nowrap; }
.cl-tool:hover { border-color: var(--fg-faint); color: var(--fg); }
/* A pressed or open control is quiet: a raised surface and a lighter border, never the solid accent. */
.cl-tool[aria-pressed="true"], .cl-tool[aria-expanded="true"] { background: var(--bg-2); border-color: var(--fg-dim); color: var(--fg); }
.cl-icon { flex: none; }
/* Authoring (M1 A1 to A4): the solid accent marks the one primary action of the moment. */
.cl-tool--primary { background: var(--green); border-color: var(--green); color: var(--on-accent, #10120c); font-weight: 600; }
.cl-tool--primary:hover { background: var(--green-bright); border-color: var(--green-bright); color: var(--on-accent, #10120c); }
.cl-tool--danger { border-color: var(--err, #d9826b); color: var(--err, #d9826b); }
.cl-tool:disabled { opacity: 0.6; cursor: not-allowed; }
.cl-notice { font-size: 14px; line-height: 1.5; margin: 8px 0; padding: 8px 10px; border: 1px solid var(--line); border-left: 3px solid var(--fg-dim); border-radius: 4px; background: var(--bg); }
.cl-notice--ok { border-left-color: var(--green-bright); }
.cl-notice--warn { border-left-color: var(--warn, #c9a35a); }
.cl-notice--bad { border-left-color: var(--err, #d9826b); color: var(--fg); }
.cl-field { display: grid; gap: 4px; margin: 0 0 10px; min-width: 0; }
.cl-field--check { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-height: var(--cl-target); }
.cl-field--check input { width: 18px; height: 18px; margin: 0; accent-color: var(--fg); }
.cl-field__label { font-size: 13px; font-weight: 600; color: var(--fg); }
.cl-field__hint { font-size: 12px; font-weight: 400; color: var(--fg-dim); margin: 0; }
.cl-field__error { font-size: 13px; line-height: 1.45; color: var(--err, #d9826b); margin: 0; }
.cl-input { width: 100%; min-height: var(--cl-target); font: inherit; font-size: 14px; box-sizing: border-box; }
.cl-input--number { max-width: 10rem; }
textarea.cl-input { min-height: 72px; resize: vertical; line-height: 1.45; }
.cl-fieldset { border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px 4px; margin: 0 0 10px; min-width: 0; }
.cl-fieldset legend { font-size: 13px; font-weight: 600; color: var(--fg); padding: 0 4px; }
.cl-fieldset--plain { border: 0; padding: 0; margin: 4px 0 10px; }
.cl-fieldset--plain > legend { padding: 0; margin-bottom: 6px; }
.cl-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 0 10px; }
.cl-items { list-style: none; margin: 0 0 8px; padding: 0; display: grid; gap: 8px; }
.cl-items__item { border: 1px solid var(--line-soft); border-radius: 4px; padding: 8px; }
.cl-items__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.cl-items__title { font-size: 13px; font-weight: 600; color: var(--fg); min-width: 0; overflow-wrap: anywhere; }
.cl-examples { list-style: none; margin: 8px 0; padding: 0; display: grid; gap: 6px; }
.cl-examples__row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; border: 1px solid var(--line); border-radius: 6px; padding: 6px; }
.cl-examples__row--on { border-color: var(--fg-dim); background: var(--bg-2); }
.cl-examples__pick { flex: 1 1 10rem; min-width: 0; text-align: left; background: none; border: 0; color: inherit; font: inherit; cursor: pointer; display: grid; gap: 2px; padding: 4px; min-height: var(--cl-target); }
.cl-examples__name { font-size: 14px; font-weight: 600; color: var(--fg); }
.cl-examples__meta { font-size: 13px; color: var(--fg-dim); }
.cl-examples__actions { display: flex; gap: 6px; }
.cl-example-edit { border-top: 1px solid var(--line-soft); }
.cl-json-edit summary { cursor: pointer; font-size: 14px; color: var(--fg-dim); min-height: var(--cl-target); display: flex; align-items: center; }
.cl-json { display: grid; gap: 6px; }
.cl-json__text { font-family: var(--mono); font-size: 13px; min-height: 160px; }
.cl-issues-box { border: 1px solid var(--line); border-left: 3px solid var(--warn, #c9a35a); border-radius: 4px; padding: 8px 10px; margin: 8px 0; font-size: 14px; line-height: 1.5; }
.cl-issues-box p { margin: 0 0 4px; }
.cl-issues-box ul { margin: 0; padding-left: 18px; }
.cl-check-why { display: block; font-size: 14px; color: var(--fg-dim); margin: 4px 0; }
.cl-check-edit { margin: 2px 0 4px; }
.cl-structure-note { margin-top: 16px; }
.cl-preview-note { max-width: 760px; margin: 0 auto 6px; font-size: 13px; color: var(--warn, #c9a35a); }
.cl-version-select select { min-width: 11rem; }
.cl-bar { position: sticky; bottom: -14px; z-index: 3; margin: 16px -16px -14px; padding: 12px 16px; background: var(--bg-1); border-top: 1px solid var(--line); display: grid; gap: 8px; }
.cl[data-layout="narrow"] .cl-bar { bottom: calc(-1 * max(16px, env(safe-area-inset-bottom))); margin-bottom: calc(-1 * max(16px, env(safe-area-inset-bottom))); padding-bottom: max(12px, env(safe-area-inset-bottom)); }
.cl-bar__line { margin: 0; font-size: 14px; line-height: 1.45; }
.cl-bar__title { margin: 0; font-size: 15px; font-weight: 600; color: var(--fg); }
.cl-bar__actions { display: flex; flex-wrap: wrap; gap: 8px; }
.cl-bar--confirm { border-top: 2px solid var(--fg-dim); }
.cl-guide { border: 1px solid var(--line); border-radius: 6px; padding: 12px; margin: 4px 0 12px; font-size: 14px; line-height: 1.5; background: var(--bg); outline: none; }
.cl-guide:focus-visible { outline: 2px solid var(--green-bright); }
.cl-guide p { margin: 0 0 8px; }
.cl-guide__title { font-size: 15px; line-height: 1.35; color: var(--fg); margin: 0 0 6px; font-weight: 600; text-wrap: balance; }
.cl-guide__steps { list-style: none; margin: 0 0 8px; padding: 0; display: grid; gap: 6px; counter-reset: step; }
.cl-guide__steps li { counter-increment: step; }
.cl-guide__step { width: 100%; text-align: left; display: grid; grid-template-columns: 18px 1fr; gap: 0 8px; padding: 8px; border: 1px solid var(--line); border-radius: 4px; background: var(--bg-1); color: inherit; font: inherit; font-size: 14px; cursor: pointer; min-height: var(--cl-target); }
.cl-guide__step::before { content: counter(step); grid-row: span 2; font-size: 13px; font-weight: 600; color: var(--fg-dim); padding-top: 1px; }
.cl-guide__step:hover { border-color: var(--fg-faint); }
.cl-guide__step-title { color: var(--fg); font-weight: 600; }
.cl-guide__step-detail { color: var(--fg-dim); }
.cl-guide-show { display: inline-flex; align-items: center; min-height: var(--cl-target); margin: 0 0 8px; }
.cl-guide-strip { font-size: 14px; }
.cl-guide-strip .cl-link { display: inline-flex; align-items: center; min-height: var(--cl-target); }
.cl-list { list-style: none; margin: 10px 0 12px; padding: 0; display: grid; gap: 8px; }
.cl-item { width: 100%; text-align: left; display: grid; gap: 6px; padding: 12px; border: 1px solid var(--line); border-radius: 6px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.cl-item:hover { border-color: var(--fg-faint); }
.cl-item--selected { border-color: var(--fg-dim); background: var(--bg-2); }
.cl-item__name { color: var(--fg); font-weight: 600; font-size: 15px; }
.cl-item__summary { font-size: 14px; color: var(--fg-dim); line-height: 1.45; }
.cl-item__versions { display: flex; gap: 6px; flex-wrap: wrap; }
.cl-badge { display: inline-block; font-size: 12px; padding: 1px 8px; border: 1px solid var(--line); border-radius: 999px; color: var(--fg-dim); vertical-align: middle; white-space: nowrap; }
.cl-badge--ok { border-color: var(--green-deep); color: var(--green-bright); }
.cl-toolbar { position: sticky; top: 0; z-index: 6; background: var(--bg); padding: 12px 0 10px; display: grid; gap: 8px; border-bottom: 1px solid var(--line-soft); margin-bottom: 14px; }
.cl[data-layout="narrow"] .cl-toolbar { position: static; }
/* The head: title, status, and the view controls, which never wrap away from the title. */
.cl-toolbar__head { display: grid; grid-template-columns: auto auto minmax(0, 1fr) auto; grid-template-areas: "title versions status view"; align-items: center; gap: 8px; min-width: 0; }
.cl-title { grid-area: title; font-family: var(--sans); font-weight: 600; color: var(--fg); font-size: 20px; margin: 0; outline: none; line-height: 1.2; white-space: nowrap; }
.cl-toolbar__versions { grid-area: versions; display: flex; align-items: center; min-width: 0; }
.cl-toolbar__status { grid-area: status; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; }
.cl-toolbar__view { grid-area: view; display: flex; align-items: center; gap: 6px; flex-wrap: nowrap; }
.cl-toolbar__panels { display: flex; gap: 6px; }
@container canvas (max-width: 880px) {
  .cl-toolbar__head { grid-template-columns: auto minmax(0, 1fr) auto; grid-template-areas: "title title view" "versions status status"; }
  /* The examples speak for themselves here; their group keeps its name for assistive technology. */
  .cl-toolbar__label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
}
@container canvas (max-width: 480px) {
  /* A phone: the title alone, then versions beside the panel buttons, then the status. */
  .cl-toolbar__head { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "title title" "versions view" "status status"; gap: 6px 8px; }
  .cl-draft__status { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
}
@container canvas (max-width: 1180px) {
  /* Narrower canvases keep the view controls' icons; their names stay for assistive technology and as tooltips. */
  .cl-tool__text { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .cl-toolbar__view .cl-tool { padding: 0; }
}
.cl-toolbar__row { display: flex; align-items: center; gap: 8px 10px; min-width: 0; }
.cl-toolbar__label { font-size: 12px; font-weight: 600; color: var(--fg-dim); white-space: nowrap; align-self: flex-start; line-height: var(--cl-target); }
.cl-seg { border: 0; padding: 0; margin: 0; display: inline-flex; gap: 4px; align-items: center; }
.cl-seg__opt { display: inline-flex; align-items: center; gap: 6px; min-height: var(--cl-target); padding: 0 8px; border: 1px solid var(--line); border-radius: 4px; font-size: 13px; cursor: pointer; white-space: nowrap; }
.cl-seg__opt input { margin: 0; width: 14px; height: 14px; accent-color: var(--fg); }
.cl-seg__opt--on { border-color: var(--fg-dim); background: var(--bg-2); color: var(--fg); }
.cl-pill { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; padding: 3px 8px; border-radius: 999px; border: 1px solid var(--line); white-space: nowrap; color: var(--fg-body); }
.cl-pill--ok .cl-pill__icon { color: var(--green-bright); }
.cl-pill--bad { color: var(--err, #d9826b); border-color: color-mix(in srgb, var(--err, #d9826b) 60%, transparent); }
.cl-pill--warn { color: var(--warn, #c9a35a); border-color: color-mix(in srgb, var(--warn, #c9a35a) 60%, transparent); }
.cl-draft { position: relative; }
.cl-draft summary { list-style: none; cursor: pointer; display: inline-flex; align-items: center; gap: 0.3em; min-height: var(--cl-target); padding: 0 10px; border: 1px dashed var(--fg-faint); border-radius: 999px; font-size: 13px; color: var(--fg); white-space: nowrap; }
.cl-draft summary::-webkit-details-marker { display: none; }
.cl-draft summary::after { content: " ▾"; margin-left: 4px; color: var(--fg-dim); }
.cl-draft__pop { position: absolute; top: calc(100% + 6px); left: 0; z-index: 12; width: min(360px, 86vw); background: var(--bg-1); border: 1px solid var(--line); border-radius: 6px; box-shadow: var(--shadow-menu); padding: 10px 12px; font-size: 14px; line-height: 1.5; }
.cl-draft__pop p { margin: 0 0 8px; }
.cl-draft__pop ul { margin: 0; padding-left: 18px; display: grid; gap: 4px; }
.cl-draft__lead { font-weight: 600; color: var(--fg); }
.cl-toolbar__row--examples { flex-wrap: nowrap; align-items: flex-start; }
.cl-chips-wrap { position: relative; min-width: 0; flex: 1; }
/* Wider screens wrap the examples, so none is ever hidden. */
.cl-chips { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; padding: 2px; }
.cl-chip { flex: none; display: inline-flex; align-items: center; gap: 0.3em; font: inherit; font-size: 13px; min-height: var(--cl-target); padding: 0 12px; border-radius: 999px; border: 1px solid var(--line); background: transparent; color: var(--fg-body); cursor: pointer; white-space: nowrap; }
.cl-chip:hover { border-color: var(--fg-faint); }
.cl-chip--on { background: var(--fg); color: var(--bg); border-color: var(--fg); }
.cl-chip__note { opacity: 0.8; }
.cl-ok { color: var(--green-bright); }
.cl-bad { color: var(--err, #d9826b); }
.cl-warn { color: var(--warn, #c9a35a); }
p.cl-ok, p.cl-bad, p.cl-warn { font-size: 14px; line-height: 1.5; margin: 0 0 8px; }
.cl-note { font-size: 14px; line-height: 1.5; border-left: 3px solid var(--fg-faint); padding: 6px 10px; margin: 0; background: var(--bg-1); }
.cl-note--warn { border-left-color: var(--warn, #c9a35a); }
.cl-refusal code, .cl-table code, .cl-tech code { font-family: var(--mono); font-size: 13px; overflow-wrap: anywhere; }
.cl-stage { max-width: 760px; margin: 0 auto; }
.cl-stage--fit { max-width: none; }
.cl-frame { border: 1px solid var(--line); border-radius: 4px; padding: clamp(10px, 2.2vw, 22px); color: #111; }
.cl-frame--kept { opacity: 0.55; margin-top: 8px; }
.cl-refusal { max-width: 760px; margin: 0 auto 12px; border: 1px solid var(--line); border-left: 4px solid var(--fg-faint); border-radius: 4px; padding: 12px 14px; background: var(--bg-1); display: grid; gap: 8px; }
.cl-refusal p { margin: 0; font-size: 14px; line-height: 1.55; }
.cl-refusal--bad { border-left-color: var(--err, #d9826b); }
.cl-refusal--warn { border-left-color: var(--warn, #c9a35a); }
.cl-refusal--neutral { border-left-color: var(--fg-dim); }
.cl-refusal__title { color: var(--fg); font-weight: 600; font-size: 15px !important; }
.cl-refusal__lead { color: var(--fg); }
.cl-refusal .cl-tool { justify-self: start; }
.cl-kept { max-width: 760px; margin: 8px auto 0; }
.cl-kept summary { cursor: pointer; font-size: 13px; color: var(--fg-dim); padding: 6px 0; min-height: var(--cl-target); display: flex; align-items: center; }
.cl-action { position: sticky; bottom: 12px; z-index: 5; display: flex; gap: 12px; align-items: center; justify-content: space-between; max-width: 760px; margin: 12px auto 0; padding: 10px 12px; border: 1px solid var(--line); border-left: 3px solid var(--fg-dim); border-radius: 4px; background: var(--bg-1); box-shadow: var(--shadow-menu); font-size: 14px; line-height: 1.5; }
.cl-action p { margin: 0; min-width: 0; }
.cl-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--line); margin: 6px 0 4px; }
.cl-tab { font: inherit; font-size: 14px; min-height: var(--cl-target); padding: 0 12px; background: none; border: 0; border-bottom: 2px solid transparent; color: var(--fg-dim); cursor: pointer; margin-bottom: -1px; }
.cl-tab--on { color: var(--fg); border-bottom-color: var(--fg); }
.cl-tab__flag { color: var(--err, #d9826b); }
.cl-section { padding-top: 12px; margin-top: 4px; }
.cl-section + .cl-section { border-top: 1px solid var(--line-soft); margin-top: 12px; }
.cl-text { font-size: 14px; line-height: 1.5; margin: 0 0 8px; }
.cl-plain { margin: 0; padding-left: 18px; font-size: 14px; line-height: 1.55; display: grid; gap: 3px; }
.cl-versions { list-style: none; margin: 0 0 8px; padding: 0; display: grid; gap: 6px; font-size: 14px; line-height: 1.5; }
.cl-versions__on { color: var(--fg); }
.cl-crumbs { font-size: 14px; color: var(--fg-dim); margin: 0; }
.cl-tech { margin-top: 16px; border-top: 1px solid var(--line); padding-top: 10px; font-size: 14px; }
.cl-tech summary { cursor: pointer; color: var(--fg-dim); font-size: 14px; min-height: var(--cl-target); display: flex; align-items: center; }
.cl-tech--inline { margin-top: 2px; border-top: 0; padding-top: 0; }
.cl-tech--inline p { font-size: 14px !important; color: var(--fg-dim); margin-top: 6px !important; }
.cl-facts { display: grid; gap: 6px; margin: 8px 0; font-size: 14px; }
.cl-facts div { display: grid; grid-template-columns: 8.5rem minmax(0, 1fr); gap: 8px; }
.cl-facts dt { color: var(--fg-dim); }
.cl-facts dd { margin: 0; overflow-wrap: anywhere; }
.cl-table { width: 100%; border-collapse: collapse; font-size: 14px; margin: 8px 0; }
.cl-table th, .cl-table td { text-align: left; padding: 5px 6px 5px 0; border-bottom: 1px solid var(--line-soft); vertical-align: top; }
.cl-table th { font-size: 12px; font-weight: 600; color: var(--fg-dim); }
.cl-empty { border: 1px dashed var(--line); border-radius: 4px; padding: 20px; margin-top: 12px; }
.cl-empty__title { color: var(--fg); font-weight: 600; margin: 0 0 4px; }
.cl-loading { color: var(--fg-dim); padding: 24px 0; }
.cl-issues { margin-top: 12px; font-size: 13px; color: var(--fg-dim); }
.cl-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (max-width: 899px) {
  .cl-head__next { display: none; }
  .cl-toolbar { padding: 8px 0 8px; gap: 6px; margin-bottom: 10px; }
  .cl-title { font-size: 18px; }
  .cl-toolbar__label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  /* On a phone the examples scroll sideways; faded edges and a chevron show there are more, and a focused
     chip is scrolled fully into view, clear of the fades. */
  .cl-chips { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; scroll-padding-inline: 32px; overscroll-behavior-x: contain; }
  .cl-chips::-webkit-scrollbar { display: none; }
  .cl-chips-wrap[data-more-end]::after, .cl-chips-wrap[data-more-start]::before { position: absolute; top: 0; bottom: 0; width: 36px; pointer-events: none; display: flex; align-items: center; font-size: 18px; color: var(--fg); }
  .cl-chips-wrap[data-more-end]::after { content: "›"; right: 0; justify-content: flex-end; padding-right: 2px; background: linear-gradient(to right, transparent, var(--bg) 70%); }
  .cl-chips-wrap[data-more-start]::before { content: "‹"; left: 0; z-index: 1; padding-left: 2px; background: linear-gradient(to left, transparent, var(--bg) 70%); }
}
@media (prefers-reduced-motion: reduce) { .cl * { transition: none !important; } }
/* With Select in the toolbar, a narrower canvas keeps the title row's room by drawing the draft note as its status
   alone; "What changed" stays in its name and opens with it. A phone draws "What changed" instead (above). */
@container canvas (max-width: 1000px) {
  .cl-draft__more { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
}
@container canvas (max-width: 480px) {
  .cl-draft__more { position: static; width: auto; height: auto; overflow: visible; clip: auto; }
  .cl-draft__dot { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
}
/* Advanced authoring: Structure, canvas selection and the element inspector. Chrome only: the selection layer
   sits beside the canvas frame, so nothing inside the canvas is restyled. */
.cl-stage { position: relative; }
.cl-stage--select { cursor: crosshair; }
.cl-sel { position: absolute; pointer-events: none; border-radius: 6px; z-index: 3; }
.cl-sel--on { outline: 2px solid var(--fg); outline-offset: 0; box-shadow: 0 0 0 4px color-mix(in srgb, var(--bg) 70%, transparent); }
.cl-sel--also { outline: 1px dashed var(--fg-dim); }
.cl-sel--hover { outline: 1px solid var(--fg-dim); }
.cl-pick { position: absolute; z-index: 4; cursor: crosshair; background: transparent; }
.cl-select-note { margin: 8px auto 0; max-width: 760px; }
.cl-switch { display: inline-flex; gap: 4px; margin: 8px 0 12px; }
.cl-switch__opt { min-height: var(--cl-target); padding: 4px 12px; border: 1px solid var(--line); border-radius: 4px; background: transparent; color: var(--fg-body); font: inherit; font-size: 14px; cursor: pointer; }
.cl-switch__opt--on { background: var(--bg-2); color: var(--fg); border-color: var(--fg-dim); font-weight: 600; }
.cl-switch__opt:disabled { opacity: 0.55; cursor: not-allowed; }
.cl-structure select { margin-bottom: 8px; }
.cl-tree, .cl-tree ul { list-style: none; margin: 0; padding: 0; }
.cl-tree ul { padding-left: 14px; border-left: 1px solid var(--line-soft); margin-left: 8px; }
.cl-tree__item { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; min-height: var(--cl-target); padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 14px; color: var(--fg-body); }
.cl-tree__item:hover { background: var(--bg-2); }
.cl-tree__item:focus-visible { outline: 2px solid var(--fg); outline-offset: -2px; }
.cl-tree__item--on { background: var(--bg-2); color: var(--fg); box-shadow: inset 3px 0 0 var(--fg); }
.cl-tree__item--group .cl-tree__name { font-style: italic; }
.cl-tree__name { font-weight: 600; color: var(--fg); }
.cl-tree__summary { color: var(--fg-dim); overflow-wrap: anywhere; }
.cl-tree__badge, .cl-tree__count, .cl-src { font-size: 12px; padding: 0 6px; border: 1px solid var(--line); border-radius: 999px; color: var(--fg-dim); white-space: nowrap; }
.cl-element__title { font-size: 16px; font-weight: 600; color: var(--fg); margin: 8px 0; }
.cl-element__summary { font-weight: 400; color: var(--fg-body); }
.cl-trail { font-size: 14px; color: var(--fg-dim); display: flex; flex-wrap: wrap; align-items: center; gap: 2px; }
.cl-trail .cl-link { min-height: 24px; }
.cl-kv { display: grid; grid-template-columns: minmax(80px, max-content) 1fr; gap: 4px 12px; margin: 0 0 8px; font-size: 14px; }
.cl-kv dt { color: var(--fg-dim); }
.cl-kv dd { margin: 0; color: var(--fg-body); overflow-wrap: anywhere; }
.cl-form { display: grid; gap: 4px; }
.cl-form__title { font-size: 14px; font-weight: 600; color: var(--fg); margin: 12px 0 4px; }
.cl-form__pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.cl-check { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 2px 8px; min-height: var(--cl-target); font-size: 14px; }
.cl-check input { width: 18px; height: 18px; margin: 0; accent-color: var(--fg); }
.cl-check .cl-field__hint { grid-column: 2; margin: 0; }
.cl-payload { list-style: none; margin: 0 0 8px; padding: 0; display: grid; gap: 6px; }
.cl-payload__row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; font-size: 14px; }
.cl-payload__key { font-family: var(--mono); font-size: 13px; color: var(--fg); min-width: 64px; }
.cl-payload__source { display: inline-flex; flex-wrap: wrap; gap: 6px; flex: 1 1 160px; min-width: 0; }
.cl-payload__new { display: grid; gap: 4px; padding: 8px; border: 1px solid var(--line); border-radius: 4px; margin: 4px 0 8px; }
.cl-pre { font-family: var(--mono); font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--bg-1); border: 1px solid var(--line-soft); border-radius: 4px; padding: 8px; margin: 8px 0 0; }
/* Visual template editing: Structure's editing controls, the content parts editor, and identity. */
.cl-tt { border: 1px solid var(--line); border-radius: 6px; padding: 8px; margin: 0 0 10px; display: grid; gap: 8px; }
.cl-tt__row { display: flex; flex-wrap: wrap; gap: 6px; }
.cl-tt__row .cl-tool { min-height: var(--cl-target); padding: 0 10px; }
.cl-tt__panel { display: grid; gap: 6px; border-top: 1px solid var(--line-soft); padding-top: 8px; }
.cl-tt__where { border: 0; padding: 0; margin: 0; display: grid; gap: 2px; }
.cl-tt__options { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.cl-tt__option { display: grid; grid-template-columns: auto 1fr; gap: 8px; align-items: start; font-size: 14px; padding: 6px; border: 1px solid var(--line-soft); border-radius: 4px; cursor: pointer; }
.cl-tt__option input { margin-top: 3px; width: 18px; height: 18px; accent-color: var(--fg); }
.cl-tt__option--blocked { opacity: 0.75; cursor: not-allowed; }
.cl-parts { border: 1px solid var(--line-soft); border-radius: 6px; padding: 8px; margin: 0 0 10px; display: grid; gap: 6px; min-width: 0; }
.cl-parts__list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.cl-parts__row { display: flex; gap: 6px; align-items: center; min-width: 0; }
.cl-parts__row .cl-input { flex: 1 1 auto; min-width: 0; }
.cl-parts__add { display: flex; flex-wrap: wrap; gap: 6px; }
.cl-parts__row--wrap { flex-wrap: wrap; }
/* Workspace appearance (T4): labels follow the chosen case, and the canvas may sit on its own surround. With the
   default choices these compute to exactly what they were before. */
.cl-label, .cl-toolbar__label, .cl-table th, .cl-field__label, .cl-crumbs { text-transform: var(--cl-label-transform, none); letter-spacing: var(--cl-label-tracking, 0); }
.cl-stage { background: var(--cl-surround, transparent); padding: var(--cl-surround-pad, 0); border-radius: 8px; }
`) +
  // The canvas is not part of the workspace: it keeps the size it inherited before any workspace choice existed, and
  // no choice reaches inside it. Outside the scaling above on purpose. composer-appearance.spec.ts holds this.
  `
.cl-frame { font-size: 14px; --cl-type: 1; --cl-space: 1; --cl-label-transform: none; --cl-label-tracking: 0; }
`;

/**
 * The workspace choices (T4) as CSS: every font size scales with --cl-type and every plain length of padding, gap
 * and margin with --cl-space. Both default to 1, so the computed styles are exactly the ones written. Minimum target
 * sizes (min-height) are deliberately left alone: density never shrinks a control below D0.1's floors.
 */
function withWorkspaceChoices(css: string): string {
  return css
    .replace(/font-size: (\d+(?:\.\d+)?)px/g, "font-size: calc($1px * var(--cl-type, 1))")
    .replace(/\b(padding|gap|margin)(-(?:top|bottom|left|right|block|inline))?: ([^;{}!]+)(!important)?;/g, (m, prop: string, side: string | undefined, value: string, important: string | undefined) =>
      /^(?:\d+(?:\.\d+)?px|0)(?:\s+(?:\d+(?:\.\d+)?px|0|auto))*$/.test(value.trim())
        ? `${prop}${side ?? ""}: ${value.trim().replace(/(\d+(?:\.\d+)?)px/g, "calc($1px * var(--cl-space, 1))")}${important ? " !important" : ""};`
        : m,
    );
}
