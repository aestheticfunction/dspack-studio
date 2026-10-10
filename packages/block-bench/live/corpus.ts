/**
 * The frozen corpus (ADR-B3: corpora are frozen before any run and committed
 * with their expected labels). Loading validates it against the references:
 * every expected intent must exist in that reference's contract, a block's
 * expected intent must be one the block serves there, and every parity
 * component must be in the contract's vocabulary. A corpus error is a test
 * failure, never a silent skip at run time.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { BlockDefinition } from "@dspack-studio/composer-core/blocks";
import type { RefinementKind } from "./types";

type Json = Record<string, any>;

export interface RefinementTemplate {
  instruction: string;
  /** Text the refined surface must contain, when the change names one. */
  expectText?: string;
}

export interface CorpusPrompt {
  id: string;
  goal: string;
  /** The block this goal is an instance of, or null. */
  block: string | null;
  /** The governed intent per reference id; a reference the goal does not apply to is absent. */
  intent: Record<string, string>;
  parity: { labels: string[]; components?: string[] | Record<string, string[]> };
}

export interface Corpus {
  corpus: string;
  version: number;
  frozenAt: string;
  refinements: Record<string, Record<RefinementKind, RefinementTemplate>>;
  prompts: CorpusPrompt[];
}

export const CORPUS_PATH = fileURLToPath(new URL("./corpora/blocks.json", import.meta.url));

export function readCorpus(path = CORPUS_PATH): Corpus {
  return JSON.parse(readFileSync(path, "utf8")) as Corpus;
}

/** The prompts that apply to a reference, with that reference's expected intent. */
export function promptsFor(corpus: Corpus, referenceId: string): Array<CorpusPrompt & { expectedIntent: string }> {
  return corpus.prompts.filter((p) => typeof p.intent[referenceId] === "string").map((p) => ({ ...p, expectedIntent: p.intent[referenceId]! }));
}

export function parityComponents(prompt: CorpusPrompt, referenceId: string): string[] {
  const c = prompt.parity.components;
  if (!c) return [];
  return Array.isArray(c) ? c : (c[referenceId] ?? []);
}

export function refinementFor(corpus: Corpus, block: string | null, kind: RefinementKind): RefinementTemplate {
  const set = corpus.refinements[block ?? "null"] ?? corpus.refinements.null;
  if (!set) throw new Error(`corpus: no refinement templates for ${block ?? "null"}`);
  return set[kind];
}

/** What a reference offers the corpus check: its intents, components and the blocks that loaded. */
export interface ReferenceShape {
  id: string;
  intents: Set<string>;
  components: Set<string>;
  blocks: readonly BlockDefinition[];
}

/** Every corpus rule, as readable issues. Empty means the corpus is valid for these references. */
export function corpusIssues(corpus: Corpus, references: readonly ReferenceShape[], minimum = 20): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const p of corpus.prompts) {
    if (ids.has(p.id)) issues.push(`${p.id}: duplicate id`);
    ids.add(p.id);
    if (!p.goal.trim()) issues.push(`${p.id}: empty goal`);
    if (Object.keys(p.intent).length === 0) issues.push(`${p.id}: applies to no reference`);
    if (!Array.isArray(p.parity?.labels)) issues.push(`${p.id}: parity.labels missing`);
  }
  for (const ref of references) {
    const counts = new Map<string, number>();
    for (const p of promptsFor(corpus, ref.id)) {
      const key = p.block ?? "null";
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (!ref.intents.has(p.expectedIntent)) issues.push(`${p.id}: intent ${p.expectedIntent} is not in ${ref.id}`);
      if (p.block) {
        const block = ref.blocks.find((b) => b.id === p.block);
        if (!block) issues.push(`${p.id}: block ${p.block} is not loaded for ${ref.id}`);
        else if (!block.intents.includes(p.expectedIntent)) issues.push(`${p.id}: ${p.block} does not serve ${p.expectedIntent} on ${ref.id}`);
      }
      for (const c of parityComponents(p, ref.id)) if (!ref.components.has(c)) issues.push(`${p.id}: parity component ${c} is not in ${ref.id}`);
    }
    for (const block of ref.blocks) {
      const n = counts.get(block.id) ?? 0;
      if (n < minimum) issues.push(`${ref.id}: ${block.id} has ${n} prompts, fewer than ${minimum}`);
      if (!corpus.refinements[block.id]) issues.push(`${ref.id}: no refinement templates for ${block.id}`);
    }
    if ((counts.get("null") ?? 0) < minimum) issues.push(`${ref.id}: ${counts.get("null") ?? 0} null prompts, fewer than ${minimum}`);
  }
  for (const [block, set] of Object.entries(corpus.refinements)) {
    for (const kind of ["content", "add", "remove", "structural"] as const) {
      if (!set[kind]?.instruction?.trim()) issues.push(`refinements.${block}.${kind}: missing instruction`);
    }
  }
  return issues;
}
