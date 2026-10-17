# Accessibility on the Astryx beta path

**Phase 2, step 6** ([PHASE-2-RELEASE-PLAN.md](PHASE-2-RELEASE-PLAN.md), §10), authorized by the owner on 2026-10-16 ([PHASE-2-DECISION-RECORD.md](PHASE-2-DECISION-RECORD.md), "Step 6, authorized"). The target is WCAG 2.2 AA. This page records what the automated checks prove, what was fixed, what this environment could and could not check by hand, and what still needs a person.

It covers the three approved blocks (records-table, auth-form and guide-steps) as Composer renders them natively in Astryx, in the Build canvas and in Preview, and the parts of the Build page a reader uses with them. A host's own renderer is the host's ([HOST-ACTIONS.md](HOST-ACTIONS.md)). shadcn/ui v3 blocks are withheld from the beta, so their scans are information only (below).

## What the automated checks prove

`e2e/composer-blocks-a11y.spec.ts` runs in the experimental Playwright config, in CI. It builds each block on Astryx through the hosted path with a stubbed gateway, so no model is called, from four calls per block:
- the approved example;
- the smallest valid call;
- every optional prop at its maximum length and count;
- the same, with every string one unbroken token (a URL, an id).

The sizes are 1280 x 900, then 640 x 512 and 320 x 256 (200% and 400% zoom of a 1280 x 1024 window) and 320 x 720 (a tall phone). For each of the 12 surfaces it checks:

