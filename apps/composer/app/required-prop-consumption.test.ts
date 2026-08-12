/**
 * THE STRUCTURAL GUARD: a REQUIRED catalog prop must not be silently ignored
 * by its native renderer.
 *
 * The failure this exists to make impossible was shipped, twice over. The
 * shadcn Table renderer read its body rows from `props.data` — the Astryx
 * catalog's name — while the production shadcn/ui v3 catalog declares
 * `rows` (required) and no `data` at all. Every gate stayed green: A3
 * validates the INSTANCE against the catalog, and an instance is perfectly
 * valid when the renderer that draws it reads a prop the catalog never
 * declared. The parity suites in packages/shadcn-renderers could not see it
 * either, because their corpus is emitted from the ASTRYX contract, where
 * `data` is the real name. So a renderer could ignore a required prop of a
 * catalog it serves, and nothing in the repo would say a word.
 *
 * This is deliberately a BEHAVIOR-level check, not a source grep for prop
 * names: it builds an instance per component with every required prop
 * populated by distinctive SENTINEL values, renders it through the real
 * registry, and asserts the sentinels come out the other side. A renderer
 * that reads the right prop passes however it is written; a renderer that
 * reads the wrong one fails however plausible its source looks.
 *
 * It runs against BOTH governed catalogs and BOTH native registries — the
 * bug was a cross-catalog confusion, so a single-catalog guard would have
 * missed it.
 */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Registry } from "@dspack-studio/a2ui-ingest";
import { nativeRegistryFor, NATIVE_REGISTRIES } from "./registries";
import shadcnEmit from "./demo/generated/emit.shadcn.json";
import astryxEmit from "./demo/generated/emit.astryx.json";

type Catalog = { components: Record<string, any>; $defs?: Record<string, any> };

const CATALOGS: Record<string, Catalog> = {
  shadcn: (shadcnEmit as { catalog: Catalog }).catalog,
  astryx: (astryxEmit as { catalog: Catalog }).catalog,
};

/**
 * PER-PROP ALLOWLIST. Every entry is a claim that a prop is consumed
 * STRUCTURALLY rather than displayed, so no sentinel it carries could ever
 * appear in static markup. Each one needs a reason someone can argue with;
 * the list is meant to stay this short.
 *
 * `child` and `children` are deliberately NOT here: they carry ComponentId
 * references, the marker `buildChild` below renders the id verbatim, and so a
 * slot that is never built is caught like any other dropped sentinel.
 */
const STRUCTURAL_PROPS: Record<string, string> = {
  action: "A2UI Action — a handler the binder turns into a callback and the renderer wires to onClick. It is dispatch behavior; it has no visible text to observe in static markup, and its consumption is covered by the interaction e2e suites.",
};

/**
 * Content-bearing keys probed when a catalog declares an array item as an
 * OPAQUE `{ type: "object" }` with no properties (Table.rows and
 * MetadataList.items today). The catalog does not say what a record holds, so
 * the guard cannot demand every field be shown — it populates the keys the
 * catalogs' own descriptions name ("each { cells: string[] }", "each
 * { label, value }") and asserts the prop is not wholly ignored.
 */
const OPAQUE_RECORD_KEYS = ["cells", "label", "value", "text"] as const;

/* --------------------------------------------------------------- schema */

function deref(catalog: Catalog, node: any): any {
  if (node && typeof node.$ref === "string" && node.$ref.startsWith("#/")) {
    let target: any = catalog;
    for (const seg of node.$ref.replace(/^#\//, "").split("/")) target = target?.[seg];
    return target;
  }
  return node;
}

function refName(node: any): string | undefined {
  return typeof node?.$ref === "string" ? node.$ref.split("/").pop() : undefined;
}

/** Flattened properties + required names for one component (allOf/$ref resolved). */
function componentSchema(catalog: Catalog, name: string): { props: Record<string, any>; required: string[] } {
  const props: Record<string, any> = {};
  const required = new Set<string>();
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.$ref === "string") walk(deref(catalog, node));
    if (Array.isArray(node.allOf)) node.allOf.forEach(walk);
    if (node.properties) Object.assign(props, node.properties);
    if (Array.isArray(node.required)) node.required.forEach((r: string) => required.add(r));
  };
  walk(catalog.components[name]);
  required.delete("component");
  required.delete("id");
  return { props, required: [...required] };
}

/* ------------------------------------------------------------- sentinels */

interface Sentinel {
  value: unknown;
  /** Strings that must be observable in the markup. */
  strings: string[];
  /** Opaque records: the prop must show at least one, not all. */
  anyOf: boolean;
}

/**
 * Build a sentinel value from a prop's SCHEMA — never from a guess about the
 * renderer. Unhandled shapes throw rather than pass: a required prop the
 * guard cannot reason about must fail loudly and be given a rule (or an
 * allowlist entry with a reason), not slip through as a silent success.
 */
