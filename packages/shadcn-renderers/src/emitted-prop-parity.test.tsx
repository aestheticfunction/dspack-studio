/**
 * PROPS-LEVEL PARITY: what dspack-emit EMITS vs what this design system's
 * renderers actually CONSUME.
 *
 * Why this suite exists, and why the checks it already had are not enough:
 * A3 (the emitter's instance gate) validates a message against the catalog, so
 * it passes for a renderer that ignores every prop it is handed; a screenshot
 * shows pixels but cannot say which emitted prop produced them. A schema-valid
 * surface that renders wrong is FAILED representation evidence — the drift has
 * to be caught at the prop level or it is not caught at all.
 *
 * The corpus is real emitter output (see `emitted-corpus.ts`): every distinct
 * A2UI instance in the contracts build and in the recorded fixtures. Nothing
 * here is hand-listed, so growing the scenario shelf grows the guard.
 *
 * The four properties asserted, each grounded in how the stack actually runs:
 *  1. CONSUMPTION — perturbing an emitted prop to another legal value must
 *     change the rendered markup. If it does not, the renderer is provably
 *     ignoring that prop.
 *  2. DISTINGUISHABILITY — for an enum prop the emitter emits, every legal
 *     catalog value must render distinguishably. A design system may project a
 *     treatment onto its own idiom, but collapsing distinct contract values
 *     onto identical pixels destroys the distinction the contract carried.
 *  3. DEFAULT FIDELITY — omitting a prop must render as the catalog's declared
 *     default. A2UI's GenericBinder resolves raw properties and never runs the
 *     zod schema's `.default()`, so an omitted prop reaches the renderer as
 *     `undefined` and the renderer's own fallback is the ONLY thing that can
 *     honor the contract default.
 *  4. CONTENT — every string the instance carries must appear in the output,
 *     every child id must be built exactly once, and every table row must
 *     survive. Blank output for an instance that carries content is a failure,
 *     never a silent pass.
 */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { shadcnRegistry } from "./registry";
import {
  catalogProps,
  emittedEnumProps,
  emittedInstances,
  emittedProps,
  type EmittedInstance,
} from "./emitted-corpus";

/* ------------------------------------------------------------------ render */

/** Marker child so slot wiring is observable in static markup. */
const buildChild = (id: string): ReactNode => createElement("i", { key: id }, `[child:${id}]`);

/**
 * Shape raw emitted props the way A2UI's binder delivers them: actions become
 * callables, DynamicString bindings arrive resolved, everything else verbatim.
 */
function bindProps(component: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(emittedProps(component))) {
    if (key === "action") {
      out[key] = () => {};
    } else if (value && typeof value === "object" && !Array.isArray(value) && typeof value.path === "string") {
      out[key] = `bound:${value.path}`;
    } else {
      out[key] = value;
    }
  }
  return out;
}

function render(componentName: string, props: Record<string, any>): string {
  const Visual = (shadcnRegistry.custom as Record<string, any>)[componentName];
  if (!Visual) return "";
  return renderToStaticMarkup(
    createElement(Visual, {
      props,
      buildChild,
      context: { componentModel: { id: "node" }, dataContext: { path: "/" } },
    }),
  );
}

const visibleText = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

/** Instances this design system draws (Dialog is the deliberate placeholder). */
const renderable = (): EmittedInstance[] =>
  emittedInstances().filter((i) => Boolean((shadcnRegistry.custom as Record<string, any>)[i.component.component]));

const label = (i: EmittedInstance) => `${i.source}:${i.surfaceId}#${i.component.id} (${i.component.component})`;

/** Another legal value for an emitted prop — enum-aware, shape-aware. */
function perturb(componentName: string, prop: string, value: unknown): unknown {
  const schema = catalogProps(componentName)[prop];
  if (Array.isArray(schema?.enum)) return schema.enum.find((v: unknown) => v !== value) ?? value;
  if (typeof value === "boolean") return !value;
  if (typeof value === "number") return value + 41;
  if (typeof value === "string") return `${value} PERTURBED`;
  if (Array.isArray(value)) {
    if (value.length > 1) return value.slice(0, -1);
    if (value.length === 1) {
      const [only] = value;
      if (typeof only === "string") return [`${only}-perturbed`];
      if (only && typeof only === "object") return [];
    }
    return [...value, "perturbed"];
  }
  return value;
}

