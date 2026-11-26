# Designer-first refinement proposal

**Status:** proposal for the owner, 2026-11-26. Nothing here is implemented. It refines the approved canvas-first workspace before composition authoring widens it. It does not change the architecture, the governance pipeline or the approved layout direction.

## Why

The first Library increment passes its technical acceptance criteria, and the owner's own reading of it is right: it is hard to absorb as a designer. It reads as a governance workbench, for three reasons the review measured ([M1-WORKSPACE-REVIEW.md](M1-WORKSPACE-REVIEW.md)):

- **Everything is at one level.** A scenario's data, the rule that refused it, the composition hash and the lint version sit side by side in the inspector.
- **The vocabulary is the pipeline's.** Scenarios are named "three" and "one". The status line said "S1–S3 and A1–A3". A refusal leads with a lint message.
- **The working surface is low and crowded.** At 1280 × 800 the rendered composition starts 312 px down, below two navigation bars, a breadcrumb, a title and a control row. On a phone it starts below the first screen.

Governance is the product's distinguishing strength. It should be visible as confidence ("this passes the design system's rules"), with its reasons one step away and its machinery two steps away.

## Principles

1. **The canvas is where the work is.** What is designed comes first and highest. Everything else supports it.
2. **Three layers, each one step deeper.**

   | Layer | Question it answers | Where |
   |---|---|---|
   | Design | What is this, what does it look like with this data, what can a person do with it? | Canvas, canvas toolbar, inspector's first tab |
   | Validation | Does it pass? If not, why, in plain words, and what can I do? | A status pill on the canvas; the inspector's Checks tab |
   | Technical | Which rule id, stage, hash, pin, toolchain? | A closed "Technical details" disclosure |

3. **Say it as a designer would.** "Three hotels" rather than "three"; "Needs at least two options to compare" rather than "Required sub-component 'selectable-card' (min 2)".
4. **Every refusal ends in something to do.** Either "this is the expected result", or the next step: change the scenario's data, or open the rule.
5. **Examples teach, documentation explains.** A first-time designer should understand the Library from its own examples. Documentation is for advanced governance and integration.

## The first-run journey

A designer who has never seen Composer opens the Library.

1. **Arrival.** The canvas shows **Hotel results** with three hotels. A one-line, dismissable welcome strip sits above the canvas toolbar:

   > This is a **composition**: a reusable screen that an agent fills with real data. Try it with different data below. Every version is checked against the Astryx design system.

   It offers three guided examples, each a link that changes the selection: **See a refused example**, **Compare the draft with the approved version**, **See the confirmation step**. Dismissing it is remembered in experimental storage.
2. **Scenarios as examples.** The scenario control is a row of chips with human names: **Three hotels**, **Two hotels**, **One hotel** (marked "expected to be refused"), **No results**, **Confirm a reservation**. On a phone the chips scroll horizontally.
3. **A refusal that teaches.** Choosing **One hotel** shows a calm, neutral panel:

   > **Not shown, as expected.** A comparison needs at least two options to choose from. *(Astryx rule: review offers alternatives.)*
   > This scenario exists to show the rule working. To see the composition, choose another scenario.

   An unexpected refusal looks different (error tone) and ends with what to do. In authoring, it also gets an **Edit this scenario** action.
4. **Versions side by side.** **Compare the draft** selects v2 and shows the toolbar's version chip as "v2 · Draft". A one-line note says what changed ("Wording: price note; button label") and that v1 stays as it is.
5. **What a button does.** Pressing **Choose Casa do Rio** shows the pinned preview note in plain words: "Would choose Casa do Rio (sends hotel id h-101). Preview only: nothing runs in the Library."
6. **On a phone,** the same journey works with the composition visible on the first screen (target below).

**First-run acceptance**, tested with designers who have not seen Composer, without documentation:

| # | Task | Passes when |
|---|---|---|
| T1 | Find the hotel results composition and say what it is for | Named within 30 s; purpose stated in their words |
| T2 | Show it with one hotel and explain why it is not shown | They cite "needs at least two options" |
| T3 | Tell which version agents may use | They say v1, because v2 is a draft |
| T4 | Find out what pressing a hotel's button would do | They find the preview note and say nothing actually runs |
| T5 | Do T1 on a phone | Without opening a drawer for the composition itself |

## Information hierarchy

**Desktop, 1280 × 800, inspector open** (a sketch, not a prototype):

