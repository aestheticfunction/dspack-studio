# D0: the designer-first refinement of the Composition Library

**Status:** implemented on the D0 branch for the product owner's evaluation, 2026-11-26. **Not merged and not deployed.** It is in the experimental build only, and the default artifact is unchanged.

It implements [DESIGNER-FIRST-PROPOSAL.md](../../DESIGNER-FIRST-PROPOSAL.md) on the existing workspace. There is no new shell and no parallel governance path: the Library still shows real governed instances through the R1a host, on Composer's canvas, with the M1 storage.

This page records what changed, the measurements, an engineering assessment, the accessibility and regression evidence, how to evaluate it, and what remains. **No designer has used it yet.** The assessment below is an engineering reading against the proposal's principles, not a usability result. Observations from designers go in a separate record ([USABILITY-OBSERVATIONS.md](USABILITY-OBSERVATIONS.md)), using the script in [USABILITY-SCRIPT.md](USABILITY-SCRIPT.md).

## The questions the workspace answers

| A designer asks | Where the answer is, without documentation |
|---|---|
| What am I designing? | The canvas title, and the inspector's **Design** tab ("What it is") |
| What does it look like? | The canvas, centred at its natural width, with **Fit width** to widen it |
| How does it behave with different data? | The **Example data** chips, with names such as "Three hotels" and "No hotels found" |
| Does it satisfy the design rules? | The status pill beside the title; reasons in the **Checks** tab |
| What can I do next? | Each refusal ends in a next step; the first-run guide offers four tasks; **Coming next** names what is not available |

Hashes, rule ids, stages, gate names, toolchain versions, surface ids, timing and raw payloads are in **Technical details**, closed by default, and in each refusal's own closed disclosure.

## What changed

