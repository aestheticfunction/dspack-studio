/**
 * The level 2 fidelity page: renders one exported instance (evidence/<case>.json)
 * and records every action the renderer dispatches, so a browser test can
 * assert on what is drawn and what it sends. The same page is built twice:
 * on upstream @a2ui/react 0.16.1 through the spike's bridge, and on Composer's
 * own canvas (a2ui-ingest on the pinned 0.10 stack), so the two can be compared.
 */
import { createElement, useMemo, useState, type FC } from "react";
import { createRoot } from "react-dom/client";
import evidence from "../dist/evidence-bundle.json";

export type Renderer = FC<{ catalog: Record<string, any>; messages: unknown[]; onAction: (a: any) => void }>;

export function mountFidelity(stack: string, Render: Renderer) {
  const cases = (evidence as any).cases as Array<{ id: string; messages: unknown[] }>;
  const initial = new URLSearchParams(location.search).get("case") ?? cases[0]!.id;
  const w = window as any;
  w.__fidelity = { stack, actions: [] as any[], cases: cases.map((c) => c.id) };
  const App: FC = () => {
    const [id, setId] = useState(initial);
    const rec = cases.find((c) => c.id === id)!;
    const messages = useMemo(() => rec.messages, [rec]);
    return createElement(
      "main",
      { style: { padding: 24, maxWidth: 760, margin: "0 auto", fontFamily: "system-ui, sans-serif" } },
      createElement("p", { "data-stack": stack, style: { font: "12px monospace", color: "#666" } }, `stack: ${stack} · case: ${id}`),
      createElement("select", { "aria-label": "Case", value: id, onChange: (e: any) => { w.__fidelity.actions = []; setId(e.target.value); } }, cases.map((c) => createElement("option", { key: c.id, value: c.id }, c.id))),
      createElement("div", { "data-canvas": "", style: { marginTop: 16 } }, createElement(Render, { key: id, catalog: (evidence as any).catalog, messages, onAction: (a: any) => w.__fidelity.actions.push(JSON.parse(JSON.stringify(a))) })),
    );
  };
  createRoot(document.getElementById("root")!).render(createElement(App));
}
