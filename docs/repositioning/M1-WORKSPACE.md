# M1 workspace increment: storage, versions and the Composition Library

**Status:** Slices A and B merged (#126). Slice C, the Library, is merged (#127), as corrected after the independent review ([M1-WORKSPACE-REVIEW.md](M1-WORKSPACE-REVIEW.md)). The designer-first refinement **D0** and **D0.1** are merged (#129): [m1/d0/README.md](m1/d0/README.md) and [m1/d0/d01/README.md](m1/d0/d01/README.md). The first **authoring** increment (A1 to A4: draft, edit, check, approve on this device) is implemented for evaluation, not merged: [m1/authoring/README.md](m1/authoring/README.md). Nothing here is in the default build.

| Slice | What | Where |
|---|---|---|
| A | Experimental storage: one namespace, versioned and validated records, safe recovery | `apps/composer/experimental/workspace/storage.ts` |
| B | Composition version coexistence: id and version, immutable approved versions, one newer draft | `packages/composer-core/src/compositions/versions.ts`, the loader, `host.ts` |
| C | The Composition Library: the first application integration of the canvas-first workspace | `apps/composer/experimental/workspace/library.tsx`, `runtime.ts`, the shell's guarded nav item |

## How to try it

From the repository root:

```bash
pnpm install
```

```bash
pnpm --filter composer build:experimental
```

```bash
COMPOSER_OUT_DIR=out-experimental PORT=3315 node e2e/serve-composer.mjs
```

Open `http://localhost:3315/` and choose **Library** in the top navigation. The local agent and the hosted API are not needed: the Library makes no request.

Things to try (as refined by D0):

1. **The first-run guide.** It follows the list in the Compositions panel. Each of its four tasks changes the canvas. **Hide the guide** is remembered, and **Show the guide** brings it back. A reload stays in the Library.
2. **Hotel results.** Switch between **v1 Approved** and **v2 Draft**: the draft's wording appears, **What changed** lists the differences, and v1 is unchanged. The Design tab says neither is published for agents.
3. **The "One hotel" example.** It is marked "should be refused", and the canvas says **Not shown, as expected**: "A comparison needs at least two options to choose from." The previous screen is kept behind a closed "not interactive" disclosure.
4. **Inspector, Checks: Show a specific state, "Empty", with "Three hotels".** The state is marked as not available with this example. Choosing it shows an unexpected refusal and **Show the state the example chooses**.
5. **Inspector, Checks: Try a stricter rule.** The canvas and the inspector both report **Needs a new check**. **Run checks under these rules** fails on "Three hotels" and "Two hotels"; nothing is stored. Hotel search passes under the same rule. **Restore the Astryx rules** brings both back to **Passes the design rules**.
6. **Hotel search.** Type a member number and press **Search hotels**. A note pinned to the canvas says **Preview only, not run**, with what would be sent in plain words, and the member number as private. The recordable form is in Technical details.
7. **Narrow the window below 900 px.** The canvas comes first. The Compositions panel is a modal drawer, and the inspector is a modal bottom sheet: Tab stays inside, the page behind is unavailable, and Escape closes it and returns focus.

Screenshots at 1440, 1280, 1024 and 390 px are in two places:
- after the review corrections: [m1/screenshots/](m1/screenshots/);
- before and after D0: [m1/d0/before/](m1/d0/before/) and [m1/d0/after/](m1/d0/after/).

## Slice A: experimental storage

- **One namespace:** `composer.experimental.workspace.`, with three records: `library` (the selection and the open panel), `approvals` (approval records) and `drafts`.
  - Only `storage.ts` reads or writes it.
  - The experimental directory is aliased to nothing in a default build (`next.config.mjs`).
  - The default artifact check refuses the namespace string and the workspace markers.
  - The default application reads and writes its own keys by name and never enumerates storage.
- **Versioned envelopes:** each record is `{ schema, version, data }`, validated field by field against a closed shape.

| Read | Result | What is kept |
|---|---|---|
| Missing | Defaults | Nothing written |
| Malformed (not JSON, wrong envelope, wrong shape) | Defaults | The record stays; before anything overwrites it, it is copied once to `<key>.preserved` |
| Another schema version | Defaults | Never overwritten by this build |
| Storage blocked | Defaults, in memory | Nothing |
| A write fails (quota) | Reported | What was stored stays |

- **What is never stored.** No shape has room for:
  - a typed value;
  - an action event;
  - a session or surface id;
  - a commitment;
  - renderer state.

  Writes outside the shapes are refused before writing.
- **Approval records are evidence, not authorizations.** A host accepts only an approval that `recheck` issued in the same session (Part B, L4).
- **Production project data is never touched.** Neither `composer.projects.v1` nor the keys beside it are read or written. One older experimental key is not in the namespace: block provenance, which a default build removes when its project is deleted. That behaviour predates M1, and this work leaves it unchanged.

**Evidence:**
- `experimental/workspace/storage.test.ts`, 14 tests:
  - isolation: a source scan, the artifact check, recorded key access, and the default app's own storage code against a seeded store;
  - each recovery outcome;
  - a refused write per forbidden field;
  - a real Library session with a synthetic sensitive value, after which storage holds no value, id, event or commitment.
- In the browser, `e2e/composer-library.spec.ts` checks:
  - only namespace keys change, and production data stays byte for byte;
  - the selection survives a reload;
  - a malformed record is reported in the inspector and kept aside.

## Slice B: version coexistence

- **A composition is `<id>@<version>`.** The loader reads several versions of one id under three rules:
  - `(id, version)` is unique;
  - there is at most one draft per id;
  - a draft is numbered above every approved version of its id.

  A version that breaks a rule is left out and reported.
- **`createLibrary` holds frozen copies.** An approved version cannot be changed through it.
- **`editComposition` on an approved version forks a draft** at the next number and leaves the approved version byte-identical. On a draft it replaces the draft. An edit may not change id, version or status. Editing an approved version while a draft is open is refused: edit the draft.
- **Approvals belong to one exact version.** The pins name the version, the composition hash, and the contract, profile and toolchain. `approve` now also refuses an approval for another version of the same id.
- **`approvalRecord` and `approvalStatus`** give the plain form of an approval and say whether it is current, or which pin changed (contract, profile, toolchain, interaction or composition).
- **A rule change** makes every approval under that contract need a re-check. Re-checking runs the scenarios again, so unaffected compositions simply pass.
- **A failed re-check issues no approval.** The host keeps the last valid instance, and the stored record is not replaced.

**Evidence:**
- `versions.test.ts`, 11 tests.
- `runtime.test.ts`: the packaged v1s are the R1a definitions, the draft differs only in wording, and the library loads with no issue.
- The storage tests: a failed re-check leaves the record.

**Not built, as proportionate to M1:** branching, merging, history beyond the versions present, a version picker for hosts (a host governs one version per id), and any authoring interface.

## Slice C: the Composition Library

This section describes Slice C as merged. D0 reorganizes its presentation without changing what is real: see [m1/d0/README.md](m1/d0/README.md#what-changed).


- **Where it lives.** The experimental build only. **Library** in the top navigation; the import is behind the literal flag.
- **Layout.** The approved prototype's workspace in Composer's own identity:
  - a workspace bar;
  - a **Compositions** list;
  - the canvas;
  - the **Inspector**.
- **Future destinations.** The bar names Compose, Playground and Publish as **not yet available**. None of them is a control.

What is real:

- **The packaged compositions** are hotel search v1 (approved) and hotel results v1 (approved) and v2 (draft): `experimental/compositions/astryx.compositions.json`. A test holds the v1s identical to the definitions R1a verified.
- **Every version is re-checked on load** under the packaged rules, and each has its own host with a generated session id.
- **Rendering uses Composer's Preview path:** `A2uiCanvas`, `registryFor("astryx")` and the Astryx canvas scope.
- **Selection.** Version (radio), scenario and state are native controls. A state is shown only when its guard holds for the data.
- **Refusals** show the stage, the rule and its rationale, with the last valid instance kept below, dimmed and inert.
- **Needs re-check.** It comes from a session-only what-if edit of one rule. The re-check reports which scenarios fail. A what-if never writes an approval record.
- **The inspector** shows:
  - the composition and its versions;
  - the re-check result per scenario;
  - the record on this device;
  - the contract and toolchain pins;
  - the instance's state, purpose, inputs (sensitive ones flagged), actions and timing;
  - storage problems, if any.
- **Actions are shown, never run.** Pressing a button shows what it would send, in the host's redacted form.

Layout and keyboard:

| Width | Panels | Canvas |
|---|---|---|
| 1440 px and wider | Both may be open | ≥ 57% with both open |
| 900 to 1439 px | One at a time (decision 18) | ≥ 60% at 1280 px, asserted with either panel open |
| Below 900 px | Drawers over the canvas, closed at first, with a scrim; Escape closes and returns focus to the toggle | Full width; no horizontal scroll at 390 px |

- Toggles carry `aria-expanded` and `aria-controls`.
- Choosing a composition from a drawer closes it and moves focus to the canvas heading. On wider screens, focus stays on the item chosen.
- Version radios move with the arrow keys. Focus is visible (`:focus-visible`).
- A polite live region announces each change.

**Evidence:**
- `e2e/composer-library.spec.ts`, 12 tests, added to the experimental suite CI runs:
  - real rendering;
  - versions;
  - scenario, state and refusal;
  - needs-recheck;
  - actions and sensitive values;
  - storage isolation, persistence and recovery;
  - keyboard;
  - 1280 and 390 layout;
  - axe (WCAG 2.2 AA) at both widths.
- **No accessibility exception.** Axe once reported `aria-required-children` inside the rendered Astryx surface (Astryx's `List` held option cards without list items). #128 fixed it in the List adapter, and the Library spec now allows no violation at either width.
- **Isolation tests.** `lib/compositions-isolation.test.mjs` now allows the composition runtime only under `apps/composer/experimental/`, and checks that the directory is aliased away in a default build.
- **Default artifact check.** It covers the new markers. The default build passed it: 29 files, 19 markers.

## Corrections after the independent review (R1 to R4)

| Finding | Correction | Regression test (`e2e/composer-library.spec.ts`) |
|---|---|---|
| **R1.** A checked draft read as approved | "Approved" is reserved for a version's status. Runtime results read **Checks pass**, **Checks fail** or **Needs a new check**. A draft says it is not approved for use by agents and that passing checks does not approve it; under changed rules it was "last checked", never "approved". The device record speaks of checks | "R1: passing checks never reads as approval; a draft stays a draft": every line of the workspace that mentions approval is a version status or a statement that something is not approved |
| **R2.** The what-if left the canvas and the inspector contradicting each other, and Restore did not restore | One result per version and rule set, which both read. A rules change gives each host back only an approval a check under exactly those rules issued for exactly that version, with matching pins; otherwise nothing new is shown until checked. Restore therefore re-authorizes with the packaged check. What-if checks are never stored | "R2: the canvas and the inspector report one result…": unchecked, a failing check and a passing check under the what-if, then the restore, for both compositions; the contract shown is unchanged and the stored approval records are byte-identical |
| **R3.** Phone drawers did not contain focus | Below 900 px an open panel is a `dialog` with `aria-modal`, named by its heading. Everything behind it is inert, including the app header. Tab and Shift+Tab cycle inside it. Escape and Close return focus to the toggle. Wider screens keep non-modal side panels | "R3: on a phone…" (12 Tabs and 12 Shift+Tabs stay inside; header and canvas inert, then restored) and "R3: wider screens keep side panels non-modal" |
| **R4.** Pressing an action gave no visible feedback | A **Preview only, not run** note pinned to the bottom of the visible canvas, with the redacted payload and a Dismiss button. The live region is kept | "R4: action feedback appears inside the visible working area…": the note is in the viewport after pressing the first card's button and after scrolling to the last |

The R tests run against the uncorrected Library fail on all four findings ([m1/review-corrections-failing-first.txt](m1/review-corrections-failing-first.txt)). Some of those failures are on the new wording, so they are regression guards; the defects themselves are reproduced in the review.

Two of the owner's approved decisions are applied at the same time: the workspace bar names the **Library · Astryx sample**, and the retained last valid instance sits behind a closed disclosure marked **not interactive**.

## Limits that remain

- **Hotel names on option cards** are drawn since D1 (#125) merged.
- **The Library is read-only.** Authoring, running actions and flows, and publishing are named and not built.
- **One design system** (Astryx), two compositions, one draft.
- **A rule change re-checks every composition**, not only those a rule affects. Rule coverage is deferred in M1.
- **The what-if is the only way to reach "Needs a new check" in the Library**, because the packaged rules do not change while it runs.
- **Designer-first refinements** are implemented as D0, which awaits the owner's evaluation and the designer sessions ([m1/d0/README.md](m1/d0/README.md)). They are:
  - a fixed workspace frame;
  - less chrome above the instance;
  - plain-language refusals;
  - human scenario names;
  - technical details behind a disclosure;
  - first-run guidance.
- **The workspace has only Composer's existing dark appearances** (Aesthetic Function, Ember and Slate, in Settings) during D0. This is temporary. A neutral, customizable working environment is a requirement before broad external designer evaluation (decision 28). Workspace themes through the shared compiler are planned in [THEME-INTEGRATION-PROPOSAL.md](THEME-INTEGRATION-PROPOSAL.md).
- **Sensitive fields are drawn unmasked.** Masking is required before real sensitive inputs are supported (owner decision). Only synthetic values are used here.
- **Focus inside a repeated element** across a replacement is still verified as the host's hint only. The Library shows one instance per selection.

## Decisions taken

The owner's decisions on the review (§11) are recorded at the top of [M1-WORKSPACE-REVIEW.md](M1-WORKSPACE-REVIEW.md).

## Next: composition authoring, and preparing for M2

Authoring A1 to A4 is implemented ([m1/authoring/README.md](m1/authoring/README.md)). What follows is the list as it stood before it.


1. **Authoring, smallest first.**
   - Edit a draft's parameters and scenarios in the inspector, through `editComposition`, stored as a draft record.
   - **Approve** runs `recheck` and promotes nothing until it passes.
   - **Promote** a block to a composition (M1 step 9).
2. **Discovery for agents.** List the Library's approved versions with their purposes and scenarios as a machine-readable index: the input for task planning and later ds-mcp.
3. **M2 Playground groundwork.**
   - Run a flow through one host per session, in one renderer session (as the R1a demonstration does), with the consequential lifecycle and a simulated tool declared as such.
   - A timeline from the host log.
   - Only redacted events recorded.
4. **Task planning and completeness** (M1 step 14), before any paid evaluation.
5. **Getting-started documentation** (a recorded future requirement, decision 25). Concise docs with working examples, not an extensive documentation suite.
