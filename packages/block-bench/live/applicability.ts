/**
 * Whether each refinement template can apply to every prompt and design system it is used on: a static audit, made
 * from the corpus text and the references' generation views alone, never from a model's output, so it reads every arm
 * the same way (ADR-B3 amendment 2, docs/blocks/ADR-B3-AMENDMENT-2.md).
 *
 * Two rules, each objective:
 *
 * - Target: a template that acts on something specific must find it. A remove needs the thing it removes in the
 *   prompt; an add of a named thing must not find it there already; a row with named values needs the columns that
 *   hold them. What a template needs is written down below, per template, from its exact text: a template the audit
 *   has not read is an issue until it is added, so an edit cannot slip past it.
 * - Element: a UI element a template names must have a component in the generation view of every reference the
 *   template is used on: the casualty-free vocabulary every arm generates against. A casualty is unavailable even where
 *   the contract defines it (shadcn-v3's accordion), and so is an element no component renders (a timer, a photo, a
 *   column layout).
 *
 * The add and remove templates matter most once the operation check is binding (metrics.ts, scoreRecords): a template
 * that cannot apply would fail a correct no-op.
 */
import type { Corpus, CorpusPrompt } from "./corpus";
import type { RefinementKind } from "./types";

export interface ApplicabilityIssue {
  /** The template set: a block id, or "null". */
  block: string;
  kind: RefinementKind;
  rule: "unaudited" | "target" | "element";
  /** For a target issue: the prompt the template cannot apply to. */
  prompt?: string;
  /** For an element issue: the reference whose generation view lacks it. */
  reference?: string;
  detail: string;
}

/** What the audit reads of a reference: every component and sub-component generation may emit there. */
export interface VocabularyView {
  id: string;
  components: ReadonlySet<string>;
}

/**
 * The UI elements a template may name, and the components that render each (any one is enough). An element no
 * component renders lists none. Matching is by whole words, so "table" is never "tab" and "every column" is no layout.
 */
export const ELEMENTS: ReadonlyArray<{ element: string; pattern: RegExp; components: readonly string[] }> = [
  { element: "accordion", pattern: /\baccordions?\b/i, components: ["accordion"] },
  { element: "tabs", pattern: /\btabs?\b/i, components: ["tabs"] },
  { element: "checkbox", pattern: /\bcheck-?box(es)?\b/i, components: ["checkbox"] },
  { element: "progress indicator", pattern: /\bprogress (indicator|bar)s?\b/i, components: ["progress"] },
  // No component counts time.
  { element: "timer", pattern: /\btimers?\b/i, components: [] },
  // No component renders an arbitrary image: shadcn-v3's avatar stands in for an identity only, by its own contract.
  { element: "photo", pattern: /\b(photo|image|picture)s?\b/i, components: [] },
  // No component lays content out in columns.
  { element: "column layout", pattern: /\b(two|three|multi)[- ]column\b|\bcolumn layout\b/i, components: [] },
  // shadcn-v3's sheet is a panel at the side of the screen.
  { element: "sidebar", pattern: /\bsidebars?\b/i, components: ["sheet"] },
  { element: "tooltip", pattern: /\btooltips?\b/i, components: ["tooltip"] },
  { element: "breadcrumb", pattern: /\bbreadcrumbs?\b/i, components: ["breadcrumb"] },
  { element: "pagination", pattern: /\bpaginat(e|ed|ion)\b/i, components: ["pagination"] },
  { element: "dropdown", pattern: /\bdrop-?downs?\b/i, components: ["dropdown-menu", "select"] },
  { element: "card", pattern: /\bcards?\b/i, components: ["card"] },
  { element: "badge", pattern: /\bbadges?\b/i, components: ["badge"] },
  { element: "button", pattern: /\bbuttons?\b/i, components: ["button"] },
  { element: "table", pattern: /\btables?\b/i, components: ["table"] },
  { element: "dialog", pattern: /\bdialogs?\b/i, components: ["dialog", "alert-dialog"] },
  { element: "text field", pattern: /\b(search|text|comment|notes?) fields?\b|\bcomments? section\b/i, components: ["input", "textarea", "text-input"] },
  { element: "filter bar", pattern: /\bfilter bars?\b/i, components: ["select", "button", "badge"] },
];

const PROVIDERS = ["google", "github", "microsoft", "apple"] as const;
/** The sign-in providers a prompt names (the auth-form block's provider vocabulary). */
export const providersIn = (prompt: CorpusPrompt): string[] => PROVIDERS.filter((provider) => new RegExp(`\\b${provider}\\b`, "i").test(prompt.goal));
/** A table of tickets: the only kind whose rows have a ticket's number, subject, status and priority. */
const ticketTable = (prompt: CorpusPrompt): boolean => /\btickets?\b/i.test(prompt.goal);

