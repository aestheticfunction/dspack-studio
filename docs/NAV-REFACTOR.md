# NAV-REFACTOR: Scenario × Operation independence in the Studio

## Context

From Recipe co-editor or Appointment booking, clicking "restyle it" or "break
it on purpose" shows Project Deletion content. The visitor's active scenario
appears to be silently discarded. The Studio's target model is two independent
axes — **scenario** (the document: `recipe-creator`, `appointment-booking`,
`project-deletion`) and **operation** (the lens: Replay, Run Live, Break It,
Restyle, X-ray, Fork/diff). Switching operations must never switch scenarios;
switching scenarios must preserve the operation where valid.

## 1. Root cause (with evidence)

**It is a coverage/wiring gap, not a routing/state reset.** There is no
redirect or reset code anywhere; the scenario state is never touched by an
operation switch. Two operation views simply ignore the active scenario and
always render Project Deletion content, which reads to the visitor as a silent
scenario switch.

Scenario and operation are already independent state in the shell
(`apps/web/app/studio.tsx`):

```tsx
const [scenarioId, setScenarioId] = useState(readyScenarios[0]?.id);
const [view, setView] = useState<"replay" | "live" | "break" | "canvas">("replay");
```

No `setView(...)` call site touches `scenarioId` (the only writers of
`scenarioId` are the shelf buttons, the deep-link parser, and the tour). The
bug is downstream, in what two of the four views render:

**Conflation point A — Restyle ("canvas") hardcodes one scenario's surface.**
`studio.tsx` imports
`@dspack-studio/contracts/out/delete-project-confirmation.surface.json`
statically and renders it in the `view === "canvas"` branch without reading
`scenario`. Whatever scenario is active, Restyle shows the project-deletion
confirmation dialog.

**Conflation point B — Break It inverts the axes: the condition picks the
scenario.** The shell mounts `<BreakView />` without the scenario, and inside
(`apps/web/app/break-view.tsx`):

```tsx
const [conditionId, setConditionId] = useState(breakConditions[0].id);
...
const scenario = useMemo(() => scenarios.find((s) => s.id === condition.scenarioId)!, [condition]);
```

`breakConditions[0]` is `no-alertdialog`, a project-deletion condition, so
opening Break It always lands on Project Deletion, and offline it replays
project-deletion's `argues-back` fixture as the recorded catch. The operation's
own sub-state (`conditionId`) determines the effective scenario — exactly
backwards from the target model.

**Why it masks a coverage gap:** every break condition with a `recordedCatch`
points at a project-deletion fixture. Recipe and booking each have exactly one
break condition (`invalid-state`, `ambiguous-action`) and both are live-only.
Restyle likewise "works" only because the one hardcoded surface happens to
exist. The hardcoding hides that per-scenario support is thin everywhere
except Project Deletion.

For contrast, the two views that ARE wired correctly: Run Live
(`<LiveView key={scenario.id} scenario={scenario} />`) is fully
scenario-driven, and Replay (`<ReplayPane scenario={scenario} …/>`) already
carries an honest empty state: *"No recordings yet for this scenario: open a
session file, or run it live and download one."*

## 2. Current architecture

- **Scenario** = `scenarioId` (React state in `Studio`), canonical ids from
  `packages/scenarios/src/registry.ts`: all six ready — `recipe-creator`,
  `appointment-booking`, `project-deletion`, `support-triage`,
  `onboarding`, `hotel-reservations`. No planned entries remain.
- **Operation** = `view` state: `"replay" | "live" | "break" | "canvas"`.
  X-ray and Fork/diff are not top-level views: they are controls inside
  `RunView` and operate on whatever run is loaded — already
  scenario-independent.
- **Permalinks** encode scenario + replay coordinates only; deep links force
  `setView("replay")`. Operation-aware permalinks are added as Phase 1.5.
- Conflations: points A and B above. That is the complete list — no other view
  reads Project Deletion implicitly.

## 3. Target architecture

**No state-model change is needed.** `scenarioId` and `view` are already the
two independent axes, held in the shell. The fix is wiring: every operation
view receives the active `scenario` and renders that scenario's content — or
an explicit, honest statement of what's missing. Concretely:

- `BreakView` gains a `scenario: Scenario` prop (mounted with
  `key={scenario.id}`, same pattern as `LiveView`). Its condition list is the
  active scenario's conditions plus scenario-independent ones; the condition no
  longer selects the scenario.
- The Restyle branch gains the scenario and renders the active scenario's own
  governed surface (below).
- **Invariant, including in URLs:** the scenario always wins. A deep link
  naming a scenario and a condition that does not belong to it resolves to the
  named scenario's valid default with a stated link error — it never switches
  the scenario to fit the condition.

## 4. Which operations become universal

- **X-ray — already universal.** A `RunView` control fed by
  `nodeHistoryAt`/`findingsAt` over the loaded event stream; identical on any
  fixture, live run, import, or fork. No change.
