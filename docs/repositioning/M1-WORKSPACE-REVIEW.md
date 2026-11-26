# M1 workspace review: UX/UI and implementation fidelity

Reviewed independently on 2026-11-26, against the approved canvas-first prototype (`prototypes/composer-workspace.html`).

**Status:** accepted by the owner with targeted revisions. The six decisions in §11 are approved, with clarifications: "Checks pass / Checks fail" for runtime results, "Approved" for a person's decision on an exact version, "Published" for a later capability; local approvals labelled "Approved on this device"; the Library labelled as the Astryx sample Library. R1 to R4 are corrected before #127 merges (see [M1-WORKSPACE.md](M1-WORKSPACE.md)); the list-semantics fix is its own pull request.

## Context

The owner asked for a focused design, UX/UI and implementation-fidelity review of the first visible workspace increment before composition authoring starts. This is the checkpoint reserved for comparing what was built with the approved canvas-first prototype. It is read-only: nothing was changed, pushed, merged or deployed, and no model was called.

**State verified.** #125 (`0924243`), #126 (`cdbbae7`) and #127 (`4f4de16`, stacked on #126) are open, mergeable and green. `main` is still `4487794`.

**What was reviewed.** A combined #125 + #126 + #127 experimental build, made locally from an unpushed merge. I served it locally and drove it in Chromium at 1440, 1280, 1024 and 390 px. I measured the approved prototype the same way for comparison, and read `library.tsx`, the D1 adapter and the List adapter.

**Evidence tags.** **[V]** verified in the running build or at the line cited. **[P]** design preference. **[O]** outside the authorized scope, noted only.

Screenshots of the corrected workspace are in [m1/screenshots/](m1/screenshots/).

---

## 1. Verdict

**Accept with targeted revisions.**

- **#126 (storage and versions): accept as it stands.**
- **#127 (Library): accept after four small corrections** (§7). All four are in `library.tsx` and its spec. None questions the architecture or the layout.
- **#125 (D1): merge as implemented** (§6).

The increment does what it was meant to prove. The approved workspace survives contact with the real pipeline: real governed instances on Composer's own canvas, versions side by side, refusals with the rule, and honest "not yet available" labels. It is visually coherent with the product. It is not yet a designer's tool: it speaks the pipeline's vocabulary, and two of its states contradict themselves.

---

## 2. Against the approved prototype and acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| Canvas-first layout | **Met** | Canvas is the centre column at every width; panels are secondary and collapsible **[V]** |
| ≥ 60% canvas at 1280 px with one side panel | **Met** | 78.7% with Compositions open, 73.4% with Inspector open. Prototype: 76% and 73.6% **[V]** |
| One side panel below 1440 px (decision 18) | **Met** | Opening one closes the other at 1280 and 1024 **[V]** |
| 1440 px with both panels | **Not a failed criterion** | 57.5% (828 px). The prototype gives 58.8% (846 px) in the same state. The 60% floor is defined for one panel at 1280. Narrowing the inspector from 340 to 320 px would match the prototype **[P]** |
| 1024 px | **Met** | 73.4% and 66.8%; no overflow **[V]** |
| Canvas-first at 390 px | **Met in structure, weak in practice** | Panels are closed drawers and the canvas column comes first, but the rendered instance starts at y = 589 of 844. The prototype's starts at about 360 **[V]** (finding L4) |
| Collapsible, responsive panels | **Met** | |
| Keyboard navigation and visible focus | **Met, with one defect** | Drawers at 390 px do not contain focus (finding R3) **[V]** |
| Contextual, non-intrusive diagnostics | **Partly met** | The inspector holds them, but the canvas status line and the refusal box carry raw pipeline text (L2, L3) |
| Future capabilities clearly unavailable | **Met** | "Compose · Playground · Publish not yet available", no control **[V]** |
| Real composition, real rendering path | **Met** | `A2uiCanvas` with the Astryx registry and scope, through the R1a host **[V]** |
| No simulated functionality presented as real | **Met** | Actions say "shown, not run" **[V]** |