```
┌ Composer · Projects · Library ─────────────────────── Astryx sample ▾ · Settings ┐  app header, one row
├──────────────────────────────────────────────────────────┬───────────────────────┤
│ Hotel results  v1·Approved ▾   ✓ Passes the design rules │ Inspector             │  canvas toolbar, one row
│ [Three hotels] [Two] [One · refused] [None] [Confirm]    │ Design │ Checks │ ⋯   │  scenario chips
│                                                          │                       │
│        ┌──────────── rendered composition ─────────────┐ │ Compares the hotels a │
│        │ Hotels in Lisbon                              │ │ search found…         │
│        │ ┌ Casa do Rio ──────────────────────────────┐ │ │ Data it needs         │
│        │ │ Area  Alfama   Price per night $142        │ │ │ Actions it can send   │
│        │ └────────────────────────────────────────────┘ │ │                       │
│        └───────────── centred, ≤ 720 px ───────────────┘ │ ▸ Technical details   │
│      ┌ Preview only: would choose Casa do Rio ──── ✕ ┐   │                       │
└──────────────────────────────────────────────────────────┴───────────────────────┘
```

- **One navigation row.** The workspace bar's destinations move into the app header as a single quiet group. "Compose · Playground · Publish" become a "Coming next" menu item rather than a second bar. The full consolidation stays with the workspace cutover, as decided; this only stops the Library adding a second bar.
- **One toolbar row** above the canvas: title, version chip (a menu when there are several versions), a status pill, and the scenario chips. **State** moves into the Checks tab as an advanced control, because the data chooses it.
- **The canvas** is a fixed-height frame, with the side panels scrolling on their own. The rendered composition is centred at up to 720 px. A "Fit width" toggle restores full width for wide surfaces.
- **Inspector tabs:**
  - **Design:** summary; data it needs (plain field names); actions it can send ("Choose: sends the hotel's id"); inputs, with sensitive ones marked.
  - **Checks:** the result in one sentence; scenarios by human name with ✓ or ✗ and the reason; the device record. The what-if becomes "Try a rule change (this session only)".
  - **Technical** (closed by default): ids, the definition, contract and toolchain hashes, gate names, timings.

**Targets:** the rendered composition starts at most 200 px from the top at 1280 × 800, and at most 260 px at 390 × 844. The canvas stays at 60% or more at 1280 px with one panel open.

**Phone, 390 px:** header (one row), toolbar (title and status pill), then the chips (one scrolling row), then the composition. The inspector opens as a bottom sheet with the same three tabs, still modal (as corrected in R3).

## Plain-language copy

| Now | Proposed |
|---|---|
| Scenario "three", "one", "confirm" | Three hotels, One hotel (expected to be refused), Confirm a reservation |
| Checks pass (status line) | ✓ Passes the design rules |
| Not shown: refused by the design system's rules + lint message | Not shown, as expected: a comparison needs at least two options to choose from. Technical detail behind a disclosure |
| State: Chosen by the data | (moved to Checks: "Shown as: Ready, chosen by the data") |
| Purpose: Review before a transaction | Kept, in the Design tab |
| Definition hash, contract hash, toolchain | Technical details only |

**Human scenario names** need an optional `title` on a scenario in the 0.2 sidecar. That is a small, additive schema change, made at the start of authoring, which edits scenarios anyway. Until then the Library shows a mapped label for the two packaged compositions.

## Workspace theming and the Aesthetic Function theme generator

### Three things to keep apart

| | What | Who changes it | Effect on governance or the canvas |
|---|---|---|---|
| 1. Aesthetic Function brand identity | The AF mark, the canonical palette, the type voice | Nobody in Composer: it is canon (af-site `CANON.md`) | None |
| 2. Composer workspace themes | The chrome around the canvas: panels, bars, inspector | A designer, as a preference | **None, by construction** |
| 3. The composition's design system | Astryx or shadcn/ui, inside the canvas | Its contract | It *is* what governance checks |

A workspace theme must never reach the canvas: no inherited `color-scheme`, no `data-theme`, and no custom property that a design system also reads. Composer's `globals.css` already warns that Astryx resolves `light-dark()` from the inherited scheme.

### What af-site has

Read-only discovery of `aestheticfunction/af-site` at `910ca7c`.