| Check | WCAG 2.2 | How |
|---|---|---|
| axe at every size, and with a dark preference, over the whole canvas | A and AA, through the tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` and `wcag22aa` (target size included) | Contrast that axe leaves undecided (scrolled content, a decorative separator) is decided from computed colors, at every size and in dark, by the same thresholds, compositing a translucent color over what lies beneath it. Text that another element in the canvas covers fails |
| The title is the surface's one heading, at level 2 | 1.3.1, 2.4.6 | The accessibility tree |
| Each table's scrollable region is named by its columns | 2.4.6 | The accessibility tree |
| Tab and Shift+Tab reach every control in order, by name, and leave the surface at both ends | 2.1.1, 2.1.2, 2.4.3 | Key presses |
| Every focused control shows an indicator of its own, of 3:1 or more against what it touches | 1.4.11, 2.4.7 | Computed styles at each stop, never the browser's default ring |
| In forced colors, at 1280 px, every focused control keeps an outline, which the system can draw | 2.4.7 | Chromium's forced-colors emulation |
| No focused control is entirely hidden, at every size | 2.4.11 | Hit-testing at each stop |
| Targets are 24 by 24 px or larger, and pressing a field's edge focuses its input | 2.5.8 | Bounding boxes and clicks |
| With text spacing, at every size, nothing is cut off, pushed outside the canvas, scrolled in a box or drawn over, line by line | 1.4.12 | WCAG's test values |
| At every size, nothing scrolls sideways or is cut off, no box but a table's region scrolls its own content, no line of text is drawn over or cut off, and no table column is narrower than 90 px. A data table may scroll inside its own focusable region | 1.4.4, 1.4.10 | Layout measurement. Each Astryx stack's children, through `display: contents` wrappers, must not overlap: their boxes must not intersect. Every line of text is scrolled into view and sampled across its width and height, with every element in the canvas hit-tested, even one that ignores the pointer. Another element drawn over the line, or a box that does not scroll cutting it off, fails |

Two further specs check Preview, which the canvas rules reach too. One checks an accepted block: its heading, axe and Astryx's focus ring at 1280 px, and at the narrow sizes the layout checks, text spacing, axe and the keyboard pass. The other checks every Astryx reference surface at every size: axe, the undecided contrast, the layout checks and text spacing. One violation outside the blocks that predates this step is allowed there by name ("Outside the blocks", below). A third imports two model-shaped surfaces the blocks never produce, and checks them the same way, with their headings:
- a standard, a fullscreen and an alert dialog with long labels;
- a children-mode table, Astryx's `large` type and display text with no words.

Every check is soft, so one run reports every defect.

The checks were shown to catch what they claim. Against the reviewed builds they failed, as "What changed" records. With defects injected into a page, the text check caught each one:
- a table row moved over the next;
- a covered lower half of a caption;
- text cut off by a box;
- a dialog's footer pulled over its description;
- a cover over the last two lines of a 2,529 px table cell at 320 x 256;
- a cover that ignores the pointer.

The check before the verification missed the last two: it sampled only the lines in view, and hit-tested only elements that take the pointer.

`apps/composer/app/astryx-renderers-a11y.test.ts` server-renders the Astryx renderers: heading elements (h1 and h2, never an empty one, and h3 a paragraph), table names, header and badge wrapping, long-word wrapping, and the column floor in both table modes.

## What changed

Run against main first, the e2e failed all 13 Astryx specs, and the renderer tests failed 8 of 10; a column-floor test and the dark pass were then added, and failed before their fixes. An independent accessibility review of that work found defects the checks could not see. Checks for them were added, and failed against the reviewed head (all 14 Astryx specs, and 3 of 13 renderer tests), before the fixes the table marks "review". A second independent review then found an inline dialog cut off at 320 x 256, and the checks' claims broader than their reach. The strengthened checks failed the reference spec against that head before the fixes marked "second review". A verification of those fixes found two defects outside the blocks: a fullscreen dialog's height, and an alert dialog's footer with long labels. A new spec failed on both before the fixes marked "verification". Each defect and its fix:

| Defect on main | WCAG 2.2 | Fix | Where |
|---|---|---|---|
| Block titles were `<p>`, so no surface had a heading | 1.3.1, 2.4.6 | The display variants render h1 and h2, and a container heading keeps `role="heading"` on its own text. Without text, a variant stays a paragraph (review). h3 stays a paragraph too (review): it is Astryx's `large`, which the contract keeps body text, its headings being the display types | `packages/astryx-renderers/src/components/TextRender.tsx` |
| Every table region was named "Table" | 2.4.6 | Each region is named by its columns | `TableRender.tsx` |
| Header text was cut off with an ellipsis at 320 px | 1.4.4, 1.4.10 | Header text wraps | `TableRender.tsx` |
| An 8-column table crushed its columns below a letter's width at 320 px, cutting text off; a children-mode table (a model's nested cells; no block uses one) did the same | 1.4.10 | A 96 px column floor, so the table scrolls inside its focusable region: Astryx's `proportional()` widths in a data table, and the header cells' minimum width in a children-mode one (review) | `TableRender.tsx` |
| Long words and labels ran out of the card (titles, intros, a guide's facts) | 1.4.10 | A word breaks when it must; a badge's label wraps | `TextRender.tsx`, `BadgeRender.tsx` |
| guide-steps' two tables overlapped by 20 px, hiding a row of the first behind the second's header, and every table region overlapped the elements next to it by 4 px. A rule removing Astryx's vertical table bleed matched only the Studio's canvas | 1.4.3, 1.4.10 | The rule matches the Astryx canvas too (review) | `apps/composer/app/globals.css` |
| The auth form's inputs held the surface 24 px past a 320 px viewport | 1.4.10 | A surface narrows with the canvas | `globals.css`, Astryx canvas only |
| An inline dialog made the page wider than a 320 px viewport (by 43 px for the delete-project reference, as the review measured it); once surfaces narrowed with the canvas, it was cut off instead. Narrowed, its 75vh height cap then showed 108 px of its content at 320 x 256, in a scroll box of its own that axe flags as not keyboard-focusable (Chromium makes it an unnamed tab stop; Safari does not make it focusable) | 1.4.10, 2.1.1 | A dialog fits its container's width (review), and takes its content's height (second review; a fullscreen one's viewport height too, in the verification). Its footer's buttons wrap onto rows of their own when together they are too wide: with text spacing at 320 px, "Keep my archived projects" was cut off (verification) | `globals.css` |
| A button's label stayed on one line, cut off with an ellipsis: with text spacing at 320 px, "Continue with Microsoft" lost a word | 1.4.12 | A label wraps, and its button grows; a one-line button keeps Astryx's height (review). A word too long for its line breaks (second review). The rule spares icon-only buttons, which Astryx sizes itself (second review) | `globals.css` |
| The studio's green focus ring was 2.41:1 against the canvas white | 1.4.11 | Astryx's own indicators (#0064E0, 5.4:1), and an inset accent ring on the table region, for which Astryx draws none | `globals.css` |
| In forced colors a focused field showed only its caret: Astryx marks focus with a border color and a shadow, which forced colors replace | 2.4.7 | A focused field gets an outline in forced colors (review) | `globals.css` |
| With a dark OS preference, Astryx's dark tokens drew inside the white canvas, where its primary button is 3.11:1 | 1.4.3 | The Astryx canvas draws light | `globals.css` |
| The sticky header hid focused controls: with Shift+Tab at 640 x 450 and 320 x 720, and every one at 320 x 256, where the header filled nearly all of the viewport. From 721 to 960 px wide it was up to 325 px tall | 2.4.11 | At 960 px wide or less, where its nav wraps, or 600 px tall or less, the header scrolls away (review, widened in the second review); otherwise the root's scroll padding follows its measured height | `apps/composer/app/af-ui.css`, `composer.tsx` |
| The Build options made the page 11 px too wide at 320 px | 1.4.10 | Each option wraps under its label | `apps/composer/app/views/build-view.tsx` |

All of these ship in the default build too, and every Astryx surface in Preview gains them. The Studio exhibit (apps/web) gets the renderer changes only, not Composer's canvas CSS or shell; its suite passes. None changes a block signature, a template, a prompt, model selection, a request or any evaluation evidence.

## What this environment could and could not check by hand

- **No screen reader.** This environment has no NVDA, JAWS, VoiceOver or Orca, and Chromium is its only browser. No screen-reader pass was done, and none is claimed.
- **The accessibility tree, as Chromium exposes it.** This is what a screen reader receives from Chrome, not what it announces. For each block's example:
  - records-table: the level-2 heading "Open support tickets"; the focusable group "Table: Ticket, Subject, Status, Priority", holding a table with its column headers; the button "Refresh".
  - auth-form: the level-2 heading "Create your account"; the textboxes "Full name Required", "Email address Required" and "Password Required", each marked required; the buttons "Create account" and "Continue with GitHub".
  - guide-steps: the level-2 heading "Weeknight pasta"; the groups "Table: Ingredients" and "Table: Step, Instruction"; the buttons "Start" and "Save guide".
- **Keyboard,** in Chromium only, by the test runner's key events rather than a person. A screenshot of each focused control was inspected: buttons show Astryx's 2 px blue ring, fields their blue border, and table regions an inset blue ring. In Chromium's forced-colors emulation, a focused field shows its outline.
- **Narrow sizes,** in screenshots: at 320 px with text spacing, "Continue with Microsoft" wraps onto two lines inside its button, and the delete-project reference's dialog fits the canvas, its button label wrapping.

## Still needs a person

1. A screen-reader pass per block: NVDA with Firefox or Chrome on Windows, VoiceOver with Safari on macOS and iOS, and TalkBack with Chrome on Android. Listen for the heading, the table regions' names, table navigation, each field's name and required state, and the buttons. A maximum call names its table region with about 330 characters, and two tables with the same columns share a name: judge both by ear.
2. A keyboard pass in Firefox and Safari. Safari reaches buttons with Tab only when its "Press Tab to highlight each item" setting is on.
3. Real browser zoom at 200% and 400% in more than one browser, at desktop window heights as well as the sizes above, and text spacing with a bookmarklet. Text-only zoom to 200% (Firefox's "Zoom text only", or a browser's minimum font size), which viewport sizes do not reproduce (SC 1.4.4).
4. Windows forced colors (high contrast), on Windows, in both a light and a dark theme: that focus indicators and field boundaries survive. The automated pass uses Chromium's emulation, with a light palette.
5. Focus indicators with motion on. Every automated pass runs with reduced motion, which makes Astryx's border transition instant.
6. Touch: target size, and scrolling a wide table's region, on a phone, in portrait and landscape (SC 1.3.4).
7. Speech input (Voice Control, Dragon): each control can be operated by saying its visible label (SC 2.5.3).
8. Input purpose by hand (SC 1.3.5): it fails today, under the exception in [BETA.md](BETA.md), and a host's mitigation must be checked in that host.
9. By eye, in Build and in Preview: guide-steps' two tables sit apart, and no row hides behind the next header.
10. Astryx surfaces that are not blocks: model-generated and imported ones. They share the renderers and the canvas rules; only the reference surfaces are checked automatically.
11. The composer shell at sizes the checks skip: a tablet in portrait, and windows from 721 to 1000 px wide.
12. The Studio exhibit's heading outline, now that its surface titles are h1 and h2.
13. The judgements in "Proposed waivers".

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

## Outside the blocks (information)

- **One axe violation, unchanged by this step.** axe runs over each Astryx reference surface in Preview, with the tags above, at every size. It finds one violation: on `ex.plan-comparison`, `aria-required-children` (critical).
  - Its Astryx list, a `ul` with the role `list`, holds checkboxes and a definition list's `dt` and `dd`, where a list allows only list items.
  - The List, SelectableCard and MetadataList renderers are unchanged here.
  - It is not a block, so it is left for a separate change. The reference spec allows it by name.
- **A row of buttons too wide for its line.** Outside a dialog's footer, which wraps, a row of buttons still overflows when the longest words of its labels together are wider than the row.
  - A word wider than its own line breaks (`overflow-wrap: break-word`).
  - Breaking anywhere would also split short labels: it split "Cancel" in a dialog's two-button row at 320 px.
  - Only a model-written row could overflow. The blocks' labels are fixed template text, and their rows fit at every size, with text spacing too.
- **The button rule's scoping.** The label-wrapping rule applies only to a button named by its visible text, which Astryx marks by giving every other button an `aria-label`. That has two latent edges; neither occurs today, since ButtonRender renders neither:
  - An icon-only button with an empty label gets no `aria-label` from Astryx, and so would still get the rule. It would have no accessible name at all.
  - Astryx gives a button an `aria-label` while it is loading, so a wrapped label would drop back to one line while it loads.

## Re-running

```
pnpm --filter composer build:experimental
pnpm exec playwright test --config playwright.composer-experimental.config.ts e2e/composer-blocks-a11y.spec.ts
pnpm --filter composer test
```
