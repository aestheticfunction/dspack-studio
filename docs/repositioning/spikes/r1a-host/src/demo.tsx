/**
 * The R1a demonstration: the real composition pipeline and host, running in the browser, rendering through
 * upstream @a2ui/react 0.16.1 with Composer's Astryx renderers, in ONE long-lived renderer session.
 *
 * Real: expansion, state selection, S1-S3 (dspack-gen lintSurface), emission (dspack-emit), the two
 * attachments, A1-A3, pins (contract, profile, toolchain, composition), the host's acceptance checks,
 * replacement, carried values and focus, the consequential lifecycle (lock, idempotency key, outcome) and the
 * sensitive-input safeguards.
 * Simulated: the hotel tool. A search returns the data set chosen in the panel; a reservation's outcome is
 * whatever the panel reports; nothing is booked.
 */
import { createElement as h, useCallback, useEffect, useMemo, useRef, useState, type FC } from "react";
import { createRoot } from "react-dom/client";
import { lintSurface } from "@aestheticfunction/dspack-gen/core";
import { createGovernor, type Governor } from "../../../../../packages/composer-core/src/compositions/governance";
import { loadCompositions } from "../../../../../packages/composer-core/src/compositions/load";
import { createHost, recheck, type ActResult, type Commitment, type Host, type ShowResult } from "../../../../../packages/composer-core/src/compositions/host";
import type { Instance } from "../../../../../packages/composer-core/src/compositions/instantiate";
import type { CompositionDefinition } from "../../../../../packages/composer-core/src/compositions/schema";
import sidecar from "../../../../../packages/composer-core/src/compositions/spike/astryx.compositions.json";
import datasetsDoc from "../../../../../packages/composer-core/src/compositions/spike/datasets.json";
import contractDoc from "../../../../../apps/composer/astryx-project/astryx.dspack.json";
import profileDoc from "../../../../../apps/composer/astryx-project/astryx.profile.json";
import genPackage from "../../../../../packages/composer-core/node_modules/@aestheticfunction/dspack-gen/package.json";
import emitPackage from "../../../../../packages/composer-core/node_modules/@aestheticfunction/dspack-emit/package.json";
import { applyFocus, buildCatalog016, LiveSurface016 } from "./bridge-016";

type Json = Record<string, any>;
const DATASETS = (datasetsDoc as any).sets as Record<string, Json>;
const SETS = ["three", "two", "one", "none", "reordered", "removed", "twenty", "duplicate-names"] as const;
const SET_LABEL: Record<string, string> = {
  three: "Three hotels",
  two: "Two hotels",
  one: "One hotel (the rules refuse it)",
  none: "No hotels (empty state)",
  reordered: "Three, reordered",
  removed: "Three with one removed",
  twenty: "Twenty hotels",
  "duplicate-names": "Two hotels with the same name",
};
const TOOLCHAIN = { lint: (genPackage as any).version as string, emit: (emitPackage as any).version as string };

const lint = (s: unknown, c: Json) => lintSurface(s, c as never) as any;

interface LogLine {
  n: number;
  tone: "ok" | "refused" | "info";
  title: string;
  detail?: string;
}

const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const short = (s: string) => s.slice(0, 10);
const OUTCOME_LABEL: Record<string, string> = { pending: "pending", unknown: "unknown", succeeded: "succeeded", failed: "failed" };

/** What a browser check reads (verify_demo.cjs). Nothing here is needed by the page itself. */
const probe: Json = ((window as any).__playground = { timings: [] as Json[], focused: [] as Json[] });

