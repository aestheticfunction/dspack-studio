/**
 * The R1a demonstration: the real composition pipeline and host, running in the browser, rendering through
 * upstream @a2ui/react 0.16.1 with Composer's Astryx renderers.
 *
 * Real: expansion, state selection, S1-S3 (dspack-gen lintSurface), emission (dspack-emit), the two
 * attachments, A1-A3, pins, the host's acceptance checks, replacement, carried values and focus.
 * Simulated: the hotel tool. A search returns the data set chosen in the panel; nothing is booked.
 */
import { createElement as h, useCallback, useEffect, useMemo, useRef, useState, type FC } from "react";
import { createRoot } from "react-dom/client";
import { lintSurface } from "@aestheticfunction/dspack-gen/core";
import { createGovernor, type Governor } from "../../../../../packages/composer-core/src/compositions/governance";
import { loadCompositions } from "../../../../../packages/composer-core/src/compositions/load";
import { createHost, recheck, type ActResult, type Host, type ShowResult } from "../../../../../packages/composer-core/src/compositions/host";
import type { Instance } from "../../../../../packages/composer-core/src/compositions/instantiate";
import type { CompositionDefinition } from "../../../../../packages/composer-core/src/compositions/schema";
import sidecar from "../../../../../packages/composer-core/src/compositions/spike/astryx.compositions.json";
import datasetsDoc from "../../../../../packages/composer-core/src/compositions/spike/datasets.json";
import contractDoc from "../../../../../apps/composer/astryx-project/astryx.dspack.json";
import profileDoc from "../../../../../apps/composer/astryx-project/astryx.profile.json";
import { buildCatalog016, Surface016 } from "./bridge-016";

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

const lint = (s: unknown, c: Json) => lintSurface(s, c as never) as any;
const session = Math.random().toString(36).slice(2, 8);

interface LogLine {
  n: number;
  tone: "ok" | "refused" | "info";
  title: string;
  detail?: string;
}

const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const short = (s: string) => s.slice(0, 10);