- **Fork/diff — already universal.** `forkFixture` + `BranchCompare` fold off
  the loaded events. Fork *continuation* is live-only (agent required) — that
  is inherent, not a gap.
- **Restyle — becomes universal by reading the loaded scenario.** Render the
  active scenario's canonical surface: parse `scenario.fixtures[0]`, take the
  final A2UI messages via `a2uiMessagesAt` (already exported from
  `@dspack-studio/replay`), and feed them to the existing themed
  `<A2uiCanvas>`. Structure-invariant, works for every scenario that has a
  recording — including future ones — with zero per-scenario wiring and zero
  new build artifacts. Scenarios with no fixtures get the honest empty state.
  (Considered and rejected: a static map scenario → emitted contract surface —
  also static-safe, but a hand-maintained table that shows the deterministic
  start surface rather than the surface the visitor just watched ship.)
- **Break It — universal shell, per-scenario data.** The view machinery is
  already scenario-neutral; only condition selection is miswired. The
  `malformed-import` condition is client-side (`importFixture` is a pure
  function: JSON.parse + shape validation, no scenario reference, no network,
  and its branch never reaches `start()`); its project-deletion tag is
  vestigial. It becomes `scenarioIndependent: true` — a separate boolean, not
  a sentinel scenario id — and is offered under every scenario.

## 5. Honest states instead of implicit redirects

There is no literal redirect to remove; the honest-state copy mostly already
exists and is reused, matching the README's break-conditions tone:

- Break It, condition with no recorded catch, agent offline — keep the
  existing copy verbatim: *"This condition runs the pipeline for real and
  needs the local agent (`pnpm --filter agent dev`). No recording substitutes
  for it."*
- Break It, scenario with no conditions (unreachable today; future-proofing):
  *"No curated failure conditions for this scenario yet. The rest is authored
  per scenario."*
- Restyle, scenario with no recording: mirror ReplayPane's line: *"No recorded
  surface for this scenario yet: run it live and download a session, or pick a
  scenario with a recording."*
- Deep link with a cross-axis mismatch (Phase 1.5): *"that link did not fully
  resolve: '…' is not a failure condition for <scenario name>. Showing this
  scenario's conditions instead."*

## 6. Coverage matrix (from the actual fixtures and code)

Legend: **recorded** = replays with no agent · **universal** =
structure-invariant, no per-scenario fixture needed · **live-only** = needs the
local agent · **gap** = no support yet. Cells marked † change with this work.

| Scenario ↓ / Operation → | Replay | Run Live | Break It | Restyle | X-ray | Fork/diff |
|---|---|---|---|---|---|---|
| `recipe-creator` | **recorded** (fixture-006) | **live-only** (interactive: `deterministic:authored` start + `recipeRespond`; "generate live" via local model) | `invalid-state`: **live-only** today → **recorded** catch† | **gap** today → **universal**† via fixture-006 final surface | **universal** | **universal** (fork recorded run; continuation live-only) |
| `appointment-booking` | **recorded** (fixture-005) | **live-only** (interactive: `bookingRespond`) | `ambiguous-action`: **live-only** today → **recorded** catch† | **gap** today → **universal**† via fixture-005 | **universal** | **universal** (continuation live-only) |
| `project-deletion` | **recorded** ×3 (fixtures 001/002/003) | **live-only** (generation: `scripted` deterministic or `ollama:*`) | `no-alertdialog` **recorded** (catch=argues-back) · `ok-label` **recorded** (argues-back) · `unsupported-component` **recorded** (refusal) · `malformed-generation` **live-only** (scripted, needs agent) | **recorded** today (the hardcode) → **universal**† via fixture-001 | **universal** | **universal** |
| *(any scenario)* | — | — | `malformed-import`: **universal** (client-side validator; mislabeled project-deletion → `scenarioIndependent`†) | — | — | — |
| `support-triage` | **recorded** ×2 (fixtures 010/011) | **live-only** (generation: `scripted` deterministic or `ollama:*`; zero agent code, same as project-deletion) | `records-as-prose` **recorded** (catch=argues-back) | **universal** via fixture-011 final surface | **universal** | **universal** |
| `onboarding` | **recorded** ×3 (fixtures 012/013/014) | **live-only** (generation: `scripted` deterministic or `ollama:*`; zero agent code) | `ask-without-a-form` **recorded** (catch=argues-back) | **universal** via fixture-012 final surface | **universal** | **universal** |
| `hotel-reservations` | **recorded** ×2 (fixtures 015/016) | **live-only** (generation: `scripted` deterministic or `ollama:*`; zero agent code) | `review-without-options` **recorded** (catch=argues-back) | **universal** via fixture-015 final surface | **universal** | **universal** |