**Differences from the prototype that matter.**

- **Two navigation bars.** The prototype has one top bar. The build keeps the existing app header and adds a workspace bar under it (L5).
- **The page scrolls as a whole.** The prototype is a fixed frame whose panels scroll on their own. Here the workspace bar and the inspector scroll away with the canvas (L1).
- **More chrome above the instance.** 312 px at 1280 × 800, against about 220 in the prototype (L4).
- **The instance stretches to the canvas width.** The search form is 976 px wide at 1280. The prototype centres the surface at about 560 px (L6).

---

## 3. Findings, prioritized

### Required before merging #127

**R1. A re-checked draft is described as approved. [V]**
- **Where:** `library.tsx`, the inspector's "On this device" line and the needs-recheck message.
- **Seen:** with **v2 Draft** selected, the inspector says "On this device: the first approval of this version was recorded." Under the what-if, the canvas says "The rules changed since Hotel results v2 was approved".
- **Why it matters:** this is the confusion the owner asked me to rule out. The runtime re-check passing (the host's `Approval`) and the version's status (`approved`) are different things, and the interface uses "approval" for both. Authoring will add a real Approve action, so the words must be settled first.
- **Fix:** in the interface, reserve "Approved" for the version's status. Call the re-check result "Checks pass" (or "Checks fail"), for drafts and approved versions alike. For a draft: "Checks pass. Still a draft: not approved for agents." Change "was approved" to "was last checked". Core type names can stay.

**R2. The what-if leaves the canvas and the inspector contradicting each other, and "restore" does not restore. [V]**
- **Reproduction:** Inspector, What-if. Select Hotel search, **Re-check this version**: it passes and the canvas shows the governed instance, but the inspector still says "Under the what-if rules this version needs a re-check before anything runs." Then **Restore the packaged rules**: the canvas now says "Needs re-check before anything runs", while the inspector says "Re-checked on load: 2 of 2 scenarios behave as declared under the packaged rules."
- **Cause:** the inspector's status reads the `governed` flag, not the host's answer. A passing what-if re-check replaces the host's packaged approval (`recheckNow`), and `changeRules` never puts it back.
- **Fix:** derive the inspector's status from the same result the canvas shows (the last `show` or re-check for this version). On restore, re-approve each host with the packaged check held in `ready.checks`. Add both paths to the spec.

**R3. Drawers at 390 px do not contain focus. [V]**
- **Seen:** with the Inspector drawer open, Tab leaves it after two stops, passes the header and bar, and lands on the scenario and state selects and the instance's fields behind the drawer and scrim. The drawer is an `aside` with no dialog role; the canvas is not inert.
- **Why it matters:** focus lands on controls the drawer covers (WCAG 2.2 SC 2.4.11, and the project's AA target).
- **Fix:** while a drawer is open at the narrow layout, set `inert` on the canvas and the other panel, and give the drawer `role="dialog"`, `aria-modal="true"` and its heading as its name. Escape and focus return already work.

**R4. Pressing an action gives no visible feedback. [V]**
- **Seen:** at 1280 × 800, pressing "Choose Casa do Rio" puts the "would send…" note at y = 1084, below the fold. Only the live region reports it.
- **Fix:** show the note above the instance frame, next to the status line, or scroll it into view.

### Library, inspector and versions: follow during authoring

**L1. The workspace is not a fixed frame. [V]** After scrolling 600 px, the workspace bar is off screen and the inspector has scrolled with the page. Authoring needs the inspector beside what it edits. Make the workspace viewport-height: bar pinned, the three columns scrolling independently. Do this first in the authoring increment.

**L2. Expected refusals look like errors. [V strings, P presentation]** Scenario "one" is declared as a refusal and passes its check, yet the canvas shows a red "Not shown: refused by the design system's rules". Distinguish the two cases:
- **Refused, as this scenario declares:** neutral tone, "This is the expected result."
- **Refused unexpectedly:** error tone, with what to do: "Change the scenario's data, or the rule in Governance."

**L3. Pipeline vocabulary on the working surface. [V]**
- Scenario names are raw ids ("three", "one", "confirm"). Add an optional scenario `title` to the schema during authoring; until then, sentence-case the id.
- The status line says "governed: S1–S3 and A1–A3 pass". Say "Passes all checks", with the gate names in the inspector.
- The refusal leads with the lint message ("Required sub-component 'selectable-card' (min 2) not found among descendants"). Lead with the rule's rationale; put the rule id and raw message under "Details".
- The inspector shows the definition hash, contract hash and toolchain versions at the same level as the summary. Move them under a closed "Technical details" disclosure.
- The State menu offers states the chosen scenario cannot reach, and choosing one produces a refusal. Mark them "(not reachable with this scenario)" or disable them.

**L4. Too much chrome above the instance. [V]** 312 px at 1280 × 800 and 589 px at 390 × 844. Put the breadcrumb, title, version, scenario and state in one toolbar row. At 390 px, drop the "not yet available" line into a menu and place scenario and state side by side.

**L5. Navigation hierarchy. [V]**
- "Library" appears three times: primary nav, workspace bar and breadcrumb.
- With a project open, the primary nav has nine items on two rows, and a shadcn project's chip ("Billing · shadcn/ui") sits beside a Library of Astryx compositions.
- For now: label the Library's scope in the workspace bar ("Astryx sample"), and drop the breadcrumb's "Library /". The single-bar consolidation belongs to the workspace cutover **[O]**; the scope question is an owner decision (§11).

**L6. The instance fills the canvas width. [V, P]** Centre it with a maximum width (about 640 px), and add a width control later.

**L7. The retained instance. [V, P]** A refused selection shows "The last valid instance, which stays on screen in a running flow", dimmed to 55% and inert. The distinction from a live instance is clear enough when you read the caption, and it is correctly non-interactive. But in the Library the "last valid instance" is simply whatever you looked at before, often another scenario. That is a Playground behaviour. Collapse it under a disclosure here, and give the frame a visible "Kept · not interactive" tag wherever it stays.

**L8. Heading outline. [V]** The workspace has no `h1`; the only `h1` on the page is the rendered instance's own heading. Give the workspace an `h1` ("Composition Library", visually hidden is fine).

**L9. The what-if control. [P]** It is a diagnostic living among governance facts. Keep it, renamed "Try a rule change (this session only)", until rule edits arrive through Governance.

### Product or workbench

| Feels like a product | Still a workbench |
|---|---|
| The composition list with summaries and version badges | Scenario ids as names |
| The version switch, and the draft note ("v1 is unchanged") | "S1–S3 and A1–A3", hashes and toolchain versions in the main inspector |
| The "not yet available" labelling | The refusal box's raw lint message |
| The typography, colour and spacing, which match Composer | Two stacked navigation bars, and a page that scrolls as a document |
| The sensitive value shown as `[sensitive]` | The what-if button and its contradictory states |

A product designer can find a composition, switch versions and see a refusal without help. They cannot yet tell, without knowing the architecture, why a draft was "approved", what "three" contains, or what to do about a refusal.

---

## 4. Responsive and accessibility findings

| Width | Result |
|---|---|
| 1440 | Both panels may be open; canvas 828 px (57.5%), in line with the prototype. Comfortable |
| 1280 | One panel; canvas 78.7% or 73.4%. Passes the 60% floor |
| 1024 | One panel; canvas 752 or 684 px. Controls stay on one row. No overflow |
| 390 | Canvas first, drawers with a scrim, Escape closes and returns focus, a chosen composition moves focus to the canvas heading. No horizontal scroll. Weak points: R3 and L4 |

- **Focus on wider screens.** Opening a side panel leaves focus on its toggle. That is correct for a non-modal panel. Choosing a composition keeps focus on the item **[V]**.
- **Names and order.** Selects, the filter and the version group are named; toggles carry `aria-expanded` and `aria-controls`; reading order is bar, list, canvas, inspector **[V]**.
- **States.** Loading (about 1.3 s, with a status message), an empty filter result, refusal and needs-recheck all exist and are announced. The storage-problem note appears only in the inspector, which is right.
- **Focus retention across replacement** is not exercised by the Library: it shows one instance per selection. It remains to verify in the Playground **[O]**.

**The Astryx list violation.** Astryx's `List` renders `ul role="list"`, and Composer's `ListRender` puts the built children straight into it. In the running build the list's children are `span` wrappers, not list items **[V]**. The smallest correction is in Composer's adapter, not Astryx: `ListRender` wraps each child in an `li` with `list-style: none`. The list is a flex column, so layout should not change. Then remove both named exceptions: the `KNOWN` entry for `ex.plan-comparison` in `e2e/composer-blocks-a11y.spec.ts`, and the `.astryx-list` exception in `e2e/composer-library.spec.ts`. It reaches the default renderer, so it is its own small PR with a before-and-after screenshot and the axe result. No broader exception is needed.

---

## 5. Composition and governance communication

| The Library should communicate | Does it |
|---|---|
| What a reusable composition is | Partly. One sentence in the list panel; "definition the agent fills with data" is right but easy to miss |
| Which version is inspected | Yes: title badge, version switch, inspector |
| Approved definition versus draft | Yes for status; the draft note is good |
| Runtime re-check versus approval for agents | **No** (R1) |
| Which scenario and state are instantiated | Yes, but by raw ids (L3) |
| Why an instance was refused | Yes in substance; too raw in form (L3) |
| What to do about a refusal | **No**, and expected refusals look like faults (L2) |
| Which actions are preview-only | Yes in words; not visible when pressed (R4) |

The level of abstraction is one step too low for designers throughout. The technical detail is valuable and should stay, one disclosure deeper.

---

## 6. D1 renderer correction (#125)

**Verdict: merge as implemented.**

- **Visible names:** the hotel cards show "Casa do Rio", "Hotel Miradouro", "Lumen Chiado"; the plan comparison shows "Basic" and "Pro" **[V]**.
- **Accessible names:** each card is still `checkbox "<name>"`, announced once; the drawn name is hidden from assistive technology **[V]**. Visible text and accessible name match.
- **Keyboard:** the checkbox takes focus and Space, with no error; selection is delivered state in replay, as before **[V]**.
- **No duplicate naming:** nothing is added where a child `Text` already shows the name. The hotel card shows the name and "Choose Casa do Rio", which is appropriate: the button needs its own specific name.
- **The mismatch is resolved correctly:** the contract's reading of `label` as the visible name now holds on screen, without changing Astryx, the contract or its digest.

Two notes, neither blocking:
- **Spacing [P]:** the name sits tight against the first row. A 4 to 8 px gap below it would read better.
- **Dedupe is literal [V by reading]:** only a `Text` whose literal text equals the label counts. A bound text would not be detected. Nothing produces one today.

**Sensitive fields, for later [O].** When real sensitive inputs are supported: draw the field masked with a reveal control, keep the "not kept after this step" hint beside it, and mark it "sensitive" in the inspector's input list. Masking is presentation only; the redaction and storage rules already in place remain the safeguard.

---

## 7. Required before merging

- **#126:** nothing.
- **#125:** nothing.
- **#127:** R1 to R4, each with a spec assertion:
  1. R1: draft and re-check wording.
  2. R2: what-if status from the host's result; restore re-approves with the packaged check.
  3. R3: drawer focus containment and dialog semantics at the narrow layout.
  4. R4: visible action feedback.

## 8. Safe to follow during authoring

L1 (fixed frame, first), L2, L3, L4, L6, L7, L8, L9, the list-semantics PR, and the 320 px inspector at 1440.

## 9. Merge sequence

1. **#125** first. It is the smallest and the only one that changes what production draws; verify the deploy and smoke as usual.
2. **The list-semantics PR**, when ready, the same way.
3. **#126.** No default-build change.
4. **#127**, retargeted to `main`, after R1 to R4 and a green run.

Every merge to `main` deploys production; #126 and #127 leave the default build unchanged.

---

## 10. Authoring handoff

**The smallest useful increment: draft, edit scenarios and parameters, check, approve on this device.** It extends the current workspace; no new shell.

**Standing rules.** The owner merges. No deploy, Cloudflare change, paid inference or sibling-repository change. Experimental build only; the default artifact check must stay clean. Synthetic data only. Persist drafts and records through `storage.ts`; never events, values, sessions or commitments.

| Step | What | Reuse |
|---|---|---|
| A0 | R1 to R4 on #127, then L1 (fixed frame) and the wording from L2 and L3 | `library.tsx` |
| A1 | **Create draft.** On an approved version with no draft: "Create draft v{n+1}". "Discard draft" on a draft | `editComposition` (`versions.ts`) forks; the `drafts` record in `storage.ts`; `loadLibrary` (`runtime.ts`) merges packaged versions and stored drafts through `createLibrary` |
| A2 | **Edit in the inspector, drafts only.** Details (name, summary); Parameters (one control per declared parameter); Scenarios (add, duplicate, remove; title; expected result: shown, or refused by a rule chosen from the contract; data as a form for scalars and a validated JSON field for lists and objects) | Each edit goes through `editComposition`; data is validated by the composition's own data checks (`expand.ts`); a new host per edited draft (`hostFor`) |
| A3 | **Run checks.** A button and an "edited since last check" marker; results in the existing scenario table | `checkVersion` |
| A4 | **Approve.** Enabled only when checks pass under the packaged rules. An inline confirmation: "v2 becomes immutable; v1 stays available." | New in core: `approveDraft(library, id, version)`, returning a library with that version approved. Its hash changes, so re-check before any host uses it. A new storage record kind for versions approved on this device |

**Not in this increment:** declaring inputs and actions (it needs element selection on the canvas and the prototype's Structure view), template editing, and promoting a block (`upcastBlock` exists; block actions are still unmapped). They are the next increment.

**Tests.** Unit: fork, edit and approve keep approved versions byte-identical; stored drafts survive reload and recover from a malformed record. Browser: create a draft, break a scenario, see the refusal, fix it, check, approve, reload. Default build: artifact check and smoke unchanged.

## 11. Decisions for the product owner

| # | Decision | Recommendation |
|---|---|---|
| 1 | Vocabulary: "Checks pass" (runtime), "Approved" (a person's decision on a version), "Published" (later) | Adopt |
| 2 | What Approve means before Publish exists | Approved on this device, labelled so, distinct from packaged versions |
| 3 | The Library's scope when a project on another design system is open | Label the scope now; decide project-scoped libraries with the workspace cutover |
| 4 | Whether the retained instance belongs in the Library | Behind a disclosure here; first-class in the Playground |
| 5 | The list-semantics fix: its own PR, or a second commit on #125 | Its own PR, so #125's verified head stands |
| 6 | R1 to R4 before #127 merges, or as the first authoring commit | Before: authoring builds on these words and states |

---


## How to check the main findings

Build the three branches together locally (never pushed), then `COMPOSER_OUT_DIR=out-experimental PORT=3315 node e2e/serve-composer.mjs` and open Library.

- **R1:** Hotel results, **v2 Draft**, open the Inspector, read "On this device".
- **R2:** Inspector, What-if; choose Hotel search; Re-check; read the inspector. Then Restore the packaged rules; compare the canvas with the inspector.
- **R3:** at 390 px, open the Inspector drawer and press Tab four times.
- **R4:** at 1280 × 800, press "Choose Casa do Rio" without scrolling.
- **L1:** scroll the page 600 px with the Inspector open.
