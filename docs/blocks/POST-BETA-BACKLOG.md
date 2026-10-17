# Post-beta backlog

**Phase 2, step 7**, revised for the owner's single-host amendment. From the release-candidate freeze on 2026-10-17 until the first beta deploy (the cutover), nothing merges for an improvement or a nit ([RELEASE-REVIEW.md](RELEASE-REVIEW.md), "The freeze"). A finding blocks the beta only if it falls in one of the owner's blocking classes. Everything else is recorded here instead of starting another fix-and-review cycle. Nothing on this page blocks the invite-only beta.

Each item says where it came from and when it is due: **before public expansion** (public opt-in or any audience beyond the invite list), **before GA**, or **when convenient**.

## Next planning phase: the UI redesign

The UI redesign is deliberately outside the release closeout. It is the next planning phase, informed by the invite-only beta's feedback. Inputs to gather during the beta: where invitees get lost, what the receipts and notes fail to explain, and the manual accessibility findings ([MANUAL-A11Y-PACKET.md](MANUAL-A11Y-PACKET.md)). No redesign work starts before the owner opens that phase.

## Accessibility

| # | Item | Source | Due |
|---|---|---|---|
| A1 | A 3:1 treatment of Astryx's resting field border (today 1.5:1, SC 1.4.11), in Composer's Astryx canvas or upstream | owner's decision 2, 2026-10-17 | **before public expansion or GA** |
| A2 | auth-form input purpose (SC 1.3.5): `autocomplete` vocabulary upstream (and `required` on shadcn/ui), plus the host semantics | the plan's §10; owner's decision 1 | **before GA** (Track 2) |
| A3 | "Start" and "Save guide" (SC 2.4.6): reconsider the generic names outside their current context; a template change under the plan's §13 change policy | owner's decision 3 | before public expansion |
| A4 | The deferred manual checks D1 to D9 | [MANUAL-A11Y-PACKET.md](MANUAL-A11Y-PACKET.md) | before public expansion |
| A5 | `ex.plan-comparison`: axe `aria-required-children` (critical) in the Astryx List, SelectableCard and MetadataList renderers. Not a block; predates the beta | [ACCESSIBILITY.md](ACCESSIBILITY.md), "Outside the blocks" | before public expansion |
| A6 | A row of buttons outside a dialog footer can overflow when the longest words of its labels are wider than the row; only a model-written row could | ACCESSIBILITY.md | when convenient |
| A7 | The button-wrapping rule's two latent edges: an icon-only button with an empty label, and a labelled button while it loads; neither occurs today | ACCESSIBILITY.md | when convenient |
| A8 | Long table-region names (about 330 characters on a maximum call) and two tables sharing a name: judge by ear in the screen-reader pass; shorten only if testers find them a problem | ACCESSIBILITY.md, item 1 | after the screen-reader pass |
| A9 | The a11y spec's temporary text-check style: wrap it in try/finally (the final review's optional nit) | the step 6 final check | when convenient |
| A10 | shadcn/ui v3: the wireframe Separator chips' contrast, records-table's page overflow at 320 px, and a keyboard-focusable table container | owner's decision 4; ACCESSIBILITY.md | before shadcn/ui v3 joins any beta |

## In-product copy

| # | Item | Source | Due |
|---|---|---|---|
| C1 | Settings → Experimental says "This is an experimental build" and does not say "beta" or list the known gaps; the plan's §5 asks for both | the release review, §12 | before public expansion |
| C2 | Settings still shows "Reading the draft blocks…" while it loads, although both sidecars are approved | the plan's §11 | before public expansion |

## Operations and tooling

