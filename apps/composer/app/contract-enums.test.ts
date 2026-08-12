import { describe, expect, it } from "vitest";
import contract from "../shadcn-v3-project/shadcn-ui.dspack.json";
import { enumLabel, enumMembers, parseEnumValues } from "./contract-enums";

/**
 * dspack v0.4 allows an enum prop's `values` to be bare values OR value
 * descriptor objects (`{ value, description }`), and BOTH are spec-valid. The
 * shipped shadcn contract uses the rich form throughout — ten occurrences on
 * Button alone — so any reader that assumes strings prints "[object Object]"
 * at the user, and any AUTHORING path that writes strings makes the catalog
 * hold two shapes for the same idea.
 *
 * One reader, one writer, both pinned here. This mirrors dspack-gen's
 * `enumValues()` (the canonical unwrap) and keeps the description, which that
 * reader deliberately discards.
 */
describe("enumMembers — one reader for both spec-valid enum shapes", () => {
  it("reads the flat form: bare strings", () => {
    expect(enumMembers({ type: "enum", values: ["sm", "md", "lg"] })).toEqual([
      { value: "sm" },
      { value: "md" },
      { value: "lg" },
    ]);
  });

  it("reads the rich form and keeps each value's description", () => {
    expect(
      enumMembers({
        type: "enum",
        values: [
          { value: "default", description: "Standard button for primary page actions." },
          { value: "destructive", description: "For irreversible actions like delete." },
        ],
      }),
    ).toEqual([
      { value: "default", description: "Standard button for primary page actions." },
      { value: "destructive", description: "For irreversible actions like delete." },
    ]);
  });

  it("reads a mixed list, and non-string values, without stringifying an object", () => {
    const members = enumMembers({ type: "enum", values: ["plain", { value: "rich", description: "why" }, 3, true] });
    expect(members.map((m) => m.value)).toEqual(["plain", "rich", "3", "true"]);
    expect(members.some((m) => m.value.includes("[object"))).toBe(false);
  });

  it("is empty-safe: missing, empty, malformed, and non-enum props", () => {
    expect(enumMembers({ type: "enum" })).toEqual([]);
    expect(enumMembers({ type: "enum", values: [] })).toEqual([]);
    expect(enumMembers({ type: "string", values: ["a"] })).toEqual([]);
    expect(enumMembers({ type: "enum", values: "sm,md" })).toEqual([]);
    expect(enumMembers(undefined)).toEqual([]);
    expect(enumMembers(null)).toEqual([]);
    // A descriptor with no value is not a value — it is skipped, not rendered.
    expect(enumMembers({ type: "enum", values: [{ description: "orphan" }, { value: "kept" }] })).toEqual([{ value: "kept" }]);
  });

  it("reads the SHIPPED contract's Button props without producing [object Object]", () => {
    const props = (contract as unknown as Record<string, any>).components.button.props as Record<string, any>;
    const enums = Object.entries(props).filter(([, p]) => p.type === "enum");
    expect(enums.length).toBeGreaterThan(0);
    for (const [, p] of enums) {
      const members = enumMembers(p);
      expect(members.length).toBe(p.values.length);
      for (const m of members) {
        expect(m.value).not.toContain("[object");
        expect(typeof m.value).toBe("string");
      }
    }
    const variant = enumMembers(props.variant);
    expect(variant.map((m) => m.value)).toContain("destructive");
    expect(variant.find((m) => m.value === "destructive")?.description).toContain("irreversible");
  });

  it("the defect it replaces: `values.join(', ')` over the shipped contract prints [object Object]", () => {
    const values = (contract as unknown as Record<string, any>).components.button.props.variant.values as unknown[];
    // What component-view.tsx renders today, against the contract we ship.
    expect(values.join(", ")).toContain("[object Object]");
    expect(enumMembers({ type: "enum", values }).map((m) => m.value).join(", ")).not.toContain("[object Object]");
  });

  it("enumLabel reads one member of either shape", () => {
    expect(enumLabel("ghost")).toBe("ghost");
    expect(enumLabel({ value: "ghost", description: "Minimal" })).toBe("ghost");
    expect(enumLabel(7)).toBe("7");
  });
});

describe("parseEnumValues — authoring writes the shape the contract already uses", () => {
  it("writes value descriptors, not bare strings", () => {
    expect(parseEnumValues("sm, md , lg")).toEqual([{ value: "sm" }, { value: "md" }, { value: "lg" }]);
  });

  it("drops blanks and duplicates, so an authored enum is never malformed", () => {
    expect(parseEnumValues("sm,,md,  ,sm")).toEqual([{ value: "sm" }, { value: "md" }]);
    expect(parseEnumValues("   ")).toEqual([]);
    expect(parseEnumValues("")).toEqual([]);
  });

  it("round-trips through the reader — what is authored is what is displayed", () => {
    expect(enumMembers({ type: "enum", values: parseEnumValues("ghost, link") }).map((m) => m.value)).toEqual([
      "ghost",
      "link",
    ]);
  });
});
