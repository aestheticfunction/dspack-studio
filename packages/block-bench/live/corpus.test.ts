import { describe, expect, it } from "vitest";
import { CURRENT_CORPUS_VERSION, corpusDigest, corpusIssues, frozenMismatches, frozenPinPath, promptsFor, readCorpus, readCorpusVersion, readFrozenPin, refinementFor, scoringOf, type Corpus } from "./corpus";
import { REFERENCE_IDS, loadReference } from "./references";

describe("the corpus is the frozen one (ADR-B3: frozen before any run)", () => {
  it("matches its committed pin: name, version, freeze date and content digest", async () => {
    const pin = readFrozenPin();
    expect(pin).toMatchObject({ corpus: "blocks-1b", version: 2, frozenAt: "2026-10-12" });
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

/** The templates amendment 2 corrects in v2, by template set and kind: C1 to C3, then the same rules' other findings. */
const AMENDED: Record<string, string[]> = { "records-table": ["add", "structural"], "auth-form": ["add", "remove", "structural"], "guide-steps": ["structural"], null: ["structural"] };
const KINDS = ["content", "add", "remove", "structural"] as const;

describe("corpus v1 is preserved and v2 is a separate, separately pinned version (ADR-B3 amendment 2)", () => {
  it("keeps v1 exactly as frozen: the same file, pin and digest every earlier run recorded", async () => {
    const v1 = readCorpusVersion(1);
    expect(v1).toMatchObject({ corpus: "blocks-1b", version: 1, frozenAt: "2026-10-10" });
    expect(await corpusDigest(v1)).toBe("180f4480284b720e22a279a1147d95c6ae1132ff1fdcc03d8cddb1235a5e4231");
    expect(readFrozenPin(frozenPinPath(1))).toEqual({ corpus: "blocks-1b", version: 1, frozenAt: "2026-10-10", sha256: "180f4480284b720e22a279a1147d95c6ae1132ff1fdcc03d8cddb1235a5e4231" });
    expect(await frozenMismatches(v1)).toEqual([]);
  });

  it("pins v2 under its own version, freeze date and digest, which differs from v1's", async () => {
    const v2 = readCorpusVersion(2);
    const pin = readFrozenPin(frozenPinPath(2));
    expect(pin).toMatchObject({ corpus: "blocks-1b", version: 2, frozenAt: "2026-10-12" });
    expect(pin.sha256).toBe(await corpusDigest(v2));
    expect(pin.sha256).not.toBe(readFrozenPin(frozenPinPath(1)).sha256);
    expect(await frozenMismatches(v2)).toEqual([]);
  });

  it("holds each version to its own pin: v1 labelled as v2, or v2 labelled as v1, matches neither", async () => {
    const v1 = readCorpusVersion(1);
    const v2 = readCorpusVersion(2);
    expect(await frozenMismatches({ ...v1, version: 2 })).toContainEqual(expect.stringMatching(/^content: /));
    expect(await frozenMismatches({ ...v2, version: 1 })).toContainEqual(expect.stringMatching(/^content: /));
  });

  it("runs v2 unless told otherwise", () => {
    expect(CURRENT_CORPUS_VERSION).toBe(2);
    expect(readCorpus()).toEqual(readCorpusVersion(2));
  });

  it("differs from v1 only in its header and the amended templates: every prompt, label, checklist and other template is v1's", () => {
    const v1 = readCorpusVersion(1);
    const v2 = readCorpusVersion(2);
    expect(v2.prompts).toEqual(v1.prompts);
    expect(Object.keys(v2.refinements)).toEqual(Object.keys(v1.refinements));
    for (const [block, set] of Object.entries(v1.refinements)) {
      for (const kind of KINDS) {
        if (AMENDED[block]?.includes(kind)) expect(v2.refinements[block]![kind], `${block}.${kind}`).not.toEqual(set[kind]);
        else expect(v2.refinements[block]![kind], `${block}.${kind}`).toEqual(set[kind]);
      }
    }
    const { prompts: _p1, refinements: _r1, ...h1 } = v1 as Corpus & Record<string, unknown>;
    const { prompts: _p2, refinements: _r2, ...h2 } = v2 as Corpus & Record<string, unknown>;
    expect(h2).toEqual({ ...h1, version: 2, frozenAt: "2026-10-12", note: expect.any(String), scoring: { operation: "binding" } });
    expect(h2.note).not.toBe(h1.note);
  });

  it("declares its scoring: v1 reports the operation check beside the pass, v2 makes it binding", () => {
    expect(scoringOf(readCorpusVersion(1))).toBe("beside");
    expect(scoringOf(readCorpusVersion(2))).toBe("binding");
  });

  it("is valid for every packaged reference, as v1 is", async () => {
    const references = await Promise.all(REFERENCE_IDS.map((id) => loadReference(id)));
    expect(corpusIssues(readCorpusVersion(2), references.map((r) => r.shape))).toEqual([]);
  });
});