- **A deterministic theme compiler,** separate from its UI. Three pure ES modules, about 860 lines, with no DOM, network, time or randomness:
  - `scripts/theme-direction/compile.mjs`: `compileProposal`, `compileRealizations`;
  - `scripts/theme-direction/constraints.mjs`: WCAG contrast and a constraint set, C1 to C18b;
  - `scripts/theme-direction/solve.mjs`.

  Its input is a closed-enum *proposal* (`contract/theme-direction.v1.schema.json`):
  - surface hue, tint and depth;
  - ink warmth and contrast;
  - accent hue, chroma and presence;
  - display typeface voice and weight;
  - elevation.

  Raw values are never accepted. Its output is 27 colour and type tokens for a dark and a light scheme. Every text pair is solved to at least 4.5:1, and the result fails closed if any constraint fails.
- **An optional language front end.** A phrase goes to a hosted model, which returns a proposal (`worker/direction.mjs`, `worker/api.mjs`). The model only chooses enum values; the compiler decides every value.
- **The token contract** `contract/af-web.dspack.json` (dspack 0.4), emitted to `assets/tokens.gen.css` by `scripts/tokens-css/emit.mjs`. Its themes include `ember` and `slate`.
- **Persistence of the proposal, not the values** (`localStorage["af-tweaks"].gen`), recompiled before first paint by `assets/appearance.gen.js`. No share URL or file export exists yet.
- **Composer already hand-copies these tokens.** `apps/composer/app/globals.css`, `af-ui.css` and `appearance.ts` carry the default, `ember` and `slate` dark values. Fifteen of Composer's chrome variables map directly to compiler outputs (`--bg` … `--bg-2`, `--line`, `--line-soft`, `--fg` … `--fg-faint`, `--green` and its three variants, `--on-accent`, `--shadow-menu`).
  - **Mismatch:** `--hl` refers to a next/font face, while the compiler emits a family name.
  - **Not modelled by AF:** `--err`, `--warn`, `--ok`, `--info`, `--violet`, `--link`.
- **A planned graduation.** af-site `DECISIONS.md` (DR-2 and its F6 amendment) names the first consumer outside af-site as the trigger for moving `theme-direction/` into the Apache-2.0 `dspack-gen`. Composer would be that consumer.
- **Licensing.** af-site is private, with no licence file. dspack-studio is public. Reusing af-site code here therefore needs a licence decision, or the planned graduation into `dspack-gen` first. The fonts are OFL-1.1.

### Recommended boundary, for a later authorized increment

1. **Graduate first, then consume.** Move the compiler into `dspack-gen` as DR-2 and F6 plan, then import it in Composer. No copy, and no parallel theming system.
2. **Persist a proposal, not values,** in experimental storage. That gives a portable appearance for project export later.
3. **Replace Composer's hand-copied theme blocks** with tokens emitted from `af-web.dspack.json`, which removes drift. Add Composer's own semantic colours (error, warning, info) as constraints, with a compiler version bump.
4. **Apply to the chrome, never to `:root` where the canvas inherits.** A chrome container (header, panels, bars) receives the variables. The canvas frame stays outside it, and a test asserts the canvas's computed styles are unchanged under every workspace theme.
5. **Enum pickers first** (surface, accent, contrast, type voice). The phrase front end needs hosted inference and stays unauthorized.

## Sequence

| Step | Scope | Before or with |
|---|---|---|
| D0 | The refinements above: one navigation row, one toolbar row, fixed frame, centred surface, scenario chips with mapped names, plain-language refusals with next steps, inspector tabs with technical details closed, the welcome strip and its three guided examples, the phone layout targets | Before authoring |
| D0 check | The five first-run tasks with three to five designers, and the layout targets measured in the browser | Before authoring |
| A1 to A4 | Authoring as decided (create and discard a draft; edit metadata, parameters and scenarios, with the scenario `title`; run checks; approve on this device) | After D0 |
| Theming | Graduation of the theme compiler, then chrome-only workspace themes | A separate, later authorization |

## Decisions for the owner

| # | Decision | Recommendation |
|---|---|---|
| 1 | Run D0 before authoring | Yes: authoring adds controls to exactly the surfaces D0 reorganizes |
| 2 | Move the Library's destinations into the app header now (one row), keeping full consolidation for the cutover | Yes |
| 3 | The first-run test with designers | Three to five people, the five tasks above, before authoring merges |
| 4 | The theme compiler: graduate it into `dspack-gen` first, or settle af-site's licence | Graduate, as af-site already plans |
| 5 | Workspace themes: dark only, or light as well | Dark only at first; a light workspace needs its own canvas-isolation test |