const App: FC = () => {
  const [ready, setReady] = useState<null | { governor: Governor; host: Host; compositions: Record<string, CompositionDefinition> }>(null);
  const [batch, setBatch] = useState<Json[]>([]);
  const [instance, setInstance] = useState<Instance | null>(null);
  const [lastShow, setLastShow] = useState<ShowResult | null>(null);
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
    setLog((l) => [entry, ...l].slice(0, 80));
    if (line.tone !== "info") setNotice(entry);
  }, []);

  useEffect(() => {
    (async () => {
      const governor = await createGovernor({ contract: contractDoc as Json, profileJson: profileDoc as Json, lintSurface: lint });
      const loaded = await loadCompositions(sidecar, { baseContract: contractDoc as Json });
      const compositions = Object.fromEntries(loaded.usable.map((c) => [c.id, c]));
      const host = createHost({ session, governor, compositions: loaded.usable });
      for (const c of loaded.usable) {
        const r = await recheck(governor, c);
        if (r.approval) host.approve(c.id, r.approval);
      }
      setReady({ governor, host, compositions });
    })();
  }, []);

  const show = useCallback(
    async (id: string, data: Json, label: string) => {
      if (!ready) return;
      const focused = (document.activeElement?.closest("[data-a2ui-id]") as HTMLElement | null)?.dataset.a2uiId ?? null;
      const before = ready.host.current();
      const r = await ready.host.show(id, { data, focused });
      setLastShow(r);
      if (!r.ok) {
        const refusal = r.refusal as Json;
        const rule = refusal.failures?.[0]?.rule;
        push({ tone: "refused", title: `${label}: not shown`, detail: `${rule ? `${rule}. ` : ""}${refusal.reason}. The last valid surface stays on screen.` });
        return;
      }
      previous.current = before;
      setInstance(r.instance);
      setBatch(r.batch);
      focusHint.current = r.focus;
      setAnnounce(r.announcement);
      const carried = r.carried.length ? ` Carried: ${r.carried.join(", ")}.` : "";
      push({ tone: "info", title: `${label}: ${r.instance.surfaceId}`, detail: `${r.instance.composition}, state ${r.instance.state} under ${r.instance.purpose}.${carried}` });
    },
    [ready, push],
  );

  useEffect(() => {
    if (ready && !instance) void show("hotel-search", {}, "Search");
  }, [ready, instance, show]);

  // Focus after a replacement, as the host advised.
  useEffect(() => {
    const hint = focusHint.current;
    if (!hint) return;
    const t = setTimeout(() => {
      const el = hint.componentId ? (document.querySelector(`[data-a2ui-id="${CSS.escape(hint.componentId)}"]`) as HTMLElement | null) : null;
      const target = (el?.querySelector("input, button") as HTMLElement | null) ?? (document.querySelector("[data-canvas-region]") as HTMLElement | null);
      target?.focus();
    }, 60);
    return () => clearTimeout(t);
  }, [batch]);

  const onAction = useCallback(
    async (a: Json) => {
      if (!ready) return;
      const event = { name: a.name, surfaceId: a.surfaceId, sourceComponentId: a.sourceComponentId, context: { ...(a.context ?? {}) } };
      if (tamper.current && "hotelId" in event.context) {
        event.context.hotelId = "h-999";
        tamper.current = false;
      }
      lastEvent.current = event;
      const r: ActResult = ready.host.act(event);
      if (!r.accepted) {
        push({ tone: "refused", title: `Refused ${a.name}: ${r.code}`, detail: r.reason });
        return;
      }
      push({ tone: "ok", title: `Accepted ${a.name}`, detail: Object.keys(event.context).length ? JSON.stringify(event.context) : "no payload" });
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
        await show("hotel-results", { ...base, selection: { id: hotel.id, name: hotel.name, total: hotel.price * base.nights } }, "Confirm");
      } else if (a.name === "back") {
        await show("hotel-results", results.current!, "Results");
      } else if (a.name === "new_search") {
        await show("hotel-search", {}, "Search");
      } else if (a.name === "reserve") {
        push({ tone: "ok", title: "Reservation accepted (simulated)", detail: "Nothing is booked. Press Reserve again: a consequential action is accepted once per surface." });
      }
    },
    [ready, setName, show, push],
  );

  const stale = () => {
    const e = lastEvent.current;
    const prev = previous.current;
    if (!e || !prev || !ready) return push({ tone: "info", title: "Nothing to replay yet", detail: "Press an action, then let the surface be replaced first." });
    const action = prev.actions.find((x) => x.name === e.name) ?? prev.actions[0]!;
    const event = { name: action.name, surfaceId: prev.surfaceId, sourceComponentId: action.componentId, context: { ...action.payload, ...Object.fromEntries(action.carries.map((c) => [c, prev.inputValues[c] ?? ""])) } };
    const r = ready.host.act(event);
    push(r.accepted ? { tone: "ok", title: "Accepted (unexpected)" } : { tone: "refused", title: `Refused replayed ${event.name}: ${r.code}`, detail: r.reason });
  };

  const forgeReserve = () => {
    if (!ready || !instance) return;
    const r = ready.host.act({ name: "reserve", surfaceId: instance.surfaceId, sourceComponentId: "reserve", context: { hotelId: "h-102" } });
    push(r.accepted ? { tone: "ok", title: "Accepted reserve", detail: "This surface is the confirmation step." } : { tone: "refused", title: `Refused forged reserve: ${r.code}`, detail: r.reason });
  };

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
    const governor = await createGovernor({ contract: doc, profileJson: profileDoc as Json, lintSurface: lint });
    ready.host.setGovernor(governor);
    setReady({ ...ready, governor });
    setRuleEdited(next);
    push({ tone: "info", title: next ? "Rule edited: a review now needs four options" : "Rule restored", detail: "Every approval is pinned to the rules it was checked against, so both compositions need a re-check before anything runs." });
  };

  const recheckAll = async () => {
    if (!ready) return;
    for (const c of Object.values(ready.compositions)) {
      const r = await recheck(ready.governor, c);
      if (r.approval) ready.host.approve(c.id, r.approval);
      const failed = r.scenarios.filter((s) => s.expect !== s.outcome).map((s) => s.id);
      push(r.ok ? { tone: "ok", title: `Re-check passed: ${c.id}`, detail: `${r.scenarios.length} scenarios behave as declared; approved again.` } : { tone: "refused", title: `Re-check failed: ${c.id}`, detail: `Scenarios ${failed.join(", ")} no longer behave as declared; it stays unapproved.` });
    }
  };

  if (!ready) return h("main", { className: "shell" }, h("p", { className: "loading" }, "Preparing the governed pipeline…"));
  const current = instance;
  return h(
    "div",
    { className: "shell" },
    h(
      "header",
      { className: "top" },
      h("div", null, h("h1", null, "Composition Playground"), h("p", { className: "sub" }, "R1a spike: hotel search and hotel results, one definition each, every instance governed")),
      h("div", { className: "badges" }, h("span", { className: "pill" }, "upstream @a2ui/react 0.16.1"), h("span", { className: "pill" }, "Astryx"), h("span", { className: "pill warn" }, "hotel tool simulated")),
    ),
    h(
      "div",
      { className: "layout" },
      h(
        "section",
        { className: "canvas", "aria-label": "Rendered surface" },
        h("div", { className: "canvas-bar" }, h("span", null, current ? `${current.composition} · ${current.state}` : ""), h("code", null, current?.surfaceId ?? "")),
        notice && h("div", { className: `notice ${notice.tone}`, role: "status" }, h("strong", null, notice.title), notice.detail && h("span", null, notice.detail), h("button", { className: "x", "aria-label": "Dismiss", onClick: () => setNotice(null) }, "×")),
        h("div", { className: "surface", tabIndex: -1, "data-canvas-region": "" }, built && h(Surface016, { built, messages: batch, onAction, onReady: (p: any) => (processorRef.current = p) })),
        h("div", { className: "sr", "aria-live": "polite" }, announce),
      ),
      h(
        "aside",
        { className: "panel" },
        h(
          "section",
          { className: "card" },
          h("h2", null, "What the hotel tool returns"),
          h("select", { value: setName, onChange: (e: any) => setSetName(e.target.value), "aria-label": "Data set" }, SETS.map((s) => h("option", { key: s, value: s }, SET_LABEL[s]))),
          h("p", { className: "hint" }, "Used on the next search. Then type a destination, dates as YYYY-MM-DD and a number of guests."),
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
            h("button", { onClick: garbage }, "Write garbage into an input path"),
            h("button", { onClick: toggleRule, "aria-pressed": ruleEdited }, ruleEdited ? "Restore the rule" : "Edit a rule hotel results depends on"),
            h("button", { onClick: recheckAll }, "Re-check and re-approve"),
          ),
        ),
        h(
          "section",
          { className: "card grow" },
          h("div", { className: "tabs", role: "tablist" }, (["log", "instance", "actions", "messages"] as const).map((t) => h("button", { key: t, role: "tab", "aria-selected": tab === t, onClick: () => setTab(t) }, { log: "Host log", instance: "Instance", actions: "Payloads", messages: "Messages" }[t]))),
          tab === "log" && h("ol", { className: "log" }, log.map((l) => h("li", { key: l.n, className: l.tone }, h("strong", null, l.title), l.detail && h("span", null, l.detail)))),
          tab === "instance" && current && h(
            "dl",
            { className: "facts" },
            ...([
              ["Surface", current.surfaceId],
              ["Composition", `${current.composition} v${current.version}`],
              ["State", current.state],
              ["Purpose", current.purpose],
              ["Contract pin", short(current.pins.contractSha256)],
              ["Interaction pin", short(current.pins.interactionSha256)],
              ["Composition pin", short(current.pins.compositionSha256)],
              ["Expansion", short(current.expansionSha256)],
              ["Inputs", current.inputs.map((i) => `${i.name} → ${i.path}`).join(", ") || "none"],
              ["Carried", lastShow?.ok ? lastShow.carried.join(", ") || "nothing" : "n/a"],
              ["Instantiation", `${current.timings.totalMs.toFixed(1)} ms`],
            ] as const).flatMap(([k, v]) => [h("dt", { key: `${k}t` }, k), h("dd", { key: `${k}d` }, v)]),
          ),
          tab === "actions" && current && h(
            "table",
            { className: "payloads" },
            h("thead", null, h("tr", null, h("th", null, "Action"), h("th", null, "Component"), h("th", null, "Item"), h("th", null, "Payload"))),
            h("tbody", null, current.actions.map((a) => h("tr", { key: a.componentId }, h("td", null, a.name + (a.consequential ? " ⚑" : "")), h("td", null, h("code", null, a.componentId)), h("td", null, a.item ? `${a.item.index + 1}: ${a.item.witness[0]}` : "—"), h("td", null, h("code", null, JSON.stringify({ ...a.payload, ...Object.fromEntries(a.carries.map((c) => [c, `/input/${c}`])) })))))),
          ),
          tab === "messages" && h("pre", { className: "json" }, JSON.stringify(batch, null, 1)),
        ),
        h(
          "details",
          { className: "card about" },
          h("summary", null, "About this demonstration"),
          h("p", null, h("strong", null, "Real: "), "expansion, state selection, the design system's rules (S1 to S3), emission, input bindings and payloads, A1 to A3, pins, the host's checks, replacement, carried values and focus. The same code the tests and evidence use."),
          h("p", null, h("strong", null, "Simulated: "), "the hotel tool. A search returns the data set chosen above; reserving books nothing."),
          h("p", null, h("strong", null, "Not in R1a: "), "a complete reservation flow, planning, persistence, the Composer workspace."),
        ),
      ),
    ),
  );
};

createRoot(document.getElementById("root")!).render(h(App));
