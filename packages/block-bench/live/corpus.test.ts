import { describe, expect, it } from "vitest";
import { corpusIssues, frozenMismatches, promptsFor, readCorpus, readFrozenPin, refinementFor, type Corpus } from "./corpus";
import { REFERENCE_IDS, loadReference } from "./references";

describe("the corpus is the frozen one (ADR-B3: frozen before any run)", () => {
  it("matches its committed pin: name, version, freeze date and content digest", async () => {
    const pin = readFrozenPin();
    expect(pin).toMatchObject({ corpus: "blocks-1b", version: 1, frozenAt: "2026-10-10" });
    expect(pin.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await frozenMismatches(readCorpus())).toEqual([]);
  });

  it("catches any edit, however small: a goal, a label, a parity check, a deleted prompt, a refinement, a freeze date", async () => {
    const corpus = readCorpus();
    const edits: Array<(c: Corpus) => void> = [
      (c) => void (c.prompts.find((p) => p.id === "rt-05")!.goal += " today"),
      (c) => void (c.prompts.find((p) => p.id === "rt-21")!.block = null),
      (c) => void (c.prompts.find((p) => p.id === "af-05")!.parity.labels = []),
      (c) => void c.prompts.splice(c.prompts.findIndex((p) => p.id === "nb-02"), 1),
      (c) => void (c.refinements["records-table"]!.content.instruction = "Rename it."),
    ];
    for (const edit of edits) {
      const copy = structuredClone(corpus);
      edit(copy);
      expect(await frozenMismatches(copy)).toEqual([expect.stringMatching(/^content: /)]);
    }
    expect(await frozenMismatches({ ...corpus, frozenAt: "2026-12-01" })).toContainEqual(expect.stringMatching(/^frozenAt: /));
  });
});

describe("the frozen 1B corpus", () => {
  it("is valid for every packaged reference: at least 20 prompts per loaded block and 20 null prompts, every intent real, every block serving its expected intent, every parity component in the vocabulary", async () => {
    const corpus = readCorpus();
    const references = await Promise.all(REFERENCE_IDS.map((id) => loadReference(id)));
    for (const ref of references) expect(ref.binding, `${ref.id} sidecar binding`).toBe("ok");
    expect(corpusIssues(corpus, references.map((r) => r.shape))).toEqual([]);
  });

  it("applies per reference, and a reference the goal does not fit is left out", () => {
    const corpus = readCorpus();
    const shadcn = promptsFor(corpus, "shadcn-v3").map((p) => p.id);
    const astryx = promptsFor(corpus, "astryx").map((p) => p.id);
    expect(shadcn).toContain("nb-13");
    expect(astryx).not.toContain("nb-13");
    expect(astryx).toContain("nb-20");
    expect(shadcn).not.toContain("nb-20");
    expect(promptsFor(corpus, "astryx").find((p) => p.id === "af-01")?.expectedIntent).toBe("data-collection");
    expect(promptsFor(corpus, "shadcn-v3").find((p) => p.id === "af-01")?.expectedIntent).toBe("structured-input");
  });

  it("has a refinement template of every kind for every block and for null", () => {
    const corpus = readCorpus();
    for (const block of ["records-table", "auth-form", "guide-steps", null]) {
      for (const kind of ["content", "add", "remove", "structural"] as const) expect(refinementFor(corpus, block, kind).instruction.length).toBeGreaterThan(10);
    }
    expect(refinementFor(corpus, "auth-form", "content").expectText).toBe("Welcome back");
  });

  it("the validator names what is wrong (non-vacuity)", async () => {
    const corpus = readCorpus();
    const ref = await loadReference("astryx");
    const broken = { ...corpus, prompts: corpus.prompts.map((p) => (p.id === "rt-01" ? { ...p, intent: { ...p.intent, astryx: "no-such-intent" } } : p)) };
    expect(corpusIssues(broken, [ref.shape])).toContain("rt-01: intent no-such-intent is not in astryx");
    const wrongBlock = { ...corpus, prompts: corpus.prompts.map((p) => (p.id === "af-01" ? { ...p, intent: { ...p.intent, astryx: "record-collection" } } : p)) };
    expect(corpusIssues(wrongBlock, [ref.shape])).toContain("af-01: auth-form does not serve record-collection on astryx");
    expect(corpusIssues({ ...corpus, prompts: corpus.prompts.slice(0, 5) }, [ref.shape]).some((i) => /fewer than 20/.test(i))).toBe(true);
  });
});