type Needs = (prompt: CorpusPrompt) => string | undefined;
const always: Needs = () => undefined;

/**
 * Every template the audit has read, by its exact instruction, with what it needs from a prompt (undefined: it applies
 * to every prompt of its block). Corpus v1's templates come first; v2's changes follow.
 */
export const AUDITED_TEMPLATES: Readonly<Record<string, Needs>> = {
  // v1: records-table
  'Change the title to "Open items" and the caption to "Oldest first".': always,
  'Add one more row at the end for item #9001, subject "Password reset loop", status Open, priority P2.': (p) =>
    ticketTable(p) ? undefined : "names a ticket's values (#9001, subject, status Open, priority P2), which only a table of tickets has columns for",
  "Remove the last row.": always,
  "Split the table into two tabs, Open and Closed, with a search field and a filter bar above them.": (p) =>
    ticketTable(p) ? undefined : "splits the rows by a ticket's status (Open, Closed), which only a table of tickets has",
  // v1: auth-form
  'Change the title to "Welcome back" and the intro to "Good to see you again."': always,
  "Add Microsoft as a sign-in provider.": (p) => (providersIn(p).includes("microsoft") ? "adds Microsoft, which the form already offers" : undefined),
  "Remove the provider buttons.": (p) => (providersIn(p).length > 0 ? undefined : "removes provider buttons the form does not have"),
  "Turn it into a two-step wizard with a progress indicator and a terms-of-service checkbox on the second step.": always,
  // v1: guide-steps
  'Change the title to "Before you start" and the summary to "About twenty minutes, no special tools."': always,
  'Add a final step: "Check everything once more before you finish."': always,
  "Remove the last step.": always,
  "Turn the steps into an accordion with a timer and a photo for each step, and a comments section below.": always,
  // v1: null
  "Make the title clearer.": always,
  "Add one more item.": always,
  "Remove the last item.": always,
  "Turn it into a two-column layout with a sidebar of related links.": always,
  // v2: C1, C2, C3
  "Add one more row at the end, with a plausible value in every column.": always,
  // Every auth-form prompt has a field, and the first is never the password the block keeps for sign-in and sign-up.
  "Remove the sign-in provider buttons; if there are none, remove the first field.": always,
  "Show each step as its own card with a numbered badge, and add a comments section with a text field and a Post button below the steps.": always,
  // v2: the same rules' other findings, outside the three named corrections
  "Add Microsoft as a sign-in provider; if it is there already, add Apple.": (p) =>
    providersIn(p).includes("microsoft") && providersIn(p).includes("apple") ? "offers Microsoft and Apple already, so neither can be added" : undefined,
  "Split the rows into two tables, each in its own card with a heading, and add a search field and a filter button above them.": always,
  'Turn it into a two-step wizard of two cards, each with a step badge ("Step 1 of 2", "Step 2 of 2"), and a terms-of-service notice with an "I agree" button on the second card.': always,
  "Move the main content into a card, and add a second card below it with three related links as buttons.": always,
};

/** Which references a template set is used on: those its prompts apply to. */
function referencesOf(corpus: Corpus, block: string): Set<string> {
  const out = new Set<string>();
  for (const prompt of corpus.prompts) if ((prompt.block ?? "null") === block) for (const reference of Object.keys(prompt.intent)) out.add(reference);
  return out;
}

/** Every template that cannot apply somewhere, by the two rules above. Empty means every template applies everywhere. */
export function applicabilityIssues(corpus: Corpus, references: readonly VocabularyView[]): ApplicabilityIssue[] {
  const issues: ApplicabilityIssue[] = [];
  for (const [block, set] of Object.entries(corpus.refinements)) {
    const prompts = corpus.prompts.filter((p) => (p.block ?? "null") === block);
    const used = referencesOf(corpus, block);
    for (const kind of ["content", "add", "remove", "structural"] as const) {
      const instruction = set[kind]?.instruction;
      if (instruction === undefined) continue;
      const needs = AUDITED_TEMPLATES[instruction];
      if (!needs) {
        issues.push({ block, kind, rule: "unaudited", detail: `the audit has not read this template: ${JSON.stringify(instruction)}` });
        continue;
      }
      for (const prompt of prompts) {
        const detail = needs(prompt);
        if (detail) issues.push({ block, kind, rule: "target", prompt: prompt.id, detail });
      }
      for (const reference of references) {
        if (!used.has(reference.id)) continue;
        for (const { element, pattern, components } of ELEMENTS) {
          if (pattern.test(instruction) && !components.some((c) => reference.components.has(c))) {
            issues.push({ block, kind, rule: "element", reference: reference.id, detail: `names ${element}, which no component in ${reference.id}'s generation view renders` });
          }
        }
      }
    }
  }
  return issues;
}