const App: FC = () => {
  const [ready, setReady] = useState<null | { governor: Governor; host: Host; compositions: Record<string, CompositionDefinition> }>(null);
  const [batch, setBatch] = useState<Json[]>([]);
  const [instance, setInstance] = useState<Instance | null>(null);
  const [lastShow, setLastShow] = useState<ShowResult | null>(null);
  const [commitment, setCommitment] = useState<Commitment | null>(null);
  const [setName, setSetName] = useState<string>("three");
  const [log, setLog] = useState<LogLine[]>([]);
  const [tab, setTab] = useState<"instance" | "actions" | "log" | "messages">("log");
  const [ruleEdited, setRuleEdited] = useState(false);
  const [notice, setNotice] = useState<LogLine | null>(null);
  const [announce, setAnnounce] = useState("");
  const processorRef = useRef<any>(null);
  const tamper = useRef(false);
  const lastEvent = useRef<Json | null>(null);
  const previous = useRef<Instance | null>(null);
  const results = useRef<Json | null>(null);
  const focusHint = useRef<any>(null);
  const counter = useRef(0);
  // The catalog depends only on the contract and profile, which the demo never changes (a rule edit does not touch it).
  const built = useMemo(() => (ready ? buildCatalog016(ready.governor.catalog("0.9.1")) : null), [ready !== null]);

  const push = useCallback((line: Omit<LogLine, "n">) => {
    const entry = { ...line, n: ++counter.current };
    setLog((l) => [entry, ...l].slice(0, 120));
    if (line.tone !== "info") setNotice(entry);
  }, []);

  useEffect(() => {
    (async () => {
      const governor = await createGovernor({ contract: contractDoc as Json, profileJson: profileDoc as Json, lintSurface: lint, toolchain: TOOLCHAIN });
      const loaded = await loadCompositions(sidecar, { baseContract: contractDoc as Json });
      const compositions = Object.fromEntries(loaded.usable.map((c) => [c.id, c]));
      // No session id is passed: the host generates one from the browser's cryptographic source.
      const host = await createHost({ governor, compositions: loaded.usable });
      for (const c of loaded.usable) {
        const r = await recheck(governor, c);
        if (r.approval) host.approve(c.id, r.approval);
      }
      probe.host = host;
      setReady({ governor, host, compositions });
    })();
  }, []);

  const show = useCallback(
    async (id: string, data: Json, label: string) => {
      if (!ready) return null;
      const focused = (document.activeElement?.closest("[data-a2ui-id]") as HTMLElement | null)?.dataset.a2uiId ?? null;
      const before = ready.host.current();
      const r = await ready.host.show(id, { data, focused });
      setLastShow(r);
      if (!r.ok) {
        const refusal = r.refusal as Json;
        const rule = refusal.failures?.[0]?.rule;
        push({ tone: "refused", title: `${label}: not shown (${refusal.stage})`, detail: `${rule ? `${rule}. ` : ""}${refusal.reason}. The surface on screen stays.` });
        return r;
      }
      previous.current = before;
      probe.timings.push({ composition: r.instance.composition, state: r.instance.state, ...r.instance.timings });
      setInstance(r.instance);
      setBatch(r.batch);
      setCommitment(ready.host.commitment());
      focusHint.current = r.focus;
      setAnnounce(r.announcement);
      const carried = r.carried.length ? ` Carried: ${r.carried.join(", ")}.` : "";
      const dropped = r.dropped.length ? ` Not carried: ${r.dropped.map((d) => `${d.name} (${d.reason})`).join(", ")}.` : "";
      push({ tone: "info", title: `${label}: ${r.instance.surfaceId}`, detail: `${r.instance.composition}, state ${r.instance.state} under ${r.instance.purpose}.${carried}${dropped}` });
      return r;
    },
    [ready, push],
  );

  useEffect(() => {
    if (ready && !instance) void show("hotel-search", {}, "Search");
  }, [ready, instance, show]);

  // Focus after a replacement, as the host advised; recorded for the browser check.
  useEffect(() => {
    const hint = focusHint.current;
    if (!hint) return;
    const t = setTimeout(() => {
      const el = applyFocus(hint);
      probe.focused.push({ hint, landedOn: el?.closest("[data-a2ui-id]")?.getAttribute("data-a2ui-id") ?? (el?.hasAttribute("data-canvas-region") ? "canvas" : null) });
    }, 80);
    return () => clearTimeout(t);
  }, [batch]);

  const act = useCallback(
    (event: Json, label?: string): ActResult | null => {
      if (!ready) return null;
      const r: ActResult = ready.host.act(event as any);
      // What the log shows is the recordable form: sensitive values are replaced.
      const shown = ready.host.redact(event as any).context;
      if (!r.accepted) {
        push({ tone: "refused", title: `Refused ${label ?? event.name}: ${r.code}`, detail: `${r.reason}${r.key ? ` Key: ${r.key}.` : ""}` });
      } else {
        push({ tone: "ok", title: `Accepted ${label ?? event.name}`, detail: Object.keys(shown).length ? JSON.stringify(shown) : "no payload" });
      }
      setCommitment(ready.host.commitment());
      return r;
    },
    [ready, push],
  );

  const onAction = useCallback(
    async (a: Json) => {
      if (!ready) return;
      const event = { name: a.name, surfaceId: a.surfaceId, sourceComponentId: a.sourceComponentId, context: { ...(a.context ?? {}) } };
      if (tamper.current && "hotelId" in event.context) {
        event.context.hotelId = "h-999";
        tamper.current = false;
      }
      lastEvent.current = event;
      const r = act(event);
      if (!r?.accepted) return;
      const values = r.values;
      if (a.name === "search") {
        const nights = days(values.checkIn!, values.checkOut!);
        if (!(nights >= 1 && nights <= 30)) {
          await show("hotel-search", { errors: [nights < 1 ? "Check-out must be after check-in." : "Stays are limited to 30 nights."] }, "Search again");
          return;
        }
        results.current = { ...DATASETS[setName], destination: values.destination, nights };
        await show("hotel-results", results.current, "Results");
      } else if (a.name === "search_again") {
        results.current = { ...DATASETS.three, destination: values.destination };
        await show("hotel-results", results.current, "Results");
      } else if (a.name === "choose") {
        const base = results.current!;
        const hotel = base.hotels.find((x: Json) => x.id === event.context.hotelId);
        results.current = { ...base, selection: { id: hotel.id, name: hotel.name, total: hotel.price * base.nights } };
        await show("hotel-results", results.current, "Confirm");
      } else if (a.name === "back") {
        const { selection: _drop, ...rest } = results.current!;
        await show("hotel-results", rest, "Results");
      } else if (a.name === "new_search") {
        await show("hotel-search", {}, "Search");
      } else if (a.name === "reserve") {
        push({ tone: "ok", title: "Reservation sent to the hotel tool (simulated)", detail: `Key ${r.commitment!.key}, outcome pending. The surface is locked: report the tool's outcome in the panel.` });
      }
    },
    [ready, setName, show, push, act],
  );

  /** The simulated tool reports an outcome for the open commitment. */
  const report = async (outcome: "succeeded" | "failed" | "unknown", how: string) => {
    if (!ready) return;
    const open = ready.host.commitment();
    if (!open) return push({ tone: "info", title: "No reservation is open", detail: "Choose a hotel and reserve it first." });
    const r = ready.host.settle(open.key, outcome);
    setCommitment(ready.host.commitment());
    if (!r.ok) return push({ tone: "refused", title: `Outcome refused: ${r.code}`, detail: r.reason });
    push({ tone: outcome === "succeeded" ? "ok" : outcome === "failed" ? "refused" : "info", title: `${how}: ${outcome}`, detail: `Key ${open.key}.` });
    if (outcome === "succeeded") {
      await show("hotel-search", {}, "Reserved (simulated); a new search");
    } else if (outcome === "failed") {
      // A known failure is the one case where a new attempt is safe: a new confirmation surface, under a new key.
      await show("hotel-results", results.current!, "Try again");
    }
  };

  const stale = () => {
    const e = lastEvent.current;
    const prev = previous.current;
    if (!e || !prev || !ready) return push({ tone: "info", title: "Nothing to replay yet", detail: "Press an action, then let the surface be replaced first." });
    const action = prev.actions.find((x) => x.name === e.name) ?? prev.actions[0]!;
    act({ name: action.name, surfaceId: prev.surfaceId, sourceComponentId: action.componentId, context: { ...action.payload, ...Object.fromEntries(action.carries.map((c) => [c, prev.inputValues[c] ?? ""])) } }, `replayed ${action.name}`);
  };

  const forgeReserve = () => {
    if (!instance) return;
    act({ name: "reserve", surfaceId: instance.surfaceId, sourceComponentId: "reserve", context: { hotelId: instance.actions.find((a) => a.name === "reserve")?.payload.hotelId ?? "h-102" } }, "a reservation sent from this surface");
  };

  const pressBack = () => {
    if (!instance) return;
    act({ name: "back", surfaceId: instance.surfaceId, sourceComponentId: "back", context: {} }, "Back, sent from this surface");
  };

  const navigateAway = () => void show("hotel-search", {}, "Navigate to a new search");

  const garbage = () => {
    const p = processorRef.current;
    if (!p || !instance || instance.inputs.length === 0) return push({ tone: "info", title: "No input on this surface", detail: "Go back to the search, then try again." });
    const surface = p.model.getSurface(instance.surfaceId);
    surface?.dataModel.set(`/input/${instance.inputs[0]!.name}`, { path: "/secrets" });
    push({ tone: "info", title: "Wrote an object into /input/" + instance.inputs[0]!.name, detail: "As a misbehaving renderer could. Governed content is unchanged; now press the search button." });
  };

  const toggleRule = async () => {
    if (!ready) return;
    const next = !ruleEdited;
    const doc = structuredClone(contractDoc as Json);
    if (next) doc.rules.find((r: Json) => r.id === "rule.review-offers-alternatives").requiredSubComponents[0].min = 4;
    const governor = await createGovernor({ contract: doc, profileJson: profileDoc as Json, lintSurface: lint, toolchain: TOOLCHAIN });
    ready.host.setGovernor(governor);
    setReady({ ...ready, governor });
    setRuleEdited(next);
    push({ tone: "info", title: next ? "Rule edited: a review now needs four options" : "Rule restored", detail: "Every approval is pinned to the rules and toolchain it was checked against, so both compositions need a re-check before anything runs." });
  };

  const recheckAll = async () => {
    if (!ready) return;
    for (const c of Object.values(ready.compositions)) {
      const r = await recheck(ready.governor, c);
      if (r.approval) ready.host.approve(c.id, r.approval);
      const failed = r.scenarios.filter((s) => !s.matches).map((s) => s.id);
      push(r.ok ? { tone: "ok", title: `Re-check passed: ${c.id}`, detail: `${r.scenarios.length} scenarios behave as declared; approved again.` } : { tone: "refused", title: `Re-check failed: ${c.id}`, detail: `Scenarios ${failed.join(", ")} no longer behave as declared; it stays unapproved.` });
    }
  };

  if (!ready) return h("main", { className: "shell" }, h("p", { className: "loading" }, "Preparing the governed pipeline…"));
  const current = instance;
  const locked = !!commitment;
  const blocking = !!commitment && (commitment.status === "pending" || commitment.status === "unknown");
  const sensitive = current?.inputs.filter((i) => i.sensitive).map((i) => i.name) ?? [];
  return h(
    "div",
    { className: "shell" },
    h(
      "header",
      { className: "top" },
      h("div", null, h("h1", null, "Composition Playground"), h("p", { className: "sub" }, "R1a spike: hotel search and hotel results, one definition each, every instance governed")),
      h(
        "div",
        { className: "badges" },
        h("span", { className: "pill" }, "upstream @a2ui/react 0.16.1"),
        h("span", { className: "pill" }, "one renderer session"),
        h("span", { className: "pill", title: "Generated by the host from the browser's cryptographic source", "data-session": ready.host.session }, `session ${ready.host.session.slice(0, 8)}…`),
        h("span", { className: "pill warn" }, "hotel tool simulated"),
      ),
    ),
    h(
      "div",
      { className: "layout" },
      h(
        "section",
        { className: "canvas", "aria-label": "Rendered surface" },
        h("div", { className: "canvas-bar" }, h("span", null, current ? `${current.composition} · ${current.state}` : ""), h("code", null, current?.surfaceId ?? "")),
        commitment && h(
          "div",
          { className: `lifecycle ${commitment.status}`, role: "status", "data-outcome": commitment.status },
          h("strong", null, blocking ? `Reservation ${OUTCOME_LABEL[commitment.status]}: this surface is locked` : `Reservation ${OUTCOME_LABEL[commitment.status]}`),
          h("span", null, blocking ? "Nothing on it can be pressed, and nothing replaces it until the hotel tool's outcome is known. Pressing again would not book twice: the request has one key." : "The outcome is known. The next surface follows."),
          h("code", { "data-key": commitment.key }, commitment.key),
        ),
        notice && h("div", { className: `notice ${notice.tone}`, role: "status" }, h("strong", null, notice.title), notice.detail && h("span", null, notice.detail), h("button", { className: "x", "aria-label": "Dismiss", onClick: () => setNotice(null) }, "×")),
        h(
          "div",
          { className: "surface", tabIndex: -1, "data-canvas-region": "", ...(locked ? { inert: true, "aria-busy": "true", "data-locked": "" } : {}) },
          built && h(LiveSurface016, { built, batch, onAction, onReady: (p: any) => (processorRef.current = p) }),
        ),
        h("div", { className: "sr", "aria-live": "polite" }, announce),
      ),
      h(
        "aside",
        { className: "panel" },
        commitment && h(
          "section",
          { className: "card tool" },
          h("h2", null, "The hotel tool (simulated)"),
          h("p", { className: "hint" }, `It has request ${commitment.key}. Report what it says.`),
          h(
            "div",
            { className: "grid" },
            commitment.status === "pending" && h("button", { onClick: () => report("succeeded", "The tool confirms") }, "It succeeded"),
            commitment.status === "pending" && h("button", { onClick: () => report("failed", "The tool declines") }, "It failed"),
            commitment.status === "pending" && h("button", { onClick: () => report("unknown", "The tool does not answer") }, "No answer (unknown)"),
            commitment.status === "unknown" && h("button", { onClick: () => report("succeeded", "Asked by key: it went through") }, "Reconcile: it went through"),
            commitment.status === "unknown" && h("button", { onClick: () => report("failed", "Asked by key: it did not") }, "Reconcile: it did not"),
          ),
        ),
        h(
          "section",
          { className: "card" },
          h("h2", null, "What the hotel tool returns"),
          h("select", { value: setName, onChange: (e: any) => setSetName(e.target.value), "aria-label": "Data set" }, SETS.map((s) => h("option", { key: s, value: s }, SET_LABEL[s]))),
          h("p", { className: "hint" }, "Used on the next search. Then type a destination, dates as YYYY-MM-DD and a number of guests. The loyalty number is sensitive: it is used once and never kept, carried or recorded."),
        ),
        h(
          "section",
          { className: "card" },
          h("h2", null, "Try to break it"),
          h(
            "div",
            { className: "grid" },
            h("button", { onClick: stale }, "Replay an action on the replaced surface"),
            h("button", { onClick: () => { tamper.current = true; push({ tone: "info", title: "The next choice will be sent with another hotel's id" }); } }, "Tamper with the next payload"),
            h("button", { onClick: forgeReserve }, "Send a reservation from this surface"),
            h("button", { onClick: pressBack }, "Send Back from this surface"),
            h("button", { onClick: navigateAway }, "Navigate to a new search"),
            h("button", { onClick: garbage }, "Write garbage into an input path"),
            h("button", { onClick: toggleRule, "aria-pressed": ruleEdited }, ruleEdited ? "Restore the rule" : "Edit a rule hotel results depends on"),
            h("button", { onClick: recheckAll }, "Re-check and re-approve"),
          ),
        ),
        h(
          "section",
          { className: "card grow" },
          h("div", { className: "tabs", role: "tablist" }, (["log", "instance", "actions", "messages"] as const).map((t) => h("button", { key: t, role: "tab", "aria-selected": tab === t, onClick: () => setTab(t) }, { log: "Host log", instance: "Instance", actions: "Payloads", messages: "Messages" }[t]))),
          tab === "log" && h("ol", { className: "log", "data-log": "" }, log.map((l) => h("li", { key: l.n, className: l.tone }, h("strong", null, l.title), l.detail && h("span", null, l.detail)))),
          tab === "instance" && current && h(
            "dl",
            { className: "facts" },
            ...([
              ["Session", ready.host.session],
              ["Surface", current.surfaceId],
              ["Composition", `${current.composition} v${current.version}`],
              ["State", current.state],
              ["Purpose", current.purpose],
              ["Contract pin", short(current.pins.contractSha256)],
              ["Toolchain pin", `${short(current.pins.toolchainSha256)} (lint ${TOOLCHAIN.lint}, emit ${TOOLCHAIN.emit}, runtime ${ready.governor.toolchain.runtime})`],
              ["Interaction pin", short(current.pins.interactionSha256)],
              ["Composition pin", short(current.pins.compositionSha256)],
              ["Expansion", short(current.expansionSha256)],
              ["Inputs", current.inputs.map((i) => `${i.name} → ${i.path}${i.sensitive ? " (sensitive)" : ""}`).join(", ") || "none"],
              ["Carried", lastShow?.ok ? lastShow.carried.join(", ") || "nothing" : "n/a"],
              ["Never carried", sensitive.join(", ") || "none on this surface"],
              ["Commitment", commitment ? `${commitment.key}: ${commitment.status}` : "none open"],
              ["Instantiation", `${current.timings.totalMs.toFixed(1)} ms in this browser`],
            ] as const).flatMap(([k, v]) => [h("dt", { key: `${k}t` }, k), h("dd", { key: `${k}d` }, v)]),
          ),
          tab === "actions" && current && h(
            "table",
            { className: "payloads" },
            h("thead", null, h("tr", null, h("th", null, "Action"), h("th", null, "Component"), h("th", null, "Item"), h("th", null, "Payload"))),
            h("tbody", null, current.actions.map((a) => h("tr", { key: a.componentId }, h("td", null, a.name + (a.consequential ? " ⚑" : "")), h("td", null, h("code", null, a.componentId)), h("td", null, a.item ? `${a.item.index + 1}: ${a.item.witness[0]}` : "—"), h("td", null, h("code", null, JSON.stringify({ ...a.payload, ...Object.fromEntries(a.carries.map((c) => [c, `/input/${c}`])) })))))),
          ),
          tab === "messages" && h("pre", { className: "json", "data-messages": "" }, JSON.stringify(batch, null, 1)),
        ),
        h(
          "details",
          { className: "card about" },
          h("summary", null, "About this demonstration"),
          h("p", null, h("strong", null, "Real: "), "expansion, state selection, the design system's rules (S1 to S3), emission, input bindings and payloads, A1 to A3, pins, the host's checks, replacement in one renderer session, carried values and focus, the reservation lock and its idempotency key, and the sensitive-input safeguards. The same code the tests and evidence use."),
          h("p", null, h("strong", null, "Simulated: "), "the hotel tool. A search returns the data set chosen above; a reservation's outcome is what you report in the panel; nothing is booked."),
          h("p", null, h("strong", null, "What the host guarantees: "), "a reservation is accepted once per surface, under one key, and nothing else runs or replaces it until its outcome is known. What it cannot guarantee: that the tool honours the key, or that the agent asks the tool by key after an unknown outcome instead of calling it again."),
          h("p", null, h("strong", null, "Not in R1a: "), "a complete reservation flow, planning, persistence, the Composer workspace."),
        ),
      ),
    ),
  );
};

createRoot(document.getElementById("root")!).render(h(App));
