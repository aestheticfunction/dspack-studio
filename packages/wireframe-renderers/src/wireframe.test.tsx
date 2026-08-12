/**
 * The wireframe registry against a REAL emitted catalog (the acme spike
 * catalog is regenerated as the composer demo's build artifact; here a
 * committed copy of its v0.9.1 form from composer-core's fixtures pipeline).
 *
 * Verified properties: every catalog name gets a visual (planRegistry
 * reports zero unimplemented); child/children/action props are classified
 * from the catalog's $refs; a wireframe renders without executing any
 * user code; and — the point of the whole registry — what it draws is a
 * LOW-FIDELITY STRUCTURE (name, bands, text lines), never a serialized
 * props dump.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { planRegistry } from "@dspack-studio/a2ui-ingest";
import { classifyProps } from "./classify-props";
import { wireframeRegistryFor } from "./registry";

// The canonical shadcn catalog shape is stable and committed in contracts'
// build output during CI; for a self-contained unit test we use the acme
// fixture contract's emitted catalog captured under fixtures/.
const catalog = JSON.parse(
  readFileSync(fileURLToPath(new URL("../fixtures/acme.catalog.v0_9_1.json", import.meta.url)), "utf8"),
);

/**
 * A collection component in the emitted shape ANY catalog uses for tabular
 * data (array-of-string headers, array-of-record rows). Declared inline
 * rather than hand-written per design system: the registry is generated to
 * cover any conformant catalog, so its structural rendering is proven on a
 * catalog it has never seen.
 */
const collectionCatalog = {
  components: {
    Table: {
      type: "object",
      allOf: [
        {
          type: "object",
          properties: {
            component: { const: "Table" },
            caption: { $ref: "#/$defs/DynamicString" },
            columns: { type: "array", items: { type: "string" } },
            rows: { type: "array", items: { type: "object" } },
          },
        },
      ],
    },
  },
};

const tableProps = {
  caption: "Recent invoices",
  columns: ["Invoice", "Status", "Amount"],
  rows: [
    { cells: ["INV-001", "Paid", "$120.00"] },
    { cells: ["INV-002", "Overdue", "$80.00"] },
    { cells: ["INV-003", "Draft", "$12.00"] },
  ],
};

const renderTable = () =>
  renderToStaticMarkup(
    createElement(wireframeRegistryFor(collectionCatalog).custom.Table, { props: tableProps, buildChild: () => null }),
  );

describe("wireframeRegistryFor", () => {
  it("covers every catalog name (zero unimplemented)", () => {
    const registry = wireframeRegistryFor(catalog);
    const names = Object.keys(catalog.components);
    const plan = planRegistry(names, registry);
    expect(plan.unimplemented).toEqual([]);
    expect(Object.keys(registry.custom).sort()).toEqual([...names].sort());
  });

  it("classifies child/children/action props from catalog $refs", () => {
    const button = Object.fromEntries(classifyProps(catalog, "Button").map((p) => [p.name, p.kind]));
    expect(button.action).toBe("action");
    expect(button.label).toBe("value");
    const card = Object.fromEntries(classifyProps(catalog, "Card").map((p) => [p.name, p.kind]));
    expect(card.child).toBe("child");
    const column = Object.fromEntries(classifyProps(catalog, "Column").map((p) => [p.name, p.kind]));
    expect(column.children).toBe("children");
  });

  it("classifies a value prop's SHAPE from the catalog (enum, boolean, text, structure)", () => {
    const button = Object.fromEntries(classifyProps(catalog, "Button").map((p) => [p.name, p.shape]));
    expect(button.label).toBe("text"); // free-form string: real content
    expect(button.variant).toBe("enum"); // a token, not content
    const table = Object.fromEntries(classifyProps(collectionCatalog, "Table").map((p) => [p.name, p.shape]));
    expect(table.caption).toBe("text");
    expect(table.columns).toBe("list");
    expect(table.rows).toBe("list");
  });

  it("renders a labeled wireframe with real text, a state chip, and an inert action", () => {
    const registry = wireframeRegistryFor(catalog);
    const html = renderToStaticMarkup(
      createElement(registry.custom.Button, {
        props: { label: "Acknowledge", variant: "primary", action: { event: { name: "ack", context: {} } } },
        buildChild: () => null,
      }),
    );
    expect(html).toContain("Button"); // the component's own name
    expect(html).toContain("Acknowledge"); // genuinely textual content stays visible
    expect(html).toContain("primary"); // the token reads as a state chip…
    expect(html).not.toContain("label=Acknowledge"); // …never as a props dump
    expect(html).not.toContain("variant=primary");
    expect(html).toContain('data-wire="state"');
    expect(html).toContain("disabled");
    expect(html).toContain("data-a2ui-component"); // provenance wrapper intact
  });

  it("renders child references through buildChild without executing user code", () => {
    const registry = wireframeRegistryFor(catalog);
    const html = renderToStaticMarkup(
      createElement(registry.custom.Card, {
        props: { child: "inner" },
        buildChild: (id: string) => createElement("em", { key: id }, `child:${id}`),
      }),
    );
    expect(html).toContain("child:inner");
    expect(html).toContain('data-wire="block"'); // a bordered structural block, not a bare div
  });
});

