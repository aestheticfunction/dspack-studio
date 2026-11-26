# Astryx list semantics in Composer's List adapter

**Status:** for separate approval. This changes the default production renderer. Authorized by the owner after the independent M1 workspace review (finding on the Astryx list-item violation).

## The violation

Astryx's `List` renders `<ul role="list">` and expects its own `ListItem` children. The contract's `List` takes arbitrary children: for a comparison, option cards. Composer's adapter put those straight into the list. The list therefore held no list items, and axe reported `aria-required-children` (critical):

- on the plan comparison, where it was allowed by name in `e2e/composer-blocks-a11y.spec.ts` and recorded in `docs/blocks/ACCESSIBILITY.md` ("Outside the blocks");
- on hotel results, where the M1 Library spec allowed it on `.astryx-list` nodes.

## The change

`packages/astryx-renderers/src/components/ListRender.tsx` gives each child its own `<li>`, with no marker, margin or padding (`list-style: none; margin: 0; padding: 0; min-width: 0`).

- **Layout.** Astryx's list is a flex column with a density gap, which now applies to the items exactly as it did to the children.
- **Unchanged:** Astryx; the contract and its digest; the goldens; the default Catalog export; every other renderer.
- **No nesting.** No component in the catalog renders a list item of its own, so there is none nested or duplicated (checked below).

## Evidence

| What | Result |
|---|---|
| Unit, failing first (`apps/composer/app/astryx-renderers-a11y.test.ts`, "List") | Two of three failed on `main` ([failing-first.txt](failing-first.txt)). The third, an empty list with no items, guards that none is invented. All pass with the change |
| Browser, before and after ([verify_list.cjs](verify_list.cjs), [list-before.json](list-before.json), [list-after.json](list-after.json)) | **Plan comparison** in Preview, default build, and **hotel results** on Composer's canvas (the R1a fidelity page) |
| axe (WCAG 2.2 A and AA) | Before: `aria-required-children` on both. After: no violation on either |
| List contents | Before: the list held spans. After: one `li` per option, no nested list items |
| Accessibility tree | Before: `list` holding checkboxes, terms and definitions directly. After: `list`, then one `listitem` per option holding the same checkbox, terms and definitions. Accessible names unchanged |
| Keyboard | Tab reaches "Basic" then "Pro", before and after |
| Layout | Every option card's position and size identical. The before and after screenshots are pixel-identical: [plan before](plan-comparison-before.png), [plan after](plan-comparison-after.png), [hotel before](hotel-results-before.png), [hotel after](hotel-results-after.png) |
| The named exception | Removed from `e2e/composer-blocks-a11y.spec.ts` after the above. That spec runs axe on every Astryx reference surface at every size: 21 of 21 pass with no exception |
| Default build | Smoke suite 49 of 49; the default artifact check is clean |

**The Library spec's exception.** The `.astryx-list` exception in `e2e/composer-library.spec.ts` lives on the Library branch (#127), which is not on `main`. It is removed there once this change is on `main`. Merge this PR before #127.
