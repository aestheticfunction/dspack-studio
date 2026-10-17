# Accessibility on the Astryx beta path

**Phase 2, step 6** ([PHASE-2-RELEASE-PLAN.md](PHASE-2-RELEASE-PLAN.md), §10), authorized by the owner on 2026-10-16 ([PHASE-2-DECISION-RECORD.md](PHASE-2-DECISION-RECORD.md), "Step 6, authorized"). The target is WCAG 2.2 AA. This page records what the automated checks prove, what was fixed, what this environment could and could not check by hand, and what still needs a person.

It covers the three approved blocks (records-table, auth-form and guide-steps) as Composer renders them natively in Astryx, in the Build canvas and in Preview, and the parts of the Build page a reader uses with them. A host's own renderer is the host's ([HOST-ACTIONS.md](HOST-ACTIONS.md)). shadcn/ui v3 blocks are withheld from the beta, so their scans are information only (below).

## What the automated checks prove

`e2e/composer-blocks-a11y.spec.ts` runs in the experimental Playwright config, in CI. It builds each block on Astryx through the hosted path with a stubbed gateway, so no model is called, from four calls per block:
- the approved example;
- the smallest valid call;
- every optional prop at its maximum length and count;
- the same, with every string one unbroken token (a URL, an id).

For each of the 12 surfaces it checks:

