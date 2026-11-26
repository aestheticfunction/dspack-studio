# Live pilot report

**Status:** executed 2026-11-25, complete; accepted by the owner 2026-11-26, with the full baseline deferred (section 9). Counts corrected after acceptance; see "Corrections" at the end. Twelve of twelve runs, $0.71 of inference ($0.75 as the harness counts it), production restored. The scope, controls and commands are in [LIVE-PILOT-RUNBOOK.md](LIVE-PILOT-RUNBOOK.md); the evidence is in `acceptance/live-pilot/run-1/` (one JSON file per run, the request ledger, `state.json`, `SUMMARY.md`).

## 1. Recommendation

**Proceed into M1 through R1a as already scoped. Do not run the full baseline first.**

Inside a single screen, Claude Haiku 4.5 under Astryx's rules does the job: every build passed its gates, 79% on the first attempt, at about a fortieth of the pilot ceiling. What fails is everything between screens and everything a screen would have to do: data that changes from one step to the next, buttons that send nothing, dates typed as free text, and two prompts answered with the wrong shape. Those are the problems R1a exists to address (data supplied at instantiation, per-item action payloads, input binding, completeness checks), and none of them is a planning or generation weakness that more samples of today's pipeline would clarify. The baseline is cheap enough (section 6) to run after R1a against the pipeline that will actually ship.

In the proposal's decision table this is the row "builds pass but task fit is poor", scoped to fit across steps: "evidence for the M1 task plan and completeness checks; no more runs until those exist".

## 2. What ran

| | |
|---|---|
| Runs | Hotel request as a single build × 3; hotel request as a flow × 3; corpus prompt 3 × 2; prompt 10 × 2; prompt 5 as a flow × 2 |
| Builds | 34: 7 single builds (3 hotel, 2 corpus-03, 2 corpus-10) and 27 flow steps across 5 flows (3 hotel, 2 corpus-05), plus 5 flow plans |
| Provider calls | 80: 39 plans, 34 generations, 7 repairs. No Worker parse retries, no provider failures, no calls without usage |
| Model | `claude-haiku-4-5-20251001` on every call |
| Reference | Astryx |
| Duration | 41 minutes, paced at one request per 31 s for the gateway's 5-per-minute limit |
| Stops triggered | None. The run ended because the closed list of twelve was complete |

## 3. Generation and planning quality

**Gates.** 34 of 34 builds passed. 27 passed first time; 7 needed one repair request each, none needed two. The repaired builds: corpus 10 in both samples; the estimate summary that opens corpus 5 in both samples; the "Project created" step that ends corpus-05-1; the confirmation step that ends hotel-flow-3; and the reservation review, step 5 of 6, in hotel-flow-1. The evidence records that a repair happened but not which rule the first attempt broke; see section 7.

**Rendering.** Every build rendered natively. No component fell back to a wireframe and the emitter refused nothing. Components used: Button, Card, Column, List, MetadataList, SelectableCard, Table, Text, TextField, Badge, AlertDialog.

**Planning.** All five flow plans came from the model (no deterministic fallback) and all were sensible:

| Flow | Steps proposed |
|---|---|
| hotel-flow-1 | Search criteria → Hotel results → Hotel details and rooms → Room selection → Reservation review → Confirm booking |
| hotel-flow-2 | Search criteria → Browse results → Hotel details and rooms → Review reservation → Confirm booking |
| hotel-flow-3 | Search hotels → Browse results → Compare hotels → Select room → Review reservation → Confirm booking |
| corpus-05 (both) | Verify estimate → Enter project details → Review conversion → Confirm conversion → Project created |

Each hotel plan covers the five stages a person would expect (search, results, room, review, confirmation). hotel-flow-1 splits room choice across two steps that overlap; hotel-flow-2 folds room choice into the hotel details step. The intent chosen for each step fits it (data collection for the search, record collection for results, transactional review for review, destructive action for the final confirmation). All three single hotel builds were planned as a transactional review, the intent that best fits a one-screen booking.

**Latency.** Median provider call 2.9 s, 90th percentile 7.5 s, slowest 14 s. Wall-clock per build in `SUMMARY.md` is dominated by the 31 s pacing, not the model.

## 4. Task fit

**How each result is known.**

