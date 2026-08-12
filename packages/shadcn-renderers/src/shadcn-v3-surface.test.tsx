/**
 * THE PRODUCTION CATALOG, RENDERED. Every other suite in this package reads a
 * corpus emitted from the ASTRYX contract — where a Table's body rows live in
 * `data`, a Button carries a `label`, and an AlertDialog's confirm label is
 * `actionLabel`. The catalog the hosted composer actually ships is
 * shadcn/ui v3, and it names those things `rows`, `child` and `confirmLabel`.
 * A renderer can therefore satisfy every Astryx-fed suite in this repo and
 * still draw an empty table, a wordless button and a blank confirm — which is
 * exactly what shipped.
 *
 * So this suite renders REAL SHIPPED MATERIAL under the REAL production
 * contract: the shadcn/ui v3 dspack document and profile in packages/contracts
 * (the drift-guarded copies of the composer's reference project), through the
 * real `emitSurface`, through the real registry, and asserts the text a user
 * is supposed to read comes out. Nothing here is a hand-written fixture; if
 * the contract's examples change, this suite renders whatever they now say.
 */
import { readFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { emitSurface, loadProfile } from "@aestheticfunction/dspack-emit";
import { shadcnRegistry } from "./registry";

const read = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));

/** The shipped production contract + profile (byte-copies of the composer's
 *  shadcn-v3 reference project; the contracts build gates them on every run). */
const contract = read("../../contracts/shadcn-v3.dspack.json") as {
  examples: Array<{ id: string; surface?: unknown }>;
};
const profile = loadProfile(read("../../contracts/shadcn-v3.profile.json"));

/** Emit one shipped example and index its A2UI components by id. */
function emitExample(id: string): { byId: Map<string, any>; rootId: string } {
  const example = contract.examples.find((e) => e.id === id);
  if (!example?.surface) throw new Error(`shipped example '${id}' not found in the shadcn/ui v3 contract`);
  const { messages } = emitSurface(example.surface as never, contract as never, { profile });
  const byId = new Map<string, any>();
  let rootId = "";
  for (const message of messages as Array<Record<string, any>>) {
    for (const component of message.updateComponents?.components ?? []) {
      byId.set(component.id, component);
      if (!rootId) rootId = component.id;
    }
  }
  if (byId.size === 0) throw new Error(`example '${id}' emitted no components`);
  return { byId, rootId };
}

/**
 * Render an emitted surface through the registry the composer uses, resolving
 * ComponentId references the way A2UI's binder does: `buildChild` renders the
 * referenced component, recursively. Actions arrive as callables.
 */
function renderSurface(byId: Map<string, any>, rootId: string): string {
  const build = (id: string): ReactNode => {
    const component = byId.get(id);
    if (!component) return null;
    const Visual = (shadcnRegistry.custom as Record<string, any>)[component.component];
    if (!Visual) return createElement("div", { key: id }, `[unimplemented:${component.component}]`);
    const props: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(component)) {
      if (key === "id" || key === "component") continue;
      props[key] = key === "action" ? () => {} : value;
    }
    return createElement(Visual, {
      key: id,
      props,
      buildChild: build,
      context: { componentModel: { id }, dataContext: { path: "/" } },
    });
  };
  return renderToStaticMarkup(createElement("div", null, build(rootId)));
}

const renderExample = (id: string) => {
  const { byId, rootId } = emitExample(id);
  return renderSurface(byId, rootId);
};

const bodyRows = (html: string): string[] => {
  const start = html.indexOf("<tbody>");
  const end = html.indexOf("</tbody>");
  if (start < 0 || end < 0) return [];
  const body = html.slice(start + "<tbody>".length, end);
  return body.split("<tr").slice(1);
};

const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

/** The shipped examples this suite renders. */
const EXAMPLES = ["ex.support-ticket-queue", "ex.orders-table-loading", "ex.delete-project-confirmation"];

describe("shipped shadcn/ui v3 examples render their real content", () => {
  it("ex.support-ticket-queue: one body row per emitted row, with every cell", () => {
    const html = renderExample("ex.support-ticket-queue");
    // The contract's example carries three tickets across four columns.
    expect(bodyRows(html)).toHaveLength(3);
    const visible = text(html);
    for (const header of ["Ticket", "Subject", "Status", "Priority"]) expect(visible).toContain(header);
    for (const cell of [
      "#4812", "Cannot export billing statement", "Urgent", "P1",
      "#4809", "Two-factor codes arrive late", "Waiting on customer", "P2",
      "#4801", "Dark mode contrast on invoices", "Open", "P3",
    ]) {
      expect(visible).toContain(cell);
    }
  });

  it("ex.orders-table-loading: the loading placeholder keeps its row structure", () => {
    // Every cell flattens to empty text (the Skeletons are a documented
    // casualty of the synthesized table shape), so ROW COUNT is the whole
    // property: a placeholder that renders no rows does not hold the shape of
    // what is coming, which is the only job a loading table has.
    const html = renderExample("ex.orders-table-loading");
    expect(bodyRows(html)).toHaveLength(3);
    for (const header of ["Order", "Customer", "Status", "Total"]) expect(text(html)).toContain(header);
  });

  it("ex.delete-project-confirmation: the buttons say what they do", () => {
    // The composer's flagship destructive-action surface. Its Button carries
    // its text as a `child` ComponentId (shadcn/ui v3's anatomy), and its
    // AlertDialog names the confirm action in `confirmLabel` and the opener in
    // `triggerLabel`. A blank button on a delete confirmation is the worst
    // possible place for dropped content.
    const visible = text(renderExample("ex.delete-project-confirmation"));
    expect(visible).toContain("Cancel");
    expect(visible).toContain("Delete project and all data");
    expect(visible).toContain("Keep project");
    expect(visible).toContain("Delete Northwind Checkout?");
  });

  it("draws the components under test natively, and names the one it does not", () => {
    // A guard on the guards above: if a component quietly lost its native
    // visual, the assertions would be measuring a placeholder. This registry
    // is a first-class PARTIAL cover of the production catalog, so the honest
    // statement is which name falls back, not that none does — in the
    // composer, wireframe fills that gap (apps/composer/app/registries.ts).
    const fallbacks = new Set<string>();
    for (const id of EXAMPLES) {
      for (const component of emitExample(id).byId.values()) {
        if (!(shadcnRegistry.custom as Record<string, unknown>)[component.component]) {
          fallbacks.add(component.component);
        }
      }
    }
    expect([...fallbacks]).toEqual(["Spinner"]);
    for (const name of ["Table", "Button", "AlertDialog", "Card", "Column", "Text", "Alert", "TextField"]) {
      expect(shadcnRegistry.custom[name]).toBeTypeOf("function");
    }
  });
});