| Check | WCAG 2.2 | How |
|---|---|---|
| axe at 1280, 640 and 320 px, and with a dark preference, over the whole canvas | A and AA, through the tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` and `wcag22aa` (target size included) | Contrast that axe leaves undecided (scrolled or overlapping content, a decorative separator) is decided from computed colors, by the same thresholds |
| The title is the surface's one heading, at level 2 | 1.3.1, 2.4.6 | The accessibility tree |
| Each table's scrollable region is named by its columns | 2.4.6, 4.1.2 | The accessibility tree |
| Tab and Shift+Tab reach every control in order, by name, and leave the surface at both ends | 2.1.1, 2.1.2, 2.4.3 | Key presses |
| Every focused control shows an indicator of its own, of 3:1 or more against what it touches | 1.4.11, 2.4.7 | Computed styles at each stop, never the browser's default ring |
| No focused control is entirely hidden, at 1280, 640 and 320 px | 2.4.11 | Hit-testing at each stop |
| Targets are 24 by 24 px or larger, and pressing a field's edge focuses its input | 2.5.8 | Bounding boxes and clicks |
| Text spacing cuts nothing off and pushes nothing out | 1.4.12 | WCAG's test values |
| At 640 px (200% zoom) and 320 px, nothing scrolls sideways or is cut off; a data table may scroll inside its own focusable region | 1.4.4, 1.4.10 | Layout measurement |

A further spec checks an accepted block in Preview: its heading, axe, and Astryx's focus ring. Every check is soft, so one run reports every defect.

`apps/composer/app/astryx-renderers-a11y.test.ts` server-renders the Astryx renderers: heading elements, table names, header and badge wrapping, long-word wrapping and the column floor.

## What changed

Run against main first, the e2e failed all 13 Astryx specs, and the renderer tests failed 8 of 10; a column-floor test and the dark pass were then added, and failed before their fixes. Each defect and its fix:

| Defect on main | WCAG 2.2 | Fix | Where |
|---|---|---|---|
| Block titles were `<p>`, so no surface had a heading | 1.3.1, 2.4.6 | Heading variants render h1 to h3; a container heading keeps `role="heading"` on its own text | `packages/astryx-renderers/src/components/TextRender.tsx` |
| Every table region was named "Table" | 2.4.6, 4.1.2 | Each region is named by its columns | `TableRender.tsx` |
| Header text was cut off with an ellipsis at 320 px | 1.4.4, 1.4.10 | Header text wraps | `TableRender.tsx` |
| An 8-column table crushed its columns below a letter's width at 320 px, cutting text off | 1.4.10 | A 96 px column floor, through Astryx's `proportional()` widths, so the table scrolls inside its focusable region | `TableRender.tsx` |
| Long words and labels ran out of the card (titles, intros, a guide's facts) | 1.4.10 | A word breaks when it must; a badge's label wraps | `TextRender.tsx`, `BadgeRender.tsx` |
| The auth form's inputs held the surface 24 px past a 320 px viewport | 1.4.10 | A surface narrows with the canvas | `apps/composer/app/globals.css`, Astryx canvas only |
| The studio's green focus ring was 2.41:1 against the canvas white | 1.4.11 | Astryx's own indicators (#0064E0, 5.4:1), and the same ring on the table region, which had none | `globals.css` |
| With a dark OS preference, Astryx's dark tokens drew inside the white canvas, where its primary button is 3.11:1 | 1.4.3 | The Astryx canvas draws light | `globals.css` |
| Shift+Tab left focused fields, buttons and short table regions entirely under the sticky header at 640 and 320 px | 2.4.11 | The root's scroll padding follows the header's measured height | `apps/composer/app/composer.tsx` |
| The Build options made the page 11 px too wide at 320 px | 1.4.10 | Each option wraps under its label | `apps/composer/app/views/build-view.tsx` |

All of these ship in the default build too: every Astryx surface in Preview gains them, and the shared renderer fixes reach the Studio exhibit, whose suite passes. None changes a block signature, a template, a prompt, model selection, a request or any evaluation evidence.

## What this environment could and could not check by hand

- **No screen reader.** This environment has no NVDA, JAWS, VoiceOver or Orca, and Chromium is its only browser. No screen-reader pass was done, and none is claimed.
- **The accessibility tree, as Chromium exposes it.** This is what a screen reader receives from Chrome, not what it announces. For each block's example:
  - records-table: the level-2 heading "Open support tickets"; the focusable group "Table: Ticket, Subject, Status, Priority", holding a table with its column headers; the button "Refresh".
  - auth-form: the level-2 heading "Create your account"; the textboxes "Full name Required", "Email address Required" and "Password Required", each marked required; the buttons "Create account" and "Continue with GitHub".
  - guide-steps: the level-2 heading "Weeknight pasta"; the groups "Table: Ingredients" and "Table: Step, Instruction"; the buttons "Start" and "Save guide".
- **Keyboard,** in Chromium only, by the test runner's key events rather than a person. A screenshot of each focused control was inspected: buttons show Astryx's 2 px blue ring, fields their blue border, and table regions an inset blue ring.

## Still needs a person

1. A screen-reader pass per block: NVDA with Firefox or Chrome on Windows, and VoiceOver with Safari on macOS and iOS. Listen for the heading, the table regions' names, table navigation, each field's name and required state, and the buttons.
2. A keyboard pass in Firefox and Safari. Safari reaches buttons with Tab only when its "Press Tab to highlight each item" setting is on.
3. Real browser zoom at 200% and 400%, and text spacing with a bookmarklet, in more than one browser.
4. Windows forced colors (high contrast): that focus indicators and field boundaries survive.
5. Touch: target size, and scrolling a wide table's region, on a phone.
6. Input purpose by hand (SC 1.3.5): it fails today, under the exception in [BETA.md](BETA.md), and a host's mitigation must be checked in that host.
7. The judgements in "Proposed waivers".

## Proposed waivers

For the owner to accept or reject:
1. **auth-form input purpose (SC 1.3.5).** The recorded exception with its host mitigation, in [BETA.md](BETA.md). GA stays blocked on it (decision 4).
2. **Field boundaries (SC 1.4.11).** Astryx 0.1.4 draws a field's resting border in `#CCD3DB`, 1.5:1 against white. Each field has a visible label above it, and focus turns the border to the accent (5.4:1). Whether the resting border must reach 3:1 is a judgement. The preview renders the design system as it is, and a host owns its theme. The alternative is a Composer override of the border color inside the Astryx canvas.
3. **Generic action names (SC 2.4.6).** "Start" and "Save guide" are template text, and templates do not change in this step (the plan's §10).
4. **shadcn/ui v3 findings.** Not fixed, since shadcn/ui v3 is withheld from the beta (below).

## shadcn/ui v3 scans (information only)

The same spec scans each shadcn/ui v3 block's example and maximum call, records the result and never fails:

| Block | axe at 1280 and 320 px | At 320 px |
|---|---|---|
| records-table | none | the page is 50 px too wide on the example and 535 px on the maximum call: the table does not narrow |
| auth-form | color-contrast, 3 nodes | fits |
| guide-steps | color-contrast, 3 nodes | fits |

The contrast nodes are the wireframe fallback's Separator chips (1.19:1 and 1.26:1): shadcn/ui has no Separator renderer (the plan's §10). Narrowing the surface, as the Astryx canvas now does, would move shadcn's wide table into its own table container, which is not keyboard-focusable. That renderer fix is deferred.

## Re-running

```
pnpm --filter composer build:experimental
pnpm exec playwright test --config playwright.composer-experimental.config.ts e2e/composer-blocks-a11y.spec.ts
pnpm --filter composer test
```