| Result | Status |
|---|---|
| Gates, repairs, models, tokens, cost | Verified: recorded by the harness from the production pipeline's own results and the provider's reported usage; cost also matches AI Gateway analytics |
| Rendering (native, wireframe, refusals) | Verified: recorded by the emitter and renderer registry for each build |
| Task fit (this section) | **Reviewer-assessed**: marked by the reviewer from the recorded surfaces, not by the owner or an independent check. `SUMMARY.md` keeps its checklists unmarked, as designed |

| Run | Checklist items present | Notes |
|---|---|---|
| hotel-single-1 | 8 of 8 | Three hotels with location, rating, price; three rooms; a summary; Confirm and Cancel |
| hotel-single-2 | 8 of 8 | Two rooms only |
| hotel-single-3 | 8 of 8 | Summary names a hotel and room the screen also shows as choices, so it is a mock-up of a later moment |
| hotel-flow-1 | 8 of 8 across steps | Explicit confirmation dialog at the end. Step 4 repeats room choice with different rooms from step 3 |
| hotel-flow-2 | 7 of 8 | No explicit confirmation: the last step is a guest-details form with a Confirm button. The reviewed hotel ("The Grandview Hotel") is not the one chosen in step 3 ("Grand Plaza Hotel") |
| hotel-flow-3 | 8 of 8 | The best of the six hotel runs: compare, choose a room, review with a price table, a confirmation dialog stating the charge |
| corpus-03-1, -2 | 4 of 4 each | Reference, status, service, jurisdictions, pricing, dates, documents, next actions, including "Create project from estimate" |
| corpus-10-1, -2 | 2 of 4 each | Asked for a reusable card for one file, with the filename primary. Both answers are a table of several files. Filename, type and size are there; the card shape is not, and empty values are shown as statuses |
| corpus-05-1 | 4 of 5 | Step 1 offers "Convert to invoice", not to a project, and describes locking line items into a billing record. Confirmation dialog, read-back of the created project present |
| corpus-05-2 | 4 of 5 | Same "Convert to Invoice" defect in step 1; the later steps are correct and the read-back is good |

**Across every hotel run:**

- **Dates and guests are free text.** Astryx as contracted has no date, number or select input (ASTRYX-D5B.md), so every date is a text field with a placeholder, and one flow mixes `MM/DD/YYYY` and `YYYY-MM-DD`. Expected, and a vocabulary limit rather than a model fault.
- **Data does not carry between steps.** Every step invents its own hotels, rooms and prices. The search results in step 2 do not contain the hotel shown in step 3 in two of three flows, and the reviewed booking differs from the chosen room in two of three. A model building one screen at a time from prose cannot keep this consistent; it needs the data supplied, which is R1a's "data arrives at instantiation".
- **Nothing is wired.** No button carries an action or payload, and every list item is told apart only by position. This matches R0 findings A2 and A3; the generation prompt does not ask for actions and the emitter writes none.
- **Two shape errors on the corpus prompts.** One card asked for and a table produced (prompt 10, both samples); a project conversion labelled as an invoice conversion (prompt 5, both samples). Both pass every gate, which is the separation the proposal predicted: governance compliance is not task fit. A completeness check (I3) of the kind R1a defines would catch the first; the second needs the task's own vocabulary in the plan.

## 5. Governance, vocabulary, emission and rendering

- **Governance held.** No build reached the screen without passing S1 to S3 and A1 to A3 as the production pipeline runs them. No other model and no unreported usage appeared, so the integrity checks never fired.
- **Vocabulary gaps are the known ones.** No date, number or select input; no purpose for loading, empty or result states. The models worked around them with text fields and plain text, never with an invented component.
- **Emission and rendering.** Every surface emitted and rendered natively through the production renderer. The emitter's empty action context means none of the buttons would do anything in a host (R0 finding A3); this is not new.
- **One surface root was a table** (corpus-05-1, the "Project created" step), with the heading below it. It passed the gates; it reads badly.

## 6. Spend and balance