function sentinelFor(catalog: Catalog, schema: any, path: string): Sentinel {
  const ref = refName(schema);
  if (ref === "ComponentId") {
    const id = `sentinel-${path}`;
    return { value: id, strings: [id], anyOf: false };
  }
  if (ref === "ChildList") {
    const ids = [`sentinel-${path}-0`, `sentinel-${path}-1`];
    return { value: ids, strings: ids, anyOf: false };
  }
  const node = ref ? deref(catalog, schema) : schema;
  // DynamicString is `string | binding | functionCall`; the plain-string
  // branch is what an emitted literal uses.
  if (Array.isArray(node?.oneOf) && node.oneOf.some((b: any) => b.type === "string")) {
    const s = `SENTINEL~${path}`;
    return { value: s, strings: [s], anyOf: false };
  }
  if (Array.isArray(node?.enum)) {
    throw new Error(`required enum prop '${path}' cannot carry a sentinel — give it a rule or an allowlist entry`);
  }
  if (node?.type === "string") {
    const s = `SENTINEL~${path}`;
    return { value: s, strings: [s], anyOf: false };
  }
  if (node?.type === "number" || node?.type === "integer") {
    return { value: 424242, strings: ["424242"], anyOf: false };
  }
  if (node?.type === "array") {
    const items = node.items ?? {};
    const built = [0, 1].map((i) => sentinelFor(catalog, items, `${path}.${i}`));
    return {
      value: built.map((b) => b.value),
      strings: built.flatMap((b) => b.strings),
      anyOf: built.some((b) => b.anyOf),
    };
  }
  if (node?.type === "object") {
    const declared = Object.entries(node.properties ?? {});
    if (declared.length > 0) {
      const value: Record<string, unknown> = {};
      const strings: string[] = [];
      let anyOf = false;
      for (const [key, sub] of declared) {
        const built = sentinelFor(catalog, sub, `${path}.${key}`);
        value[key] = built.value;
        strings.push(...built.strings);
        anyOf ||= built.anyOf;
      }
      return { value, strings, anyOf };
    }
    // Opaque record: probe the documented content keys, demand at least one.
    const value: Record<string, unknown> = {};
    const strings: string[] = [];
    for (const key of OPAQUE_RECORD_KEYS) {
      const s = `SENTINEL~${path}.${key}`;
      value[key] = key === "cells" ? [s] : s;
      strings.push(s);
    }
    return { value, strings, anyOf: true };
  }
  throw new Error(`no sentinel rule for required prop '${path}' (schema ${JSON.stringify(schema).slice(0, 120)})`);
}

/* ---------------------------------------------------------------- render */

/** Marker child: a built slot renders its ComponentId verbatim, so a dropped
 *  slot is a dropped sentinel like any other. */
const buildChild = (id: string): ReactNode => createElement("i", { key: id }, `[child:${id}]`);

function render(registry: Registry, name: string, props: Record<string, unknown>): string {
  const Visual = (registry.custom as Record<string, any>)[name];
  return renderToStaticMarkup(
    createElement(Visual, {
      props,
      buildChild,
      context: { componentModel: { id: "node" }, dataContext: { path: "/" } },
    }),
  );
}

/** The instance a component's required props alone produce, plus what must show. */
function requiredInstance(catalog: Catalog, name: string) {
  const { props: schemas, required } = componentSchema(catalog, name);
  const props: Record<string, unknown> = {};
  const expect: Array<{ prop: string; strings: string[]; anyOf: boolean }> = [];
  for (const prop of required) {
    if (prop in STRUCTURAL_PROPS) {
      props[prop] = () => {};
      continue;
    }
    const built = sentinelFor(catalog, schemas[prop], prop);
    props[prop] = built.value;
    expect.push({ prop, strings: built.strings, anyOf: built.anyOf });
  }
  return { props, expect };
}

/** Every required prop of `name` that this registry's visual fails to show. */
function ignoredRequiredProps(catalog: Catalog, registry: Registry, name: string): string[] {
  const { props, expect: expected } = requiredInstance(catalog, name);
  const html = render(registry, name, props);
  const out: string[] = [];
  for (const { prop, strings, anyOf } of expected) {
    const seen = strings.filter((s) => html.includes(s));
    if (anyOf ? seen.length === 0 : seen.length !== strings.length) {
      const missing = strings.filter((s) => !html.includes(s));
      out.push(`${name}.${prop} ignored (no sentinel in output: ${JSON.stringify(missing)})`);
    }
  }
  return out;
}

/** Catalog names this design system draws natively (wireframe fallback excluded:
 *  the universal visual consumes anything, so it cannot witness this property). */
function nativeNames(catalog: Catalog, registry: Registry): string[] {
  return Object.keys(catalog.components).filter((n) => Boolean((registry.custom as Record<string, any>)[n]));
}

/* ----------------------------------------------------------------- suite */

describe("required catalog props are observably consumed by their native renderer", () => {
  for (const id of NATIVE_REGISTRIES) {
    it(`${id}: every required prop of every natively-drawn component reaches the output`, () => {
      const catalog = CATALOGS[id];
      const registry = nativeRegistryFor(id)!;
      const names = nativeNames(catalog, registry);
      // Guard on the guard: an empty or collapsed name set would pass vacuously.
      expect(names.length).toBeGreaterThanOrEqual(10);
      const ignored = names.flatMap((n) => ignoredRequiredProps(catalog, registry, n));
      expect(ignored).toEqual([]);
    });
  }

  it("the allowlist stays a short list of justified structural props", () => {
    // An entry here is a claim someone must defend, so make growing it visible.
    expect(Object.keys(STRUCTURAL_PROPS)).toEqual(["action"]);
    for (const reason of Object.values(STRUCTURAL_PROPS)) expect(reason.length).toBeGreaterThan(40);
  });

  it("rejects a visual that ignores a required prop, rather than passing it silently", () => {
    // The detector turned on a deliberately broken visual: without this, a
    // registry whose renderers all returned null would look perfect.
    const blind: Registry = { reuseBasic: new Set(), custom: { Badge: () => null } };
    expect(ignoredRequiredProps(CATALOGS.astryx, blind, "Badge")).toEqual([
      'Badge.label ignored (no sentinel in output: ["SENTINEL~label"])',
    ]);
    // ...and stays quiet on one that consumes it.
    expect(ignoredRequiredProps(CATALOGS.astryx, nativeRegistryFor("astryx")!, "Badge")).toEqual([]);
  });
});
