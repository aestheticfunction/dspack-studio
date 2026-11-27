/**
 * The packaged Library: the same two compositions R1a verified, now as approved v1s, and one draft.
 * The v1 definitions must not drift from the ones the R1a evidence was produced from.
 */
import { describe, expect, it, vi } from "vitest";
import spike from "../../../../packages/composer-core/src/compositions/spike/astryx.compositions.json";
import packaged from "../compositions/astryx.compositions.json";
import { installedToolchain } from "../../lib/toolchain.mjs";
import { buildToolchain, loadLibrary } from "./runtime";

describe("the packaged Library", () => {
  it("the draft names its examples for people; the approved versions carry no change (D0)", () => {
    const draft = packaged.compositions.find((c) => c.id === "hotel-results" && c.version === 2)!;
    expect(draft.status).toBe("draft");
    const titles = (c: { scenarios: readonly object[] }) => c.scenarios.map((s) => (s as { title?: string }).title);
    expect(titles(draft)).toEqual(["Three hotels", "Two hotels", "One hotel", "No hotels found", "Confirm a reservation"]);
    for (const c of packaged.compositions.filter((c) => c.status === "approved")) expect(titles(c).every((t) => t === undefined)).toBe(true);
  });

  it("v1 of each composition is the R1a definition, marked approved", () => {
    for (const s of spike.compositions) {
      const v1 = packaged.compositions.find((c) => c.id === s.id && c.version === 1)!;
      expect({ ...v1, status: "draft" }).toEqual(s);
      expect(v1.status).toBe("approved");
    }
  });

  it("the hotel-results v2 draft differs from v1 only in wording and its examples' names", () => {
    const v1 = packaged.compositions.find((c) => c.id === "hotel-results" && c.version === 1)!;
    const v2 = packaged.compositions.find((c) => c.id === "hotel-results" && c.version === 2)!;
    const strip = (c: unknown) => JSON.stringify(c).replace(/ nights\. [^"]*"/, ' nights."').replace(/"(New|Change) search"/, '"search"');
    const unnamed = { ...v2, scenarios: v2.scenarios.map((sc) => { const { title: _title, ...rest } = sc as { title?: string }; return rest; }) };
    expect(strip({ ...unnamed, version: 1, status: "approved" })).toBe(strip(v1));
    expect(v2.status).toBe("draft");
  });

  it("loads with no issue: two compositions, three versions", async () => {
    const { library, issues } = await loadLibrary();
    expect(issues).toEqual([]);
    expect(library.entries.map((e) => [e.id, e.approved?.version ?? null, e.draft?.version ?? null])).toEqual([
      ["hotel-results", 1, 2],
      ["hotel-search", 1, null],
    ]);
  });

  it("the toolchain is read from the build and fails closed without it", () => {
    vi.stubEnv("NEXT_PUBLIC_COMPOSER_TOOLCHAIN", "");
    expect(() => buildToolchain()).toThrow(/toolchain/);
    vi.stubEnv("NEXT_PUBLIC_COMPOSER_TOOLCHAIN", JSON.stringify(installedToolchain()));
    expect(buildToolchain()).toEqual(installedToolchain());
  });
});