/**
 * B6 — a wireframe must look like a wireframe. The product's most important
 * moment renders low-fidelity STRUCTURE derived from the data's own shape:
 * generic, data-driven, and identical for any catalog.
 */
describe("the wireframe is a structural sketch, never a props dump", () => {
  it("never serializes props into the visual", () => {
    const html = renderTable();
    for (const leak of ['rows=[{', 'columns=["', "rows=", "columns=", "caption=", "cells", "[{", '&quot;']) {
      expect(html).not.toContain(leak);
    }
    expect(html).not.toContain(JSON.stringify(tableProps.rows));
    expect(html).not.toContain(JSON.stringify(tableProps.columns));
  });

  it("draws the component name and a structural sketch", () => {
    const html = renderTable();
    expect(html).toContain('data-wireframe="Table"');
    expect(html).toContain("Table");
    expect(html).toContain("data-wire-sketch");
  });

  it("a header band uses the REAL column labels and count", () => {
    const html = renderTable();
    expect(html).toContain('data-wire-band="header"');
    for (const column of tableProps.columns) expect(html).toContain(column);
    const headerBand = html.slice(html.indexOf('data-wire-band="header"'), html.indexOf('data-wire-band="row"'));
    expect(headerBand.match(/data-wire="cell"/g) ?? []).toHaveLength(tableProps.columns.length);
  });

  it("row bands use the REAL row count and show the row's own text", () => {
    const html = renderTable();
    expect(html.match(/data-wire-band="row"/g) ?? []).toHaveLength(tableProps.rows.length);
    expect(html).toContain("INV-001");
    expect(html).toContain("Overdue");
  });

  it("a long collection stays a sketch: bands are capped and the remainder is stated", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ cells: [`INV-${i}`, "Paid", "$1.00"] }));
    const html = renderToStaticMarkup(
      createElement(wireframeRegistryFor(collectionCatalog).custom.Table, {
        props: { ...tableProps, rows },
        buildChild: () => null,
      }),
    );
    const bands = html.match(/data-wire-band="row"/g) ?? [];
    expect(bands.length).toBeGreaterThan(0);
    expect(bands.length).toBeLessThanOrEqual(6);
    expect(html).toContain(`${rows.length - bands.length} more`);
  });

  it("textual props read as text lines — the honest 'no native visual here', never an error", () => {
    const html = renderTable();
    expect(html).toContain('data-wire="text"');
    expect(html).toContain("Recent invoices");
    expect(html).not.toMatch(/error|unimplemented|undefined/i);
  });
});
