import { describe, expect, it } from "vitest";
import packaged from "../compositions/astryx.compositions.json";
import contractDoc from "../../astryx-project/astryx.dspack.json";
import { definitionDifferences, RULE_LEADS, SAMPLE_NAMES, VERSION_CHANGES } from "./presentation";

const find = (id: string, version: number) => packaged.compositions.find((c) => c.id === id && c.version === version)!;

describe("presentation labels (D0.1)", () => {
  it("each draft's summary of what changed accounts for exactly the definition's differences from v1", () => {
    for (const [key, { paths, summary }] of Object.entries(VERSION_CHANGES)) {
      const [id, v] = key.split("@");
      const draft = find(id!, Number(v));
      const approved = find(id!, 1);
      expect(draft.status).toBe("draft");
      expect(approved.status).toBe("approved");
      expect(definitionDifferences(approved, draft)).toEqual([...paths].sort());
      expect(summary.length).toBeGreaterThan(0);
    }
  });

  it("the hotel-results draft names the price note and the button label", () => {
    const { summary } = VERSION_CHANGES["hotel-results@2"]!;
    expect(summary.join(" ")).toContain("Prices are per night, before taxes.");
    expect(summary.join(" ")).toContain("“Change search”");
  });

  it("names exist for every example of the packaged approved versions, and leads only for rules the contract has", () => {
    for (const c of packaged.compositions.filter((c) => c.status === "approved"))
      for (const s of c.scenarios) expect(SAMPLE_NAMES[c.id]?.[s.id], `${c.id}/${s.id}`).toBeTruthy();
    const rules = ((contractDoc as { rules?: Array<{ id: string }> }).rules ?? []).map((r) => r.id);
    for (const id of Object.keys(RULE_LEADS)) expect(rules).toContain(id);
  });

  it("differences ignore version and status, and see added, removed and changed leaves", () => {
    expect(definitionDifferences({ version: 1, status: "approved", a: [1, 2], b: "x" }, { version: 2, status: "draft", a: [1], b: "y", c: true })).toEqual(["/a[1]", "/b", "/c"]);
  });
});