/* ------------------------------------------------- 1. emitted vs consumed */

describe("emitted-prop vs consumed-prop parity", () => {
  it("every prop the emitter emits changes what this design system renders", () => {
    const ignored: string[] = [];
    for (const instance of renderable()) {
      const name = instance.component.component;
      const props = bindProps(instance.component);
      const baseline = render(name, props);
      for (const [prop, value] of Object.entries(props)) {
        if (prop === "action") continue; // dispatch behavior, not markup
        const other = perturb(name, prop, instance.component[prop]);
        if (JSON.stringify(other) === JSON.stringify(instance.component[prop])) continue;
        if (render(name, { ...props, [prop]: other }) === baseline) {
          ignored.push(`${name}.${prop} ignored at ${label(instance)}`);
        }
      }
    }
    expect(ignored).toEqual([]);
  });

  it("covers a corpus that actually exercises the registry", () => {
    // A guard on the guard: if the corpus ever empties (a moved fixture
    // directory, a skipped contracts build) every check above passes vacuously.
    const instances = renderable();
    expect(instances.length).toBeGreaterThan(100);
    const covered = new Set(instances.map((i) => i.component.component));
    for (const name of Object.keys(shadcnRegistry.custom)) expect([...covered]).toContain(name);
  });
});

/* ------------------------------------------- 2. variant / value fidelity */

describe("variant fidelity", () => {
  it("keeps every legal value of an emitted enum prop distinguishable", () => {
    const collapsed: string[] = [];
    for (const { componentName, prop, values } of emittedEnumProps()) {
      const instance = renderable().find((i) => i.component.component === componentName && prop in i.component);
      if (!instance) continue;
      const props = bindProps(instance.component);
      const byMarkup = new Map<string, string[]>();
      for (const value of values) {
        const markup = render(componentName, { ...props, [prop]: value });
        byMarkup.set(markup, [...(byMarkup.get(markup) ?? []), value]);
      }
      for (const group of byMarkup.values()) {
        if (group.length > 1) collapsed.push(`${componentName}.${prop}: ${group.join(" = ")} render identically`);
      }
    }
    expect(collapsed).toEqual([]);
  });

  it("renders a destructive action destructively, and a non-destructive one not", () => {
    // The named failure mode: a destructive button that looks like any other.
    const destructive = render("Button", { label: "Delete project", variant: "destructive", action: () => {} });
    const primary = render("Button", { label: "Delete project", variant: "primary", action: () => {} });
    expect(destructive).toContain("destructive");
    expect(destructive).not.toEqual(primary);
    expect(primary).not.toContain("destructive");

    // AlertDialog's confirm button carries the same duty...
    const confirm = render("AlertDialog", {
      title: "Delete this project?",
      description: "This cannot be undone.",
      actionLabel: "Delete project",
      actionVariant: "destructive",
      action: () => {},
    });
    expect(confirm).toContain("destructive");

    // ...in both directions: the contract's `primary` default must not be
    // dressed as a destructive confirm, or every dialog reads as dangerous.
    const informational = {
      title: "Publish this project?",
      description: "It becomes visible to your team.",
      actionLabel: "Publish project",
      action: () => {},
    };
    expect(render("AlertDialog", { ...informational, actionVariant: "primary" })).not.toContain("destructive");
    // `actionVariant` is optional; omitting it means the catalog default,
    // which is `primary` — not destructive.
    expect(render("AlertDialog", informational)).not.toContain("destructive");
  });
});

/* -------------------------------------------------- 3. default fidelity */

