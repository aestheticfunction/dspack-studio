# D1: the selectable card's name, drawn

**Owner decision D1** (R1A-REVIEW.md §10): the contract treats an option card's `label` as its visible name, and the renderer should draw it.

**Status:** implemented on its own branch, for separate approval. It changes the default production renderer.

## The gap

- **What the contract requires.** The Astryx contract requires every `selectable-card` to carry a `label`, and treats it as the option's name (`rule.option-carries-label`: how an alternative is "identified, compared, and announced").
- **What Astryx does with it.** Astryx's `SelectableCard` documents `label` as an accessibility label and renders it only as the `aria-label` of its visually hidden checkbox.
- **The result.** Every option card in Composer showed no name. That includes the contract's own plan comparison and, in R1a, every hotel card: 30 of 30 card labels were accessible-only.

## The change

Composer's adapter, `packages/astryx-renderers/src/components/SelectableCardRender.tsx`:

- **Visible name.** The label is drawn as the card's first line, in Astryx's own `large` semibold type, wrapping long words.
- **Announced once.** The drawn name is `aria-hidden`. The checkbox stays the one element that announces it, under the same text, so a screen reader hears the name once (WCAG 2.5.3, label in name).
- **Not a heading.** A card inside a list is an option, not a section, so the name has no heading role.
- **No duplicate name.** Where a `Text` among the card's descendants already shows the same text, nothing is added. A button that merely contains the name, such as "Choose Casa do Rio", does not count.

**Unchanged:**
- Astryx itself (`@astryxdesign/core` 0.1.4);
- the contract and its digest;
- the Phase 1B goldens and request hashes;
- the default Catalog export.

## Evidence

| What | Result |
|---|---|
| Unit, failing first (`apps/composer/app/astryx-renderers-a11y.test.ts`) | 5 tests: the name drawn first and still the checkbox's name; announced once, no heading; no second name when a child shows it, including nested, but not for a button that only contains it; nothing for an empty label, and it works without a context; long names wrap. All 5 failed on `main` ([failing-first.txt](failing-first.txt)) and pass with the change |
| The plan comparison in Composer's Preview, default build, before (production, which is `main`) and after (a local default build of this branch) | [browser.json](browser.json), [verify_d1.cjs](verify_d1.cjs). Before, each card's first visible text was "Price". After, it is the plan's name. The accessibility tree is **identical** before and after: `checkbox "Basic"`, `checkbox "Pro" [checked]`, each name exactly once. Tab reaches both checkboxes, with the same 2 px focus ring. No page errors |
| Screenshots | [before](plan-comparison-before.png), [after](plan-comparison-after.png) |
| Hotel results on both renderer stacks (upstream `@a2ui/react` 0.16.1, and Composer's canvas on 0.10) | [level-2-hotel.json](level-2-hotel.json): every control still sends what the data says, every input still behaves. Of 292 literals, 281 are now drawn as visible text, against 251 before. All 30 card names moved from accessible-only to visible; only the 11 placeholders remain attributes |
| Guarding suites | apps/composer 567 tests (the 5 new ones included, the catalog-export byte test unchanged); block-bench 292, unchanged; typecheck clean |

## Not changed, and known

- **A separate accessibility violation remains.** Axe reports `aria-required-children` on Astryx's `List` with option cards (its items have no list-item role). That violation is recorded for `ex.plan-comparison` in `docs/blocks/ACCESSIBILITY.md`. It is a separate renderer question, not touched here.
- **Sensitive-field masking** was not part of this change. It is required before real sensitive inputs are supported; see M1-WORKSPACE.md.