| Area | D0 | Before (main, 5acaef1) |
|---|---|---|
| Navigation | One app header row. The Library's scope (**Astryx sample**) and a **Coming next** disclosure sit in it, beside Library | The app header, then a second workspace bar, then a breadcrumb |
| Frame | A fixed-height workspace at 900 px and wider, in windows at least 600 px tall. The page does not scroll; the list, the canvas and the inspector scroll on their own, and the canvas toolbar stays in view | The page scrolled as a document, and the inspector scrolled away |
| Canvas toolbar | Two compact rows: the title, version, status pill and panel toggles; then the example chips and **Fit width** | A title block, then a control row of three selects |
| Composition | Centred, at most 760 px wide; **Fit width** widens it to the canvas | Stretched to the canvas width |
| Examples | Chips with human names. An example declared to be refused says "· should be refused" | A select of ids: "three", "one" |
| Status | One pill: **Passes the design rules**, **Not shown, as expected**, **Not shown**, **Needs a new check**, **Fails the changed rules**. Each has a tone and an icon, not colour alone | "governed: S1–S3 and A1–A3 pass" |
| Refusals | **Expected:** a calm panel, "Not shown, as expected", with the rule's rationale in plain words and "Choose another example". **Unexpected:** an error panel, with what happened and a next step (for a state: **Show the state the example chooses**). Stage, rule id and raw message are under a closed **Technical details** | One red box led by the lint message |
| States | In the Checks tab, under **Show a specific state**. States the example cannot reach are marked "(not available with this example)" | A select beside the scenario, with unreachable states unmarked |
| Inspector | Two tabs: **Design** (what it is, versions and publication, data it needs, what a person can do, what a person can type) and **Checks** (result, each example's expected and actual result, the device record, state, the rule try-out). **Technical details** sits below both, closed | One long column with hashes and pins at the top |
| Publication | "Published for agents: no. Publishing is not available yet. Passing checks or being approved does not publish a version." | Not stated |
| Actions | "Preview only, not run. “Choose Hotel Miradouro” would send hotel id h-102." A consequential action says it would ask for confirmation first. A sensitive value reads "member number (private: not shown, never kept)". The recordable JSON is in Technical details | The redacted JSON, as the note |
| Rule try-out | "Try a stricter rule (this session only)" and "Restore the Astryx rules", in the Checks tab | "What-if: require four options" |
| First run | A guide in the Compositions panel: what Composer enables, then four working tasks (see real data, see what the rules prevent, compare a draft with the approved version, try a confirmation step), then what is not available yet. **Hide this guide** is remembered; **Show the guide** brings it back. On a phone, a one-line "New here? Try four quick examples" opens it | None |
| Phone | The inspector is a bottom sheet (up to 82% of the height), modal as R3 requires. The Compositions panel is a modal drawer. Toolbar rows reorder so the title and toggles share a row | Side drawers |
| Headings | A visually hidden `h1` "Composition Library"; the canvas title is the `h2` | No workspace `h1` |

**Data and storage.**
- **Scenario titles.** The 0.2 sidecar schema gains an optional scenario `title` (1 to 60 characters, trimmed). It is additive, and existing definitions load unchanged.
- **The draft carries titles.** The draft hotel-results v2 has them. The approved v1 definitions stay byte-identical to the ones R1a verified, so their hashes are unchanged. Their human names come from a small label map in the Library, and a definition's own title always wins.
- **The guide's state.** It is one new experimental record, `onboarding` (`{ dismissed: boolean }`), versioned and validated like the others.

**Differences from the proposal, and why.**

| Proposal | D0 | Why |
|---|---|---|
| A one-line welcome strip above the canvas toolbar, with three guided examples | A guide card in the Compositions panel, with four tasks; on a phone, a one-line strip that opens it | The owner asked to explain what Composer enables before its architecture and to teach through tasks, which needs more than one line. Putting the guide in the panel keeps the composition within 200 px on a first run. The fourth task, real data, is the starting point the others compare against |
| One toolbar row | Two compact rows | The example chips do not fit beside the title, versions and status at 1280. Two rows still meet the 200 px target |
| Scenario chips with mapped names until authoring adds `title` | The optional `title` is in the schema now; the draft uses it, and the approved versions use the mapped names | The owner asked for human-readable names in D0. Approved definitions cannot change |

## Measurements

Measured in Chromium with [measure.cjs](measure.cjs). **Composition top** is the distance from the top of the viewport to the rendered surface.

| Viewport and state | Before | D0 | Target |
|---|---|---|---|
| 1280 × 800, normal | 337 px | **189 px** | ≤ 200 px ✓ |
| 1280 × 800, first run (guide open) | 337 px | **189 px** | ≤ 200 px ✓ |
| 390 × 844, normal | 582 px | **243 px** | ≤ 260 px ✓ |
| 390 × 844, first run (guide strip) | 582 px | **259 px** | ≤ 260 px ✓ |
| 1440 × 900, normal | 337 px | 189 px | n/a |
| 1024 × 768, normal | 332 px | 225 px | n/a |

| Canvas share of the width | Before | D0 | Target |
|---|---|---|---|
| 1280, Compositions open | 78.7% | 78.1% | ≥ 60% ✓ |
| 1280, Inspector open | 73.4% | 73.4% | ≥ 60% ✓ |
| 1440, both panels open | 57.5% | 56.9% | n/a (the target is one panel at 1280) |
| 1024, Compositions open | 73.4% | 72.7% | n/a |

There is no horizontal page scroll at any width measured. The raw numbers are in [before.json](before.json) and [after.json](after.json). Two of them are browser assertions in `e2e/composer-library.spec.ts`: ≤ 200 at 1280 (normal and first run) and ≤ 260 at 390 (normal and first run).

**Trade-offs.**
- **The phone's first run is 1 px inside its target.** The guide is a one-line strip above the toolbar, which costs 16 px. A full guide card would push the composition below the first screen, so on a phone the guide lives in the Compositions drawer, one tap away.
- **On a phone the page scrolls as a document.** The fixed frame needs at least 900 px of width and 600 px of height. Below that, a fixed toolbar would take too much of a small screen. The toolbar scrolls away, and the panels are sheets.
- **On a phone the example chips scroll sideways.** The last two are off screen at first, and the clipped chip shows there are more. Wrapping them would add about 40 px above the composition.
- **On a first run at 1280, the Compositions panel opens with the guide.** Without it, the panel opens with the list. The canvas share is the same either way.
- **At 1440 with both panels open, the canvas is 56.9%.** That is 0.6 points narrower than before. The prototype gives 58.8% in the same state. Narrowing the inspector to 320 px would add about 1.4 points.
- **Coming next is a disclosure in the header at 900 px and wider.** Below 900 px the header has no room, so it moves into the Compositions drawer.

## Engineering assessment

This is my reading against the proposal, not evidence of how designers will respond.

| Aspect | Assessment |
|---|---|
| Task clarity | The guide names four concrete tasks, and each one changes the canvas, so a task is seen working, not described. The scope line ("Astryx sample") and the publication note answer "what is this, and can agents use it" without architecture |
| Discoverability | The examples are visible chips, not a select. States and the rule try-out are one tab deeper, on purpose: they are diagnostic. The risk is that a designer never opens the inspector. The status pill is the only signal on the canvas that more is available |
| Examples and versions | Example names say what the data is. "· should be refused" warns before the refusal. Versions are radio chips beside the title. The draft note says the draft is not approved and that the approved version is unchanged |
| Refusals | An expected refusal reads as a lesson in a neutral tone. An unexpected one reads as a problem, with a next step. Both lead with the rule's rationale. The rule id and the raw message are one disclosure away |
| Action feedback | The note is pinned in the visible canvas, in plain words, and says nothing runs. A sensitive value is named, never shown |
| Hierarchy and density | What is designed comes first. Validation is one pill on the canvas and one tab in the inspector. Technical facts are closed. The inspector's Design tab is still long for hotel results (seven actions, four inputs), and authoring will make it longer |
| Keyboard | The tabs follow the ARIA tabs pattern (arrows, Home, End). Chips and version radios work with the keyboard. Focus is visible. The phone sheet and drawer contain focus, and Escape returns it to the toggle |
| Responsive | Measured at 1440, 1280, 1024 and 390, with targets met. The phone's toolbar is dense: 10.5 to 11.5 px text in the version chips and toggles |

## Accessibility and regression evidence

| Check | Result |
|---|---|
| `e2e/composer-library.spec.ts` | **25 tests pass.** Of these, 13 are new or rewritten for D0: the first-run guide (tasks work, dismissal persists, Show the guide restores it); no hashes, gate names, rule ids, surface ids or raw payloads in either tab, with Technical details closed; the Design tab and the publication note; tab keyboard behaviour; both layout targets in the browser; the fixed frame (no page scroll, the canvas scrolls and the header and inspector stay); Fit width; the phone bottom sheet; plain action text with the raw form in Technical details; expected and unexpected refusals |
| R1 to R4 | All four review-correction tests are kept and pass against the new interface. R1 now checks both tabs; R2 still holds the stored approvals byte-identical |
| Axe, WCAG 2.2 A and AA | No violation at 1280 (inspector open, then a refused example) or at 390. **No exception** of any kind |
| Full experimental suite | **82 passed** |
| Default smoke suite | **49 passed** |
| Unit tests | composer-core **569**, composer **591** (adds scenario-title schema tests, the onboarding record test, and the test that approved versions carry no change) |
| Typecheck | Clean, in both packages |
| Default build | Built and passed `check-default-artifact`: **29 files clean of 19 markers**. The Library, the guide and the onboarding record are absent from the default artifact |

## How to evaluate it

From the repository root, on the D0 branch:

```bash
pnpm install
```

```bash
pnpm --filter composer build:experimental
```

```bash
COMPOSER_OUT_DIR=out-experimental PORT=3315 node e2e/serve-composer.mjs
```

Open `http://localhost:3315/` and choose **Library**. Nothing is called: no agent, no hosted API, no model.

- **To see the first run again:** choose **Show the guide** at the foot of the Compositions panel, or clear this site's storage.
- **For the phone layout:** use the browser's device toolbar at 390 × 844.
- **For the tasks a designer would be given:** see [USABILITY-SCRIPT.md](USABILITY-SCRIPT.md).

## Remaining limitations

- **Not merged or deployed**, by instruction. It is experimental only.
- **The Library is read-only.** Authoring, inputs and actions, template editing, block promotion, the Playground, running actions, external agents and publishing are not built. The interface names them and offers no control for them.
- **The workspace is AF dark only.** This is a temporary D0 scope decision. Workspace themes are a later increment ([THEME-INTEGRATION-PROPOSAL.md](../../THEME-INTEGRATION-PROPOSAL.md)).
- **The approved versions' example names come from a label map in the Library**, because approved definitions cannot change. Authoring writes `title` into new drafts.
- **"Expected" refusals depend on the example's declaration.** A refusal is "as expected" only when the example says it should be refused and the refusing rule or stage is the one it names. Anything else is unexpected.
- **The Design tab is long for compositions with many actions.** Grouping is a candidate for authoring, once there is something to edit.
- **No designer has used D0.** The usability script is ready, and no one has been recruited or contacted.

## Decisions for the owner

1. **Accept D0 for merge**, after your own evaluation and the designer sessions, or ask for changes.
2. **Whether the phone toolbar's text size is acceptable** (10.5 to 11.5 px), or should trade a row of height for 12 px text.
3. **Whether the first-run guide should also open on later visits** until a designer has tried each task once, rather than until it is dismissed.