describe("catalog default fidelity", () => {
  it("renders an omitted prop as the catalog's declared default", () => {
    // A2UI's binder never applies the zod schema's default (it resolves raw
    // properties), so the renderer's fallback is the contract's last defense.
    const wrong: string[] = [];
    for (const { componentName, prop, default: declared } of emittedEnumProps()) {
      if (declared === undefined) continue;
      const instance = renderable().find((i) => i.component.component === componentName && prop in i.component);
      if (!instance) continue;
      const props = bindProps(instance.component);
      const { [prop]: _omitted, ...without } = props;
      const asDefault = render(componentName, { ...props, [prop]: declared });
      if (render(componentName, without) !== asDefault) {
        wrong.push(`${componentName}.${prop} omitted does not render as the catalog default '${declared}'`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

/* --------------------------------------- 4. slots, repeats, content, rows */

/**
 * The structural detectors, written as pure `(markup, emitted) -> violations`
 * so each one can be turned on a DELIBERATELY BROKEN visual below. A detector
 * that has never rejected anything is decoration, not a guard.
 */

/** Every child id the instance hands the renderer must be built exactly once. */
function slotViolations(html: string, component: Record<string, any>): string[] {
  const ids: string[] = [];
  if (typeof component.child === "string") ids.push(component.child);
  if (Array.isArray(component.children)) {
    ids.push(...component.children.filter((c: unknown): c is string => typeof c === "string"));
  }
  return ids
    .map((id) => ({ id, times: html.split(`[child:${id}]`).length - 1 }))
    .filter(({ times }) => times !== 1)
    .map(({ id, times }) => `child '${id}' built ${times}x`);
}

/** Every repeated item a data-driven prop carries must reach the output. */
function repeatViolations(html: string, component: Record<string, any>): string[] {
  const text = visibleText(html);
  const out: string[] = [];
  for (const item of (component.items ?? []) as Array<Record<string, unknown>>) {
    for (const field of ["label", "value"] as const) {
      const v = item?.[field];
      if (typeof v === "string" && v.trim() && !text.includes(v.trim())) out.push(`item ${field} '${v}'`);
    }
  }
  for (const column of (component.columns ?? []) as unknown[]) {
    if (typeof column === "string" && column.trim() && !text.includes(column.trim())) {
      out.push(`column header '${column}'`);
    }
  }
  return out;
}

/** One body row per emitted row, every cell and status intact. */
function tableRowViolations(html: string, component: Record<string, any>): string[] {
  const out: string[] = [];
  const body = html.slice(html.indexOf("<tbody>"), html.indexOf("</tbody>"));
  const rendered = body.split("<tr").length - 1;
  const rows = (component.data ?? []) as Array<Record<string, any>>;
  const children = (component.children ?? []) as string[];
  const expected =
    rows.length > 0
      ? rows.length
      : Math.ceil(children.length / Math.max(((component.columns ?? []) as unknown[]).length, 1));
  if (rendered !== expected) out.push(`rendered ${rendered} body rows for ${expected} emitted`);
  const text = visibleText(html);
  for (const row of rows) {
    for (const cell of row?.cells ?? []) {
      if (String(cell).trim() && !text.includes(String(cell).trim())) out.push(`dropped cell '${cell}'`);
    }
    const status = row?.status?.label;
    if (typeof status === "string" && status.trim() && !text.includes(status.trim())) {
      out.push(`dropped status '${status}'`);
    }
  }
  return out;
}

/** Every string an emitted instance promises will be visible. */
function promisedText(component: Record<string, any>): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && v.trim()) out.push(v.trim());
  };
  for (const key of ["label", "text", "title", "description", "actionLabel", "cancelLabel"]) push(component[key]);
  for (const item of (component.items ?? []) as Array<Record<string, unknown>>) {
    push(item?.label);
    push(item?.value);
  }
  for (const row of (component.data ?? []) as Array<Record<string, any>>) {
    for (const cell of row?.cells ?? []) push(String(cell));
  }
  for (const column of (component.columns ?? []) as unknown[]) push(column as string);
  return out;
}

/** Blank output, or promised content missing from it. */
function contentViolations(html: string, component: Record<string, any>): string[] {
  const promised = promisedText(component);
  if (promised.length === 0) return []; // nothing claimed, nothing owed
  const text = visibleText(html);
  if (!text) return ["rendered nothing"];
  const dropped = promised.filter((s) => !text.includes(s) && !html.includes(s));
  return dropped.length ? [`dropped ${JSON.stringify(dropped)}`] : [];
}

/** A Table instance with rows, cells, a status column and headers. */
const TABLE_FIXTURE = {
  component: "Table",
  columns: ["Ticket", "Customer"],
  data: [
    { cells: ["T-1041", "Northwind"], status: { label: "open", variant: "info" } },
    { cells: ["T-1042", "Contoso"], status: { label: "escalated", variant: "error" } },
    { cells: ["T-1043", "Fabrikam"], status: { label: "closed", variant: "neutral" } },
  ],
};

describe("slot and repeated-item parity", () => {
  it("builds every emitted child id exactly once", () => {
    const broken: string[] = [];
    for (const instance of renderable()) {
      const html = render(instance.component.component, bindProps(instance.component));
      for (const v of slotViolations(html, instance.component)) broken.push(`${label(instance)} ${v}`);
    }
    expect(broken).toEqual([]);
  });

  it("renders every repeated item a data-driven prop carries", () => {
    const missing: string[] = [];
    for (const instance of renderable()) {
      const html = render(instance.component.component, bindProps(instance.component));
      for (const v of repeatViolations(html, instance.component)) missing.push(`${label(instance)} ${v}`);
    }
    expect(missing).toEqual([]);
  });

  it("rejects a visual that ignores its slot or drops repeated items", () => {
    // The detectors turned on deliberately broken visuals.
    const ignoresChildren = renderToStaticMarkup(createElement("div", null, "no slots here"));
    expect(slotViolations(ignoresChildren, { children: ["a", "b"] })).toEqual([
      "child 'a' built 0x",
      "child 'b' built 0x",
    ]);
    const duplicatesChild = renderToStaticMarkup(createElement("div", null, "[child:a]", "[child:a]"));
    expect(slotViolations(duplicatesChild, { child: "a" })).toEqual(["child 'a' built 2x"]);
    const dropsItems = renderToStaticMarkup(createElement("dl", null, createElement("dt", null, "Guests")));
    expect(repeatViolations(dropsItems, { items: [{ label: "Guests", value: "2" }] })).toEqual(["item value '2'"]);
  });
});

describe("table row preservation", () => {
  it("keeps one body row per emitted data row, with every cell", () => {
    const lost: string[] = [];
    for (const instance of renderable()) {
      if (instance.component.component !== "Table") continue;
      const html = render("Table", bindProps(instance.component));
      for (const v of tableRowViolations(html, instance.component)) lost.push(`${label(instance)} ${v}`);
    }
    expect(lost).toEqual([]);
  });

  it("preserves rows, cells and statuses for a multi-row table", () => {
    const violations = tableRowViolations(render("Table", TABLE_FIXTURE), TABLE_FIXTURE);
    expect(violations).toEqual([]);
  });

  it("rejects a visual that drops rows", () => {
    // Same detector, same fixture, one row deliberately dropped.
    const truncated = render("Table", { ...TABLE_FIXTURE, data: TABLE_FIXTURE.data.slice(0, -1) });
    expect(tableRowViolations(truncated, TABLE_FIXTURE)).toEqual([
      "rendered 2 body rows for 3 emitted",
      "dropped cell 'T-1043'",
      "dropped cell 'Fabrikam'",
      "dropped status 'closed'",
    ]);
  });
});

describe("blank-content detection", () => {
  it("never renders an empty component for an instance that carries content", () => {
    const blank: string[] = [];
    for (const instance of renderable()) {
      const html = render(instance.component.component, bindProps(instance.component));
      for (const v of contentViolations(html, instance.component)) blank.push(`${label(instance)} ${v}`);
    }
    expect(blank).toEqual([]);
  });

  it("fails a visual that renders nothing, rather than passing it silently", () => {
    // Without this the detector could be vacuous: "renders nothing" and
    // "renders correctly" would be the same green tick.
    const nothing = renderToStaticMarkup(createElement(() => null));
    expect(contentViolations(nothing, { label: "Delete project" })).toEqual(["rendered nothing"]);
    const real = render("Badge", { label: "open", variant: "info" });
    expect(contentViolations(real, { label: "open" })).toEqual([]);
    expect(visibleText(real)).toBe("open");
  });
});