| | Amount |
|---|---|
| Inference reported by AI Gateway analytics for the pilot window | **$0.7149**, 80 requests, all to `anthropic/claude-haiku-4.5` |
| Harness ledger (reported usage plus Cloudflare's 5% credit fee, counted conservatively) | $0.7507; every request settled at its reported usage, none left reserved |
| Largest single reservation | $0.1955 |
| Ceiling | $5 cumulative; never approached |
| Requests outside the harness during the window | None (gateway count equals the ledger's) |
| Credit balance before | $43.47, read by the owner |
| Credit balance after | **Not readable through the API.** Expected about $42.75 if the 5% fee was charged at purchase, $42.72 if it applies to usage. To be read by the owner |

Cost per build matched the proposal's estimate: about $0.026 for a single hotel build and $0.10 to $0.13 per flow, against $0.02 and $0.13 estimated. At this rate the full baseline's estimate ($15 to $25, mostly shadcn/ui v3) still looks right or high; it should be re-derived after R1a from this evidence.

## 7. Infrastructure changes and verification

All changes were temporary and are reversed.

| Change | Verification before use | Reversed |
|---|---|---|
| Rotated the secret of the existing `composer-live-pilot` service token, written straight to a private file in the session's scratch space | Never printed, logged or committed; the evidence files contain no credential | Token deleted; file removed |
| A path-scoped Access application on `composer.aesthetic-function.com/api` admitting only that token. The existing hostname application and its policies were not touched | Without the token, `/api/models`, `/api/propose` and every variant tried (`/api`, `/api/`, trailing slash, upper case, double slash, percent-encoding, query string) were answered by Access with 403, not by the Worker; pages stayed public; with a wrong secret, 403 | Deleted; Access is back to the single hostname application |
| A Worker version with `HOSTED_AI=on`, created from the deployed version's own module and bindings rather than from the latest branch upload | Module bytes, compatibility settings, asset configuration and four of five bindings identical to the deployed version; only `HOSTED_AI` differed. Every referenced static chunk byte-identical after deploy; the page HTML differed only in the Next.js build id, because the static files were carried over from a build of identical app sources | Rolled back to the previous version by the pilot wrapper on exit, then confirmed from outside: `/api/models` answers `["scripted"]` and `/api/propose` refuses with "unavailable" |
| Harness pacing: one request per 31 s (commit `8387a1f` on #121) | 24 pilot tests and typecheck pass; CI green | Stays on the unmerged branch |

Checks run with no spend: the harness preflight (four checks) before and after hosted AI was switched on, and the production smoke suite twice (31 passed each time; the one failure is the analytics-beacon exception the owner accepted, caused by this environment's proxy).

The AI Gateway was not changed: $10 per 24 h spend limit, 5 requests per 60 s, logs off. No other Cloudflare setting was changed. A safety check-in was scheduled before hosted AI was switched on and removed once cleanup was verified.

**Not done through the integration:** reading the credit balance and the auto top-up setting (owner, in the dashboard).

## 8. Gaps in the evidence

- **The first attempt's gate failure is not recorded for repaired builds.** Seven repairs are counted, but not why. **Requirement before any further paid evaluation:** the evidence writer must record, for every gated attempt, the rule codes it failed and the message the repair was asked to fix, and a test must show it. Without this the pilot's repairs cannot be attributed to the model, the prompt or the vocabulary.
- **Task fit was marked by the reviewer**, from the recorded surfaces. A person should confirm section 4's judgements before they set thresholds.
- **Twelve runs is a pilot.** Rates above (first-pass 79%, fit 8 of 8 on hotel singles) have wide intervals and should not be used as E5 thresholds.

## 9. Owner decision (2026-11-26)

- The pilot is accepted, with $0.7149 of inference ($0.7507 in the harness ledger).
- **The full baseline remains deferred.** The next authorization goes to M1 through R1a instead. No further paid inference is authorized.
- **Before any later paid evaluation**, the first-attempt gate-failure evidence in section 8 must exist.

## Corrections

Made after the owner's acceptance, by reconciling this report against the evidence files. The evidence and `SUMMARY.md` were already right and are unchanged.

| Was | Now | Why |
|---|---|---|
| 6 single builds, 28 flow steps | 7 single builds, 27 flow steps | The two corpus-10 runs are single builds; flow steps are 6 + 5 + 6 + 5 + 5 |
| 6 flow plans | 5 flow plans | There are five flows: three hotel, two corpus-05 |
| 26 first-pass builds, 8 repaired, 76% | 27 first-pass, 7 repaired, 79% | Seven builds have one repair each, seven repair requests in all |
| Corpus 5's opening summary repaired three times; the last step of a flow twice | Opening summary twice; corpus-05-1's last step once; hotel-flow-3's last step once; hotel-flow-1's step 5 of 6 once | Listed from the evidence |

The call total was right throughout: 80 = 5 flow plans + 34 goal plans + 34 generations + 7 repairs.
