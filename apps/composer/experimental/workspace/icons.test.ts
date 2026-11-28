/**
 * Icon coverage: every component in the Astryx contract, and both structural kinds, resolve to a glyph of their
 * own; nothing in the vocabulary falls back to the placeholder.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { componentIcon, ICON_NAMES } from "./icon-names";

const contract = JSON.parse(readFileSync(join(__dirname, "../../astryx-project/astryx.dspack.json"), "utf8")) as { components: Record<string, unknown> };

describe("icons", () => {
  it("every contract component has its own glyph", () => {
    const missing = Object.keys(contract.components).filter((c) => componentIcon(c) === "unknown");
    expect(missing).toEqual([]);
  });

  it("structure, data and editing glyphs exist, and an unmapped component gets the placeholder", () => {
    for (const name of ["repeat", "condition", "bound", "typed", "private", "sends", "confirms", "add", "up", "down", "move-to", "remove", "undo", "redo", "more", "chevron", "check"]) expect(ICON_NAMES).toContain(name);
    expect(componentIcon("not-a-component")).toBe("unknown");
    expect(componentIcon(undefined)).toBe("unknown");
  });
});
