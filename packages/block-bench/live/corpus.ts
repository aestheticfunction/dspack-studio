/**
 * The frozen corpus (ADR-B3: corpora are frozen before any run and committed
 * with their expected labels). Loading validates it against the references:
 * every expected intent must exist in that reference's contract, a block's
 * expected intent must be one the block serves there, and every parity
 * component must be in the contract's vocabulary. A corpus error is a test
 * failure, never a silent skip at run time.
 *
 * Frozen means pinned: each version's pin (corpora/frozen.json for v1,
 * corpora/frozen.v2.json for v2) holds the corpus's name, version, freeze date
 * and content digest. A test holds each version to its own pin and the CLI
 * refuses to run on anything else, so an edit cannot slip into a run; a
 * deliberate edit re-freezes it, changing the date and the digest together.
 *
 * Versions sit side by side and never replace each other. v1 is the corpus the
 * two smokes measured, kept byte for byte; v2 (ADR-B3 amendment 2) corrects the
 * refinement templates that cannot apply everywhere and makes the add and
 * remove check binding. A run names its version, and its manifest pins it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sha256Hex, type BlockDefinition } from "@dspack-studio/composer-core/blocks";
import type { OperationScoring, RefinementKind } from "./types";

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
  /** v2 on: how add and remove refinements are scored. Absent (v1): the operation check is reported beside the pass. */
  scoring?: { operation: "binding" };
  refinements: Record<string, Record<RefinementKind, RefinementTemplate>>;
  prompts: CorpusPrompt[];
}

/** The corpus versions the harness can run, oldest first. */
export const CORPUS_VERSIONS = [1, 2] as const;
export type CorpusVersion = (typeof CORPUS_VERSIONS)[number];
/** The version a run measures unless it names another. */
export const CURRENT_CORPUS_VERSION: CorpusVersion = 2;

const FILES: Record<CorpusVersion, { corpus: string; pin: string }> = {
  1: { corpus: "./corpora/blocks.json", pin: "./corpora/frozen.json" },
  2: { corpus: "./corpora/blocks.v2.json", pin: "./corpora/frozen.v2.json" },
};
export const isCorpusVersion = (version: unknown): version is CorpusVersion => (CORPUS_VERSIONS as readonly unknown[]).includes(version);
export const corpusPath = (version: CorpusVersion): string => fileURLToPath(new URL(FILES[version].corpus, import.meta.url));
export const frozenPinPath = (version: CorpusVersion): string => fileURLToPath(new URL(FILES[version].pin, import.meta.url));
/** The pin's path as the repository names it, for messages. */
export const frozenPinName = (version: CorpusVersion): string => `live/corpora/${FILES[version].pin.slice("./corpora/".length)}`;

export const CORPUS_PATH = corpusPath(CURRENT_CORPUS_VERSION);
export const FROZEN_PATH = frozenPinPath(CURRENT_CORPUS_VERSION);

export function readCorpus(path = CORPUS_PATH): Corpus {
  return JSON.parse(readFileSync(path, "utf8")) as Corpus;
}

export const readCorpusVersion = (version: CorpusVersion): Corpus => readCorpus(corpusPath(version));

/** How the corpus scores add and remove refinements: the scoring every summary of a run on it applies. */
export const scoringOf = (corpus: Corpus): OperationScoring => (corpus.scoring?.operation === "binding" ? "binding" : "beside");

/** The committed pin of the frozen corpus. */
export interface FrozenPin {
  corpus: string;
  version: number;
  frozenAt: string;
  sha256: string;
}

export const readFrozenPin = (path = FROZEN_PATH): FrozenPin => JSON.parse(readFileSync(path, "utf8")) as FrozenPin;

/** The corpus's content digest: the one the pin holds and every run manifest records. */
export const corpusDigest = (corpus: Corpus): Promise<string> => sha256Hex(JSON.stringify(corpus));

/** How the corpus differs from its pin, by default the pin of the version it claims; empty when it is that frozen corpus. */
export async function frozenMismatches(corpus: Corpus, pin: FrozenPin = readFrozenPin(frozenPinPath(isCorpusVersion(corpus.version) ? corpus.version : CURRENT_CORPUS_VERSION))): Promise<string[]> {
  const out: string[] = [];
  for (const key of ["corpus", "version", "frozenAt"] as const) {
    if (corpus[key] !== pin[key]) out.push(`${key}: the corpus says ${JSON.stringify(corpus[key])}, the pin ${JSON.stringify(pin[key])}`);
  }
  const digest = await corpusDigest(corpus);
  if (digest !== pin.sha256) out.push(`content: sha256 ${digest}, the pin holds ${pin.sha256}`);
  return out;
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
