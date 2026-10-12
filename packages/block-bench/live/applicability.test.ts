/**
 * Every refinement template must be able to apply to every prompt and design system it is used on (ADR-B3 amendment 2):
 * a static audit of the corpus text against the references' generation views, read the same way for every arm.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { generationView, scriptedBlockScript } from "@dspack-studio/composer-core/blocks";
import { applicabilityIssues, type ApplicabilityIssue, type VocabularyView } from "./applicability";
import { readCorpusVersion, type Corpus } from "./corpus";
import { REFERENCE_IDS, loadReference, type LoadedReference } from "./references";

let references: LoadedReference[];
let views: VocabularyView[];
beforeAll(async () => {
  references = await Promise.all(REFERENCE_IDS.map((id) => loadReference(id)));
  views = references.map((r) => ({ id: r.id, components: generationView(r.contract, r.profile).components }));
}, 120_000);

/** Issues grouped as "block.kind rule: prompts or references", for readable expectations. */
function grouped(issues: ApplicabilityIssue[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = `${issue.block}.${issue.kind} ${issue.rule}${issue.rule === "element" ? ` ${issue.detail.replace(/^names (.+?), which.*$/, "$1")}` : ""}`;
    (out[key] ??= []).push(issue.prompt ?? issue.reference ?? "");
  }
  return out;
}

const range = (prefix: string, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `${prefix}-${String(from + i).padStart(2, "0")}`);
const WITHOUT_PROVIDERS = ["af-01", "af-02", "af-04", "af-05", "af-06", "af-07", "af-09", "af-10", "af-11", "af-13", "af-15", "af-16", "af-17", "af-19", "af-21"];

describe("the static audit of corpus v1's refinement templates", () => {
  it("finds the three defects the owner named, and every other template that cannot apply, by the same two rules", () => {
    expect(grouped(applicabilityIssues(readCorpusVersion(1), views))).toEqual({
      // C1: a ticket's values in a table of orders, inventory or members.
      "records-table.add target": range("rt", 2, 22),
      // C2: provider buttons the form does not have.
      "auth-form.remove target": WITHOUT_PROVIDERS,
      // C3: an accordion (a shadcn-v3 casualty, absent from Astryx), a timer and a photo, which no component renders.
      "guide-steps.structural element accordion": ["shadcn-v3", "astryx"],
      "guide-steps.structural element timer": ["shadcn-v3", "astryx"],
      "guide-steps.structural element photo": ["shadcn-v3", "astryx"],
      // The same rules, outside the owner's list.
      "auth-form.add target": ["af-12"],
      // A split into Open and Closed fits the tables whose items open and close: tickets, bugs (rt-07), incidents (rt-21).
      "records-table.structural target": range("rt", 2, 22).filter((id) => id !== "rt-07" && id !== "rt-21"),
      "records-table.structural element tabs": ["astryx"],
      "auth-form.structural element checkbox": ["astryx"],
      "auth-form.structural element progress indicator": ["astryx"],
      "null.structural element column layout": ["shadcn-v3", "astryx"],
      "null.structural element sidebar": ["astryx"],
    });
  });

  it("reads the generation view, not the contract: shadcn-v3 defines an accordion, but its profile makes it a casualty no arm may emit", () => {
    const shadcn = references.find((r) => r.id === "shadcn-v3")!;
    expect(Object.keys(shadcn.contract.components)).toContain("accordion");
    expect(views.find((v) => v.id === "shadcn-v3")!.components.has("accordion")).toBe(false);
  });
});

/** D1 to D3: the structural templates the same rules would also correct, left to the owner (ADR-B3 amendment 2). */
const EXTENSION: Record<string, string> = {
  "records-table": "Split the rows into two tables, each in its own card with a heading, and add a search field and a filter button above them.",
  "auth-form": 'Turn it into a two-step wizard of two cards, each with a step badge ("Step 1 of 2", "Step 2 of 2"), and a terms-of-service notice with an "I agree" button on the second card.',
  null: "Move the main content into a card, and add a second card below it with three related links as buttons.",
};
const withExtension = (corpus: Corpus): Corpus => {
  const out = structuredClone(corpus);
  for (const [block, instruction] of Object.entries(EXTENSION)) out.refinements[block]!.structural = { instruction };
  return out;
};

describe("corpus v2's refinement templates", () => {
  it("correct every add and remove template, so the binding check never fails a correct no-op, and the guide-steps structural one; the rest are v1's", () => {
    const issues = applicabilityIssues(readCorpusVersion(2), views);
    expect(issues.filter((i) => i.kind !== "structural")).toEqual([]);
    // Exactly v1's structural findings outside guide-steps: those D1 to D3 would correct, if the owner adopts them.
    expect(grouped(issues)).toEqual({
      "records-table.structural target": range("rt", 2, 22).filter((id) => id !== "rt-07" && id !== "rt-21"),
      "records-table.structural element tabs": ["astryx"],
      "auth-form.structural element checkbox": ["astryx"],
      "auth-form.structural element progress indicator": ["astryx"],
      "null.structural element column layout": ["shadcn-v3", "astryx"],
      "null.structural element sidebar": ["astryx"],
    });
  });

  it("with D1 to D3, if the owner adopts them, apply to every prompt and design system they are used on", () => {
    expect(applicabilityIssues(withExtension(readCorpusVersion(2)), views)).toEqual([]);
  });

  it("refuses a template the audit has not read, so an edit cannot slip past it", () => {
    const edited: Corpus = structuredClone(readCorpusVersion(2));
    edited.refinements["guide-steps"]!.add.instruction = "Add a step.";
    expect(applicabilityIssues(edited, views)).toContainEqual(expect.objectContaining({ block: "guide-steps", kind: "add", rule: "unaudited" }));
  });

  it("still sends the scripted block arm to its fallback on every add, remove and structural template, as on v1, D1 to D3 included", async () => {
    for (const version of [1, 2, "2 with D1 to D3"] as const) {
      const corpus = version === "2 with D1 to D3" ? withExtension(readCorpusVersion(2)) : readCorpusVersion(version);
      for (const block of ["records-table", "auth-form", "guide-steps"]) {
        const definition = references[0]!.blocks.find((b) => b.id === block)!;
        const example = definition.examples[0]!;
        for (const kind of ["add", "remove", "structural"] as const) {
          const instruction = corpus.refinements[block]![kind].instruction;
          const reply = await scriptedBlockScript(definition, example.intent, instruction, { priorGoal: "a goal", priorCall: example.call as Record<string, unknown> }).generate({} as never);
          expect(reply.json, `v${version} ${block}.${kind}`).toMatchObject({ unsupported: true });
        }
      }
    }
  });
});
