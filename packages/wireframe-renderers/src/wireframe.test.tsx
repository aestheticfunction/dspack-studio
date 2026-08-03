/**
 * The wireframe registry against a REAL emitted catalog (the acme spike
 * catalog is regenerated as the composer demo's build artifact; here a
 * committed copy of its v0.9.1 form from composer-core's fixtures pipeline).
 *
 * Verified properties: every catalog name gets a visual (planRegistry
 * reports zero unimplemented); child/children/action props are classified
 * from the catalog's $refs; a wireframe renders without executing any
 * user code (static markup contains the component name and scalar props).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { planRegistry } from "@dspack-studio/a2ui-ingest";
import { classifyProps } from "./classify-props.js";
import { wireframeRegistryFor } from "./registry.js";

// The canonical shadcn catalog shape is stable and committed in contracts'
// build output during CI; for a self-contained unit test we use the acme
// fixture contract's emitted catalog captured under fixtures/.
const catalog = JSON.parse(
  readFileSync(fileURLToPath(new URL("../fixtures/acme.catalog.v0_9_1.json", import.meta.url)), "utf8"),
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

  it("renders a labeled wireframe with scalar props and an inert action", () => {
    const registry = wireframeRegistryFor(catalog);
    const html = renderToStaticMarkup(
      createElement(registry.custom.Button, {
        props: { label: "Acknowledge", variant: "primary", action: { event: { name: "ack", context: {} } } },
        buildChild: () => null,
      }),
    );
    expect(html).toContain("Button");
    expect(html).toContain("label=Acknowledge");
    expect(html).toContain("variant=primary");
    expect(html).toContain("action: action");
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
  });
});