Unused asset worth noting: `packages/replay/fixtures/fixture-004.json`
("Scheduling, generated live", intent `scheduling`, 12 events) is bundled but
referenced by nothing in `registry.ts`. It is a clean generation, not a catch —
it could join `appointment-booking.fixtures` as a second recording, but it does
not fill any Break It gap.

## 7. Per-scenario content work

Recording uses the existing recorder path (`apps/agent/src/record-fixture.ts`);
the catches for recipe/booking are deterministic (authored start + scripted
responders), so no model call is required.

1. `appointment-booking` × Break It: record a real `ambiguous-action` catch →
   add `recordedCatch` + register the fixture. **Ships with phases 1–2.**
2. `recipe-creator` × Break It: record a real `invalid-state` catch → same
   wiring. **Ships with phases 1–2.**
3. `project-deletion` × Break It `malformed-generation`: optionally record the
   scripted run (`mode: "scripted"`, labeled honestly) so it too replays
   offline. *Optional.*
4. Optional: register fixture-004 as a second `appointment-booking` recording.
5. Planned scenarios: unchanged — they need owner-authored contract governance
   plus a recorded run before any cell exists; the shelf already states this.

## 8. Phased change list (each phase its own review-gated PR)

Test discipline for every phase that changes pinned behavior: write the new
expected assertions first, run them against the old code, confirm they fail
for the expected reason, then change the behavior, then confirm they pass.
Content assertions (e.g. that the recorded catches replay their actual catch)
are never loosened.

### Phase 1 — Break It reads the active scenario
- `packages/scenarios/src/break-conditions.ts`: `scenarioId` becomes optional;
  add `scenarioIndependent?: boolean`; `malformed-import` drops its vestigial
  project-deletion tag and becomes `scenarioIndependent: true`.
- `apps/web/app/break-view.tsx`: accept `scenario: Scenario` and an optional
  `initialConditionId` (used when valid; the deep-link plumbing that feeds it
  arrives in Phase 1.5); conditions =
  `breakConditions.filter(c => c.scenarioIndependent || c.scenarioId === scenario.id)`;
  default to the first; delete the condition→scenario derivation.
- `apps/web/app/studio.tsx`: `<BreakView key={scenario.id} scenario={scenario} />`.
- e2e: `break.spec.ts` selects the condition's scenario first and gains
  scoping tests (conditions of other scenarios are absent; the
  scenario-independent demo is present everywhere); `break-offline.spec.ts`
  gains scenario preconditions with all catch-content assertions intact.

### Phase 1.5 — operation-aware permalinks
- `permalink.ts`: `v=replay|live|break|canvas` and `bc=<conditionId>`,
  validated like `panel`.
- `studio.tsx` deep-link effect: set the view from the hash; feed
  `initialConditionId` to BreakView. The scenario always wins on cross-axis
  mismatch (§5 copy); the studio lands on the named scenario's valid default.
- BreakView: copy-link affordance for the recorded-catch state.
- e2e: permalink round-trip cases including the mismatch fallback.

### Phase 2 — Restyle reads the active scenario
- Extract the `view === "canvas"` branch into `apps/web/app/restyle-view.tsx`
  taking `scenario` (same UI, no redesign); derive messages from
  `parseFixture(scenario.fixtures[0].fixture)` + `a2uiMessagesAt`; keep the
  theme dial, FM-5 caption, and dispatched-actions log; add the no-recording
  honest state.
- Remove the `delete-project-confirmation.surface.json` import from studio.tsx
  (keep emitting it in `packages/contracts/src/build.ts` — it feeds the A3
  gate).
- Note for review: interactive scenarios' FINAL surfaces (e.g. booking's
  post-confirmation end-state) are what gets themed; flagged deliberately.

### Phase 3 — recorded catches for recipe and booking
Items 1–2 of §7: record the catches, add `recordedCatch` entries, register
fixtures, extend `break-offline.spec.ts` to assert the new recorded catches
replay their catch content. Ships with phases 1–2.

### Non-goals
- No shelf or view-switcher redesign; no changes to `apps/agent` or
  `packages/agui-bridge` for navigation (the redirect does not originate
  upstream — the agent's scenario registry is keyed correctly).

## 9. Verification

1. `pnpm build:contracts && pnpm dev` (no agent, no keys): select Recipe
   creator → click through replay / break / restyle → every view shows recipe
   content or an honest recipe-specific state; shelf highlight, tagline, and
   content always agree. Repeat for booking and deletion; switch scenarios
   inside break and restyle and confirm the operation is preserved.
2. Offline break checks (no agent running): each ready scenario replays at
   least one recorded catch labeled as such; conditions without one show the
   "needs the local agent" line; the malformed-import demo works under every
   scenario.
3. `pnpm e2e` against the static export (zero model calls) — full suite green.
4. With the local agent: run live + break-dispatch flows for recipe and
   booking still round-trip.
