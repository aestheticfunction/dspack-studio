# D0.1: the independent audit's corrections

**Status:** implemented on PR #129 for the product owner's merge decision, 2026-11-27. Not merged, not deployed, experimental build only.

D0.1 applies the independent designer-first audit of D0, which the owner accepted as the authoritative review, with the owner's refinements. It changes presentation, copy and one view preference. It does not change the architecture, the governance pipeline, the contract, any approved definition or hash, or the default application.

## The audit's findings and what happened to each

| Finding | Disposition |
|---|---|
| The toolbar breaks outside the measured state: chips hidden at 1024 and at 1440 with both panels, panel toggles wrapping, a draft adding 39 to 93 px | **Fixed.** The view controls (Fit width, then the two panel buttons) form one group that never leaves the title's line. Below a canvas width of 1180 px they show icons, and keep their names for assistive technology and as tooltips. On wider screens the examples wrap. On a phone they scroll sideways, with faded edges, a chevron, and a focused chip scrolled fully into view. Fit width has left the chip row |
| The draft note adds a row and does not say what changed | **Fixed.** A "Draft, not approved · What changed" disclosure sits in the status area. It lists the two wording changes and the stored example names. A unit test holds the list equal to the actual difference between the v1 and v2 definitions. At 1280 the draft starts exactly where v1 does |
| The refusal leads with the contract's wording | **Fixed.** It leads with "A comparison needs at least two options to choose from.", from a label keyed by rule id. The contract's rationale and the rule id are under Technical details. No contract or definition changed |
| "Last valid instance" is pipeline vocabulary | **Fixed.** It now reads "Previous screen · not interactive" |
| The solid accent is spent on panel toggles; the draft's pill is green | **Fixed.** Open and pressed controls use a quiet raised state. The status pill reports checks only, in a neutral tone with a tick, for every version. Draft status is said separately. No solid-accent control is visible in the Library |
| Type below a readable floor; "Coming next" at about 3.2:1; 25 px phone targets | **Fixed.** Workspace text is 12 px at minimum, and reading text in the guide and the inspector is 14 px. The workspace uses sentence case in its sans face instead of uppercase tracked mono. "Coming next" is 12 px and passes 4.5:1. On a phone, toggles, versions, examples and the guide link are 44 px targets |
| The guide fills the panel called "Compositions" | **Fixed** (owner decision). The list comes first, and the guide follows it, compact, with the same four examples. It can be hidden at any time and brought back |
| A reload returns to Projects | **Fixed.** In the experimental build only, a `view` record in the workspace namespace remembers whether the Library was on screen. The default application is unchanged |
| "Not now" gives no feedback and leaves the Reserve note | **Fixed.** A canvas button that sends nothing replaces the note with "Preview only. “Not now” sends nothing." Redaction is unchanged |
| Nothing on Projects points to the Library | **Added** (owner option). One contextual line on the experimental Projects page links to the Library. The default artifact check now refuses its marker |
| The usability script's "hotel search results" is ambiguous | **Fixed.** Task 1 names the Hotel results composition without saying where it is, and still starts on Projects |
| The theme plan omits Settings' appearances and type, case and density | **Fixed** in [THEME-INTEGRATION-PROPOSAL.md](../../../THEME-INTEGRATION-PROPOSAL.md) |
| Search placeholder cut off, and "review" is internal vocabulary | **Fixed in passing:** the placeholder is "Name or purpose" |
| Deferred by the audit: deep links, side-by-side version comparison, canvas-button navigation, a real scope menu, a second `h1` from the composition, inspector length | **Not done.** These stay deferred |

## Measurements

Measured with [matrix.cjs](matrix.cjs) in Chromium. The reference is the top of the white canvas frame, the same before (D0 at `b7f4df6`) and after. The project's earlier figures measured the rendered surface inside the frame, about 23 px lower. Raw numbers are in [before.json](before.json) and [after.json](after.json).

| Viewport | Version | Panels | Before | After |
|---|---|---|---|---|
| 1280 × 800 | v1 approved | any one, or none | 166 | **172** |
| 1280 × 800 | v2 draft | any one, or none | 205 | **172** |
| 1280 × 800 | v1, first run | Compositions | 166 | **172** |
| 1440 × 900 | v1 or v2 | none or one | 166 / 205 | **172** |
| 1440 × 900 | v1 / v2 | both | 166 / 259 | **212 / 212** |
| 1024 × 768 | v1 or v2 | none | 166 / 205 | **172** |
| 1024 × 768 | v1 / v2 | Compositions | 202 / 259 | **212 / 212** |
| 1024 × 768 | v1 / v2 | Inspector | 200 / 259 | **250 / 250** |
| 390 × 844 | v1 | none | 232 | **289** |
| 390 × 844 | v1, first run | none | 248 | **306** |
| 390 × 844 | v2 | none | 338 | **306** |

| Also measured | Before | After |
|---|---|---|
| Chips hidden (1440 both; 1024 one panel) | 46 px; 122 to 208 px | **0 everywhere ≥ 900 px** |
| Toggles off the title's line | 1440 both (draft), 1024 one panel | **never** |
| Canvas share at 1280, one panel open | 78.1% / 73.4% | 78.1% / 73.4% |
| Smallest workspace text | 10.5 px | **12 px** |
| Phone targets: toggles, versions, examples, guide link | 25, 24, 30, 18 px | **44 px each** |
| Solid-accent controls in the Library | 1 or 2 (the panel toggles) | **0** |

**Deviations, kept on purpose.**
- **1440 with both panels, and 1024 with a panel open.** The first is 212 px and the second 212 to 250 px. At those canvas widths the status moves below the title and, with the Inspector at 1024, the examples take two rows, so that none is hidden. The 200 px target is defined at 1280, where it holds for both versions.
- **The phone: 289 to 306 px**, against a provisional target of about 300. The text went from 10.5 to 12 px and the targets from 25 to 44 px, as decided. The examples' sideways scrolling is intended there, with visible edge cues.

## Evidence

- **Failing first.** The ten new D0.1 browser assertions all fail against the D0 build, each on the audit's defect ([failing-first.txt](failing-first.txt)). All pass on the corrected build.
- **The Library spec**, `e2e/composer-library.spec.ts`, has 35 tests, all passing:
  - the D0.1 block: the toolbar state matrix, phone chip visibility and keyboard, the type floor and accent at 1280 and 390, contrast and 44 px targets, draft wording, guide order, reload persistence, "Not now", and the Projects entry;
  - R1 to R4, unchanged in intent;
  - axe (WCAG 2.2 A and AA) at 1280 and 390, with no exceptions.
- **Unit tests.**
  - `presentation.test.ts`: the draft summary matches the definition difference, every approved example has a name, and rule leads exist only for contract rules.
  - `storage.test.ts`: the `view` record's shape.
- **Full verification** on the final tree: see the PR.

## Screenshots

These are 1×, before and after, at the same states: [before/](before/) and [after/](after/).

| State | File |
|---|---|
| 1440, draft, both panels | `1440x900_v2_both.png` |
| 1280, draft, inspector | `1280x800_v2_inspector.png` |
| 1280, first run | `1280x800_v1_library_first-run.png` |
| 1024, draft, inspector | `1024x768_v2_inspector.png` |
| 390, first run; 390, draft | `390x844_v1_none_first-run.png`, `390x844_v2_none.png` |
| The one-hotel refusal at 1280 and 390 | `state-refusal-1280.png`, `state-refusal-390.png` |
| "Not now" after Reserve | `state-not-now-1280.png` |
| The draft's "What changed" (after only) | `state-draft-1280.png` |
| The Projects page | `projects-1280.png` |
