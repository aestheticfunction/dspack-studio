/**
 * R0 decision 16: a renderer receives a binder setter only for a property
 * that is bound to the data model, so an unbound input keeps its own value.
 */
import { describe, expect, it } from "vitest";
import { onlyBoundSetters } from "./buildCatalog";

const noop = () => undefined;

describe("onlyBoundSetters", () => {
  it("keeps the setter of a property bound with a path (A2UI 0.9) or @path (A2UI 1.0)", () => {
    const props = { value: "a", setValue: noop, label: "Name" };
    expect(onlyBoundSetters(props, { value: { path: "/input/name" } })).toBe(props);
    expect(onlyBoundSetters(props, { value: { "@path": "/input/name" } })).toBe(props);
  });

  it("drops the setter of a literal or missing property, and nothing else", () => {
    const props = { value: "a", setValue: noop, label: "Name", setLabel: noop };
    expect(onlyBoundSetters(props, { value: "a", label: "Name" })).toEqual({ value: "a", label: "Name" });
    expect(onlyBoundSetters(props, {})).toEqual({ value: "a", label: "Name" });
    expect(onlyBoundSetters(props, undefined)).toEqual({ value: "a", label: "Name" });
    expect(props).toHaveProperty("setValue"); // the binder's object is never mutated
  });

  it("treats a function call or a plain object as unbound: neither is a writable path", () => {
    const props = { value: "a", setValue: noop };
    expect(onlyBoundSetters(props, { value: { call: "formatDate", args: {} } })).not.toHaveProperty("setValue");
    expect(onlyBoundSetters(props, { value: { text: "x" } })).not.toHaveProperty("setValue");
  });

  it("leaves non-function and non-setter keys alone", () => {
    const props = { settings: { a: 1 }, setup: "x", setValue: "not a function" };
    expect(onlyBoundSetters(props, {})).toBe(props);
  });
});