| # | Item | Source | Due |
|---|---|---|---|
| O1 | The harness sends no Access credentials, so neither the harness baseline nor the hosted canary can reach Composer behind Access. The owner has not authorized a machine credential: the canary stays blocked until a short-lived service token (with the harness-only change that sends it) or another secure method is authorized | [BETA-DEPLOY-PLAN.md](BETA-DEPLOY-PLAN.md), "The hosted canary" | **before the canary** (decision D4; not deferred) |
| O2 | Production's `wrangler.jsonc` did not set `workers_dev` and `preview_urls`. **Done** in the cutover change: both configs set both `false`, held by a test; step D's dashboard check stays the proof of the Worker's state | [BETA-DEPLOY-PLAN.md](BETA-DEPLOY-PLAN.md), step D | done |
| O3 | Verification behind Access: the post-merge build-id read, `/api/models` comparison and live-artifact scan all run anonymously today, and will meet the login. Decide whether a short-lived credential may serve them too, or whether they move to a signed-in browser | the step 7 review | before the next merge after Access |
| O4 | The `deploy-composer` workflow's production smoke runs anonymously and would fail behind Access (the workflow has never been dispatched) | the step 7 review | before it is next needed |
| O5 | An authenticated smoke in the experimental deploy workflow, once a machine credential is authorized | the step 7 review | after decision D4 |
| O6 | Automated alerts: every alarm is read by the owner by hand today | BETA-OPERATIONS.md, "Alarms" | before public expansion |
| O7 | After the cutover all Composer traffic is beta traffic on the shared `ds-ai-gateway`; a separate gateway (the plan's §13, decision 6) only if its spend needs telling apart from the af-site theme generator's | the plan's §9 | during the beta |
| O8 | Workers Logs keeps its own per-invocation record beside the operator log's line. Check what it holds for the beta (request metadata) and whether invocation logs or sampling should be narrowed | the step 7 review | before public expansion |
| O9 | The Worker does not check the Access token itself; the boundary is Access covering the whole hostname. A Worker-side check of the `Cf-Access-Jwt-Assertion` header would add depth | the step 7 review | before public expansion |
| O10 | Production's `HOSTED_AI` was declared in `wrangler.jsonc` without `keep_vars`, so a dashboard flip was undone by the next deploy from `main`. **Done** in the cutover change: the switches live in the dashboard, with `keep_vars` on both configs. A rollback still restores the target version's variables ([BETA-DEPLOY-PLAN.md](BETA-DEPLOY-PLAN.md), "Rollback") | the step 7 review (kill-switch class, pre-existing) | done |
| O11 | Repository, local-model and edited projects get no blocks: unit-tested, and the note's text is built in `state.tsx`, but only imported projects have an Astryx e2e (§12 criterion 4) | the step 7 review | before public expansion |
| O12 | The superseded beta workflow's header and summary named `BLOCKS_BETA` and `HOSTED_AI` but not `BETA_OPERATOR_LOG` as variables to set again after a rollback. **Done** in the cutover change: the experimental workflow names all three | the step 7 review | done |
| O13 | The local agent accepts any origin unless `AGENT_ALLOWED_ORIGINS` is set (pre-existing, by design for the hosted page); the beta origin reaches a running local agent as production does | the step 7 review | when convenient |
| O14 | The experimental workflow's token reaches only the steps that run wrangler, but those steps share the job with the install and the build, whose third-party code could leave a fake `npx`, a `BASH_ENV` or a seeded npx cache behind for them, or rewrite the repository's own `check-experimental-deploy.mjs`, which the anchor and record steps run with the token. Splitting it into a build job with no environment and a deploy job that installs nothing would make the boundary real. The same holds for Workers Builds, whose build and deploy share one container (pre-existing) | the cutover change's review | before public expansion |
| O15 | Nothing pins the wrangler Workers Builds runs: no `package.json` names it. An unknown key on a route object is a hard config error, and `wrangler.jsonc` sets `previews_enabled` on its route, which wrangler 4.146.0 and 4.151.1 accept, as did Workers Builds' own branch build of the cutover change. Pin it, as a root devDependency or in the deploy command (`npx --yes wrangler@4.146.0 deploy`), so a builder change cannot stop production's deploys | the cutover change's review | before public expansion |

## Blocks: provenance, host actions and tests

| # | Item | Source | Due |
|---|---|---|---|
| P1 | When browser storage refuses a write (a quota error), block provenance is not saved and nothing says so: `saveBlockProvenance`'s `false` is ignored in the experimental runtime. The surface itself is saved separately; only the provenance record, which is advisory, is lost | the step 7 review (data-loss class, low impact; the owner decides) | before public expansion |
| P2 | A beta export can bind a withheld shadcn/ui v3 block surface that arrived by import, with `declared: true`: the manifest checks every bundled sidecar, whatever the switch says. A host must check `block.reference` | the step 7 review | before shadcn/ui v3 or a second host |
| P3 | `HOST-ACTIONS.md` says the manifest's `actions` lists every action name a surface dispatches; the code leaves out events whose name is not a string (such a surface never binds, so nothing is granted). Align the wording | the step 7 review | with the next documentation change |
| P4 | The ratchet holds a boundary call's emitted names to a subset of the declared ones; no committed test pins exact equality with the §7 table per call. A local run of the real expander and emitter found every Astryx and shadcn/ui example and boundary call exact | the step 7 review | when convenient |
| P5 | Settings → Experimental lists each reference's blocks as "(approved)" without saying the switch withholds shadcn/ui v3 in the beta (a build's note does say so) | the step 7 review | with C1 |

## Known issues already filed

| Issue | Status | Due |
|---|---|---|
| aestheticfunction/dspack-studio#104, intermittent `e2e/fork.spec.ts:37` | open; CI flake, not a product defect | when convenient |
| aestheticfunction/dspack-studio#108, three provenance lifecycle nits, unreachable today | open | when convenient |
| aestheticfunction/dspack-studio#42, Accept could overwrite a worked example | the code at the release candidate refuses an existing id and mints collision-free ids (`apps/composer/app/state.tsx`, Accept); verify and close | when convenient |
| aestheticfunction/dspack-studio#41, #43, #44, #48, #50 | open, pre-existing, outside the blocks | when convenient |

Local only: the agent test `rediscover > restoredConflict` times out locally at about 5.1 to 5.5 s and passes in CI.
