# Interface blocks: Phase 2 release plan

> **Status on main (2026-10-16).** Below this note is the plan's final version of 2026-10-16, preserved unedited. The owner accepted the plan on 2026-10-15; the final version adds the owner's clarifications and the shadcn/ui v3 result. Since then:
> - On 2026-10-16 the owner accepted the shadcn/ui v3 result as valid (pass, uncertain), selected **branch C**, and answered §13's decisions 1 to 4, 6, 13 and 14 (5 does not arise under branch C). The answers are in [PHASE-2-DECISION-RECORD.md](PHASE-2-DECISION-RECORD.md).
> - G1 has landed: the records on main that §3 lists. So the plan's statements about what main holds describe `7e260c3`, before G1. For example, `docs/blocks/baseline.json` is now committed ([BASELINE.md](BASELINE.md)).
> - The owner authorized step 2 on 2026-10-16, and it is built: the beta's delivery path, guards and switches ([../BLOCKS.md](../BLOCKS.md), "The beta (Phase 2)"; [../deployment.md](../deployment.md), "The beta composer"). No beta is deployed. Each later Phase 2 change still needs the owner's authorization.
> - The owner authorized step 3 on 2026-10-16, limited to H1, H2 and H4 (§7), and it is built: the B0 action-id proof, the action manifest in the beta's Catalog export, and the host guide ([HOST-ACTIONS.md](HOST-ACTIONS.md)). The Catalog export that §7 locates at `exportBundle` in `preview-view.tsx` is now built by `catalogBundle` in `apps/composer/app/catalog-export.ts`. The manifest reads each surface's actions with `actionEvents` (`packages/composer-core/src/blocks/actions.ts`), which also reads each context, rather than `emittedActionNames`. H3, the Blocks catalog view and Preview's label, belongs to step 4.
> - The owner authorized step 4 on 2026-10-16: the read-only Blocks catalog and provenance UI (§7 H3, §8), and the first three host-guide clarifications from step 3's review. It is built: a Blocks section in the Catalog view; in Preview, a surface's provenance ("made with block X vN", only by exact expansion identity) with its status and specific reason, and the note that block actions are host-owned and not executed here; and §8's lifecycle, with an Example session's save now pruning its provenance too. Nothing grants an action anything, and the default build is unchanged.

Final version, 2026-10-16. The owner accepted the plan on 2026-10-15 as the conditional working plan for the next AF Composer release, and this version carries the owner's three clarifications (below) and the shadcn/ui v3 result. It is not authorization to begin Phase 2: nothing in it starts until the owner authorizes it. No code.

**The owner's clarifications, carried into this version:**
1. A baseline committed to main is a historical run record, not a self-updating production baseline (§3, §11).
2. Host action authorization requires verified block provenance or expansion identity, and the declared manifest. A surface id plus an action name alone grants nothing (§7, §12).
3. The release is an experimental beta. The auth-form accessibility exception is explicit, and GA remains blocked on the relevant vocabulary and host semantics (§10, §12, §13).

- **Basis.** dspack-studio `main` at `7e260c3`, dspack-gen `a7cd9bb` (0.5.0), dspack-emit `3b152ae` (0.7.0). Every path below was read at those commits. Paths are repo-relative; a path in a sibling repository names that repository first.
- **NEW** marks work that does not exist yet. Anything unmarked names code or docs that exist today.
- **Naming.** "Phase 2" means blocks Phase 2 from the Phases table in `docs/BLOCKS.md`. The repository also uses "Phase 2" for unrelated work (`docs/IMPLEMENTATION_LOG.md`, a comment in `apps/composer/app/hosted-build.ts`, dspack-gen's representability work).

## 1. Summary

- Both design-system decisions are known. Astryx passed Stage 3 clearly; shadcn/ui v3 passed, uncertain (2026-10-16). Under §3, an uncertain decision is branch C. Phase 2 still starts only when the owner authorizes it.
- The release is an experimental beta. GA is not part of it, and stays blocked on the vocabulary and host semantics in §10.
- Track 1 is an opt-in beta of the three approved blocks, shipping the code ADR-B3 measured. Track 2 is the upstream work: ratification in dspack, the move into dspack-gen, and agent parity. Default-on (GA) needs Track 2; the beta does not.
- The beta deploys the existing experimental artifact separately, behind the existing per-user preference, which is off by default. The production artifact keeps every Phase 1A guarantee.
- Three ways to stop the beta, none touching production: a block-specific runtime switch (NEW), the existing `HOSTED_AI` switch, and `wrangler rollback`.
- A host authorizes a block action only with both of these: the block's verified provenance or expansion identity, and the declared manifest (NEW). A surface id plus an action name alone grants nothing.
- Provenance stays project data. In the beta, every contract re-bind makes it inert. Ratification decides its long-term form.
- Metrics follow the ADR-B3 definitions. Only an owner-run harness canary on the beta deployment produces decision-grade numbers. A baseline committed to main is a historical run record, never a self-updating production baseline.
- `auth-form` cannot meet WCAG 2.2 SC 1.3.5 from the governed surface today: there is no autocomplete, and emission drops `type="email"`. The beta ships it only under an explicit, recorded accessibility exception (§10).
- If shadcn fails or is inconclusive, the beta narrows to Astryx or does not ship, and ratification waits for a second passing reference.

## 2. Where things stand

### Shipped and private (Phase 1A), verified

| Mechanism | Where |
|---|---|
| Build flag inlined as `"0"` or `"1"`; flag and `out-experimental` must agree; `apps/composer/experimental/` aliased to nothing when off | `apps/composer/next.config.mjs`; `build:experimental` in `apps/composer/package.json` |
| Source ratchet: block code only behind the literal check | `apps/composer/lib/experimental-guard.mjs` and its test |
| Artifact scan for the sidecar key, `disable-actions-until-complete` and every block id | `apps/composer/scripts/check-default-artifact.mjs`, run by the app's `build` and by `build:deploy:composer` |
| Served-chunk scan; a seeded preference changes nothing | `e2e/composer-prod-smoke.spec.ts` |
| Deploy guard | `.github/workflows/deploy-composer.yml` |
| Preference `composer.experimental.v1`, default `{blocks: false}` | `apps/composer/app/experimental.ts`; Settings section in `apps/composer/app/views/settings-view.tsx` |
| Sidecars, both `approved`. Astryx 0.1.4 binds base `4c6ce46d…`; shadcn/ui 3.2.0 binds base `992b51b8…` | `apps/composer/experimental/blocks/*.blocks.json` |
| The one app module that imports block code | `apps/composer/experimental/blocks-runtime.ts` |
| Schema; B0 and the action half of B2; B1 and constraints; expander; block phase, budget of 3, `BlockTrace`, `durableTrace`; refinement; selection; eligibility; provenance | `packages/composer-core/src/blocks/` (`schema.ts`, `load.ts`, `call.ts`, `expand.ts`, `phase.ts`, `refine.ts`, `select.ts`, `eligibility.ts`, `provenance.ts`) |
| `dspack.block` event, emitted by the runtime; folded and explained, failure kind `invariant` | `apps/composer/experimental/blocks-runtime.ts`; `packages/composer-core/src/build.ts` |
| Provenance store (key `composer.project.blocks.<projectId>`) and export field | `apps/composer/app/block-provenance.ts`; `ProjectExport.blockProvenance` in `apps/composer/app/project-portability.ts` |
| Call records and receipts; Block row and note | `packages/composer-core/src/usage.ts`, filled by `callRecords` in `apps/composer/app/hosted-build.ts`; `apps/composer/app/views/build-view.tsx` |
| Worker: `maxCalls` 1 or 2, `calls[]` on every reply, `per-call-model`, `503 busy`, `HOSTED_AI` | `apps/composer/worker/propose.mjs`, `wrangler.jsonc` |
| Byte-identity oracle | hashes in `packages/block-bench/results.json`, asserted by `apps/composer/app/hosted-build.test.ts` |
| Contract-time ratchet; reference copy guard | `apps/composer/lib/blocks-ratchet.test.mjs`; `apps/composer/lib/reference-sync.test.mjs` |
| Experimental e2e with axe, run in CI | `e2e/composer-blocks.spec.ts` via `playwright.composer-experimental.config.ts`; `.github/workflows/ci.yml` |

### Evidence (Phase 1B)

- **Astryx Stage 3: pass, clear.** Corpus `blocks-1b` v2, 24 prompt threads per arm, 480 cells, hosted Claude Haiku 4.5 served as `claude-haiku-4-5-20251001`.
  - Tokens per success fell 52.8% against production (95% interval 39.0% to 65.1%) and 49.2% against capped.
  - Pass rates: block 94.2% (113/120), capped 95.0% (114/120), production 90.0% (108/120). Selection 24/24; 0 invariant failures; 0 budget exhaustion.
  - Positional encoding did worse than named: 90.5% (105/116) at 9,628 tokens per success, against 94.2% at 7,573. This informs ADR-B2 only.
- **shadcn/ui v3 Stage 3: pass, uncertain** (2026-10-16). Corpus `blocks-1b` v2, 24 prompt threads per arm, 480 cells in eight windows, the same served model. The final `--complete` verification finds nothing; $36.86 committed of the run's $77 ceiling.
  - Tokens per success fell 62.0% against production (95% interval 50.6% to 71.8%) and 59.5% against capped.
  - Pass rates: block 87.1% (101/116), capped 86.2% (100/116), production 82.1% (92/112). Against capped, the pass-rate interval (−8.0 to +10.3 points) crosses the 5-point margin, so that criterion, and the decision, are uncertain.
  - Window 7 stopped on a hold (an HTTP 502 the run could not meter; the gateway shows no usage and no charge). The owner made an explicit exception for it, and it stays in the ledger at $1.118208.
- **The evidence is on evidence branches, not on main.** Both Stage 3 runs are preserved byte-identical, with checksums, logs, monitor events and independent verification:
  - Astryx on `claude/blocks-stage3-astryx-evidence`;
  - shadcn/ui v3 on `claude/blocks-stage3-shadcn-evidence`;
  - the baselines they are held to on their own branches.

  These branches are never merged. A merge to main redeploys production and changes the build id an open run is held to. Main itself holds no report: `packages/block-bench/live/runs/` is git-ignored (`packages/block-bench/live/README.md` says to copy a report into `docs/blocks/` on purpose), and `docs/blocks/baseline.json` is uncommitted (`docs/blocks/BASELINE.md`).

### Facts that shape the plan

1. **Approval record.** No approval document exists in `docs/blocks/`. Approval is the `status` field of both sidecars (commit `5d41c26`, #91), recorded in `docs/BLOCKS.md` and `docs/blocks/BASELINE.md`.
2. **Busy is a 503.** It is a structured `503` with `error: "busy"`, sent when a gateway 429 turned away the only call; the Worker reads that 429 from its status since `eaf6ae3`. The Worker's own `429 rate-limited` comes from `PROPOSE_RATE_LIMIT`, which does not enforce on this account.
3. **Per-call model.** `CallRecorder` records per-call usage, but `callRecords` stamps every call with the reply's top-level `model`. Only the harness reads each call's own model (`packages/block-bench/live/providers/hosted.ts`).
4. **The contract pin.** `docs/CONTRACT-PIN.md` pins the exhibit's v2.3.0 copy, `packages/contracts/shadcn-ui.dspack.json`. Blocks bind to the composer's shadcn/ui 3.2.0 contract, which is authored in `apps/composer/shadcn-v3-project/` and copied to `packages/contracts/shadcn-v3.dspack.json`. No pin or upstream sync covers that copy, and the pin doc records upstream at 3.0.0.
5. **Event and failure kind.** `dspack.block` is emitted in `apps/composer/experimental/blocks-runtime.ts`. The `invariant` failure kind lives in `packages/composer-core/src/build.ts`, not in `packages/composer-core/src/blocks/`.
6. **What the default build removes.** It aliases the whole `apps/composer/experimental/` directory, runtime included, not only the sidecars. The scan's path is `apps/composer/scripts/check-default-artifact.mjs`; `docs/BLOCKS.md` writes `scripts/`.
7. **dspack-gen `./core`.** It is zero-network and emitter-free, and admits only `ajv`, `ajv-formats` and Node built-ins as bare imports, type-only imports included (dspack-gen `src/core/core-boundary.test.ts`). The block phase needs dspack-emit for B2, `packages/composer-core/src/blocks/schema.ts` uses zod and `packages/composer-core/src/blocks/view.ts` imports dspack-emit types, so none of them moves in as written.
8. **Status gating.** The app shows block status in Settings but never gates on it. Only the harness does.

### Unknown today

- Whether the owner authorizes Stage 4 for shadcn/ui v3 (§3, branch C; §13, 14).
- Whether dspack `main` carries shadcn/ui 3.2.0 (there is no dspack checkout here).
- How real goals select blocks: field data has no labels.
- What hosts' A2UI runtimes do with the data model when an action fires.
- Beta traffic, and its cost against the shared gateway limit.

## 3. The gate and its branches

**Gate.** No Phase 2 PR merges until all of these hold:
- G1. **Records on main (NEW, docs only).**
  - What is committed under `docs/blocks/`:
    - each Stage 3 report with its manifest and preflight;
    - its run id;
    - a link to its evidence branch and commit.
  - `docs/blocks/baseline.json` is committed as `docs/blocks/BASELINE.md` asks. It is a historical run record: the baseline the Stage 3 runs were held to, as captured. It never updates itself, and no later run may assume it describes production; a later run captures its own.
  - It merges only after the shadcn run closes, because any merge to main redeploys production while a run is held to its build.
- G2. The shadcn decision is known: Stage 3 completed in owner-authorized windows and recorded the same way, or the owner has declared it inconclusive. Met on 2026-10-16: pass, uncertain.
- G3. The owner picks a branch and answers the decisions in §13 marked "before the gate".

**Branches.**
- **A. shadcn passes and is clear:** a beta across both design systems.
- **B. shadcn fails:** an Astryx-only beta, or no release.
- **C. shadcn is inconclusive** (insufficient after Stage 3 completes, or uncertain): an Astryx-only beta now. shadcn joins only if an owner-authorized Stage 4 passes clearly (the stages in `docs/blocks/ADR-B3-ADDENDUM.md`).

**The shadcn result (pass, uncertain) falls in branch C as defined here.** G3 leaves the choice of branch to the owner.

| Area | A: both | B or C: Astryx-only | No release |
|---|---|---|---|
| Offered references | shadcn/ui v3 and Astryx | Astryx. The runtime switch's reference list (NEW) withholds shadcn, and the block note says so | none; Phase 1A stays private |
| First-run reach | the default shadcn project gets blocks | Astryx projects only; most first-run users see none, because shadcn is the default reference | none |
| Canary | both references | Astryx | none |
| Accessibility gates | both preview registries | Astryx gates; shadcn scans run but do not gate | n/a |
| Host guide | intents per reference: auth-form serves `structured-input` on shadcn, `data-collection` on Astryx | Astryx intents | n/a |
| Ratification (Track 2) | proceeds: two references prove ADR-B1 | held until a second reference passes: in B, a revised shadcn block version with its own evaluation; in C, Stage 4 | held |
| Records | both reports | the Astryx report, plus the shadcn report or its status | both reports, plus the reason |

## 4. Scope and sequencing

| Item from the original "Later" list | Placement |
|---|---|
| Ratify dspack `blocks` upstream-first | Track 2. The RFC goes upstream during the beta, and GA needs it. The beta runs on sidecars and changes no contract, so it does not engage the upstream-first protocol (`docs/PHASE-NEXT.md`). |
| Move the block phase and expander into dspack-gen, with audit fields | Track 2, after ratification. Split it: the pure parts (signature rewritten without zod, B1, constraints, expander, digest) go into `./core`; B0, the action check and the block phase go into the run layer and `./browser`. |
| Agent parity and live B events | Track 2, after the move: one implementation across the browser and agent boundary (`docs/ARCHITECTURE.md` §7). |
| Blocks catalog and provenance UI | Track 1, read-only (§7, §8). |
| Selectable or planner-default mode | Track 1: planner-default, with a per-turn opt-out (§5). |
| `autocomplete` and other vocabulary gaps upstream | Track 2, but auth-form GA depends on it (§10). |

**Order.** Each step is its own reviewable PR, green before the next, with new assertions landing fail-first (`docs/PHASE-NEXT.md`, delivery discipline).
1. Records and doc corrections (G1, §11), merged only after the shadcn run closes.
2. Beta delivery path, guards and switches (§6).
3. Action manifest, B0 action-id proof, host guide (§7).
4. Blocks catalog and provenance UI (§8).
5. Receipts and operator signals (§9).
6. Accessibility fixes and scans (§10).
7. Release review against §12, then the first beta deploy.

A merge to `main` redeploys the production composer through Workers Builds (`docs/deployment.md`; ADR-B3 amendment 2). Steps that touch shared code reach production when they merge, so CI's byte-identity oracle gates each one.

## 5. The opt-in beta

**What ships.**
- The three approved blocks, `records-table`, `auth-form` and `guide-steps`, at version 1, on the offered references.
- The measured behavior, unchanged: named calls only (the runtime never asks for positional), the budget of 3 with `maxCalls: 1` (ADR-B4), and the refinement rules in `packages/composer-core/src/blocks/refine.ts`.
- Eligibility as in `packages/composer-core/src/blocks/eligibility.ts`: packaged reference projects and Example sessions on their unedited base, built in the browser.
- Planner-default selection (`packages/composer-core/src/blocks/select.ts`); scripted mode keeps deterministic selection.
- NEW: a block is offered only when it and its sidecar are both approved.
- NEW: a per-turn "build without a block" control, which posts today's planning and generation requests for that turn.
- NEW: Settings copy says "beta" and lists the known gaps.

**Who.** Users who open the beta origin (§6) and turn on the existing preference. Audience size is an owner decision (§13).

**Storage.** The beta origin has its own browser storage. Production projects reach it only by export and import, and an import becomes an imported project, which is ineligible. Beta users start from a packaged reference or an Example session, and `docs/blocks/BETA.md` (NEW) says so.

**Not in the beta.** Positional encoding, local models, repository and imported projects, refinement seeded from stored provenance in a later session, and a manual block picker.

## 6. Feature flags and rollback

**How the beta is enabled.**

| Option | Verdict |
|---|---|
| Per-user opt-in on a separate beta artifact | Recommended. Deploy `apps/composer/out-experimental` to its own Worker and hostname. Every Phase 1A guarantee for `out/` holds unchanged. Cost: a second deploy path, and storage that is separate per origin. |
| Default build flag (block code in `out/`, preference off) | Not for the beta. It retires the Phase 1A exit "default builds contain no block code", the artifact scan and the chunk scan. Opted-out byte identity would rest on a runtime branch, not on absent code. Revisit for GA. |
| Per-project toggle | No. Eligibility is already per project, and a toggle adds state without a measured need. |

**Layers (recommended).**
1. **Build flag, unchanged.** Production `apps/composer/out/` never carries block code.
2. **Beta deploy path (NEW).** A second wrangler config (for example `wrangler.composer-beta.jsonc`) for a separate Worker serving `out-experimental`. Only a new dispatched workflow modeled on `.github/workflows/deploy-composer.yml` deploys it, with a rollback anchor and a smoke run; it stays off Workers Builds, which reads `./wrangler.jsonc`.
   - Guards: the workflow refuses an unflagged build, or one without the positive-control marker that `e2e/composer-blocks.spec.ts` checks; a test holds `wrangler.jsonc` to `./apps/composer/out`.
3. **Per-user preference, unchanged.** `composer.experimental.v1`, default off.
4. **Runtime switch (NEW).** Before offering blocks, the beta client reads a switch from the beta Worker: for example fields in the `/api/models` reply, set from a Worker variable, holding on or off, the offered references and any disabled block ids.
   - Missing, unreadable or off means no blocks, and the note says why.
   - With the variable absent, production replies stay byte-identical (NEW case in `apps/composer/worker/propose.test.mjs`).
5. **Coarse switch, existing.** `HOSTED_AI=off` on the beta Worker stops hosted generation there only.

**Runbook.**
- Stop blocks but keep hosted builds: turn the switch off (NEW). It takes effect on the next build.
- Stop hosted generation on the beta: `HOSTED_AI=off`.
- Roll back: `npx wrangler rollback --config <beta config>` to the recorded anchor. Production and the beta roll back independently.
- Data needs no migration. Stored provenance stays; a rolled-back build re-validates it against its own bundled sidecars and reads anything it cannot vouch for as inert. Default builds ignore it.
- Within a session, an invariant failure already disables the block for the page session (`disabledBlocks` in `apps/composer/app/state.tsx`).

**Byte identity for opted-out users.**
- Production is unchanged by construction (the guards in §2).
- Beta with the preference off: `planGoal` takes today's branch and `blockRunFor` returns null, so planning and generation post today's bytes. The existing oracle covers this ("the flag alone changes nothing" in `apps/composer/app/hosted-build.test.ts`); NEW: the beta e2e also hashes the posted bodies against `packages/block-bench/results.json`.
- Beta, opted in, ineligible project: `withBlockChoice` returns the request untouched, so the bytes are the same.
- Opted in and eligible: the planning request differs by design (it carries the block question). After a null selection, generation posts today's bytes (NEW assertion).
- Any change that moves a golden in `results.json` changes production bytes for everyone, so it gets its own PR and owner sign-off.

## 7. Host action authorization

Composer never executes actions (`docs/ARCHITECTURE.md` §9). The Build canvas ignores them (`onAction` is a no-op in `apps/composer/app/views/build-view.tsx`), and Preview logs the name and may advance a flow walk (`handleAction` in `apps/composer/app/views/preview-view.tsx`). The owner declares actions in the sidecar, B2 holds every expansion to that list, and the host binds and authorizes each action.

**The allowlist today (B2).**
- Declared: each block's `actions`, which `packages/composer-core/src/blocks/schema.ts` checks against the dspack-emit slug pattern.
- Emitted: dspack-emit gives each button the action `{event: {name: slug(node id), context: {}}}` and records a `surface-synthesized-action` warning (dspack-emit `src/targets/a2ui/surface.ts`). Template ids are literals or a `$concat` of literals and enum props, so the set of names is finite.
- Checked: `runBlockPhase` emits the expansion (`emitCheck`) and calls `checkActions`. An undeclared name is an invariant failure, and a model never repairs it.
- Tested: `apps/composer/lib/blocks-ratchet.test.mjs` checks emitted names against declared ones for the worked examples, and B1 and B2 for boundary calls.

| Block | Action names, same on both references | Present when | Streaming policy |
|---|---|---|---|
| records-table | `records_create`, `records_export`, `records_refresh` | listed in `actions` | disable actions until complete |
| auth-form | `auth_submit`; `auth_forgot`; `auth_provider_google`, `auth_provider_github`, `auth_provider_microsoft`, `auth_provider_apple` | always; when `recovery` is set; one per provider | disable actions until complete |
| guide-steps | `guide_start`, `guide_save` | listed in `actions` | static-safe |

**Phase 2 work.**
- H1 (NEW): B0 proves the allowlist at load. Every node that can carry an action needs an id built only from literals and enum-bounded props, and the names the template can produce must equal `actions`.
- H2 (NEW): an action manifest in the beta's Catalog export (`exportBundle` in `apps/composer/app/views/preview-view.tsx`). Per surface, it lists the names its messages dispatch (`emittedActionNames`); for a block surface, it adds the block, version, expansion identity (its `expansionDigest`), declared actions and streaming policy. The default build's export does not change.
- H3 (NEW): the Blocks catalog view shows the same per block and reference, and Preview labels a block action "host-owned, not executed here".
- H4 (NEW): `docs/blocks/HOST-ACTIONS.md`, the host guide below.

**How a host binds and authorizes (guide content).**
1. Authorize a block action only when both hold:
   - the surface's block provenance or expansion identity verifies: the surface still equals its block's expansion, under a sidecar the host trusts;
   - the action is in the declared manifest for that surface.

   A surface id plus an action name alone grants nothing. Deny everything else.
2. Authorize the effect where it happens: the host's server checks the session and permission for each effect. An action event is a request, not a grant.
3. Where the policy says so, keep actions disabled until the surface is complete.
4. Treat every surface value as data. Titles, cells and steps are model-written: never render them as markup or evaluate them.
5. Make effects idempotent. The exhibit's agent dedupes by `actionId` (`answeredActions` in `apps/agent/src/server.ts`), which shows the shape.

**auth-form never carries credentials or entered values.**
- **No slot.** The signature language has no type for an entered value, a default, a credential or runtime state (RFC §2), and a test rejects such prop names (`packages/composer-core/src/blocks/blocks-schema.test.ts`).
- **Fixed fields.** Labels and input types are template literals chosen by enum. `title` and `intro` are model text, capped at 80 and 200 characters.
- **Empty context.** Emitted actions carry `context: {}`, and the shadcn profile drops `form-message` as runtime data (`apps/composer/shadcn-v3-project/shadcn-v3.profile.json`).
- **Durable state.** A trace persists only through `durableTrace`, and provenance keeps only the validated call (`packages/composer-core/src/blocks/provenance.ts`).
- **Preview.** Typed text stays in the page (`packages/shadcn-renderers/src/components/TextFieldRender.tsx`, `packages/astryx-renderers/src/components/TextFieldRender.tsx`), and Composer sends no action anywhere.
- **Host rule.** Credentials go from the host's own form state to the host's auth endpoint. They never enter an action context or a data model relayed to an agent or a model; per the renderer comments, A2UI syncs input when an action fires. Provider buttons start the host's own OAuth flow, and Composer holds no client ids or secrets.

**Threat cases.**

| Threat | Control today | Phase 2 |
|---|---|---|
| The model coins an action | no action slot; ids come from literals and enums; B2 makes it an invariant failure | H1 proves it at load |
| Another surface emits a block's name: a primitive surface whose node id is `auth-submit` also slugs to `auth_submit` | none, because names are not capabilities | the host grants nothing without the block's verified provenance or expansion identity and the manifest |
| An accepted surface is edited to add a button | provenance is pruned once the surface no longer equals its expansion (`pruneProvenance`); refinement switches mode | the manifest is recomputed from the messages |
| A forged `blockProvenance` in an imported file | `parseProvenance` checks it against the bundled sidecars; imported projects are never eligible | guide: provenance alone never grants action rights, and forged provenance fails verification, so the host grants nothing |
| A host relays entered values to an agent or a model | actions carry an empty context | guide rule; NEW test that auth-form actions carry an empty context |
| Misleading copy in `title` or `intro` | B1 length bounds, S3 rules, and a person accepting the surface | guide: review the copy; an optional owner-authored S3 rule |
| Actions enabled while the surface streams | the policy is declared in the sidecar only | the manifest exports the policy |
| Replay or double submit | none in Composer | guide: idempotency |

## 8. Provenance and versioning

**Today.** An entry (`packages/composer-core/src/blocks/provenance.ts`) has the shape `{v: 1, reference, baseSha256, block, version, intent, blockSchemaSha256, encoding: "named", call, expansionDigest}`, at most 16 KB.
- It is written only when the accepted surface's digest equals the expansion, and pruned when its example vanishes or is edited.
- It is trusted only against a bundled sidecar with the same reference, base, block id and version. Anything else is inert, `{block, version, status: "inert"}`, and its surface renders as an ordinary surface.
- `provenanceStatus` (refinable, inert or unavailable) exists, but nothing in the app reads it.

**Versions.**
- Sidecar format: `blocksSidecar` must equal `"0.1"`. NEW rule: a format change ships a parser that reads both versions.
- Block version: a signature is append-only within a version (ADR-B2). A breaking change needs a new version or id, and older provenance then reads as inert. ADR-B3 evidence covers version 1 only.
- Changes after the decision fall into three classes, which are an owner decision (§13).

**Base binding and contract changes.**
- `baseSha256` is the sha256 of `JSON.stringify` of the parsed packaged contract (`packages/composer-core/src/blocks/digest.ts`), the same canonicalization as dspack-gen's report digest. A mismatch yields `binding: "mismatch"` and no blocks for that reference (`packages/composer-core/src/blocks/load.ts`), and CI fails first (`packages/composer-core/src/blocks/blocks-schema.test.ts`, `apps/composer/lib/blocks-ratchet.test.mjs`).
- Astryx is upstream-first: `check-sync` tracks dspack `main`, and the PR that re-syncs the contract must re-bind the sidecar and regenerate the bench (`docs/PHASE-NEXT.md`, standing constraints).
- shadcn/ui 3.2.0 is authored in the studio, outside `docs/CONTRACT-PIN.md`. Ratifying shadcn blocks upstream-first needs this contract upstream first (NEW; its status upstream is unknown here).
- Every re-bind makes all existing provenance for that reference inert, because trust compares `baseSha256`. The beta accepts this and `docs/blocks/BETA.md` says so; a carry-forward rule is an owner decision.

**Inert and stale entries in the UI (NEW).** An accepted surface shows "made with block X vN" and its status: refinable; inert, with the reason (version, base or validation); or unavailable (not a reference project). Stale entries are pruned on save, as today.

**Export and import.** `blockProvenance` is an additive field on `composerProjectExport` 0.1.
- Only experimental builds write or read it; a default build drops it on import.
- Duplicating a project copies it, removing a project deletes it in every build, and imported projects never refine from it.
- NEW note for `docs/blocks/BETA.md`: a beta export imported into production loses its provenance.

**Repository projects (ADR-B5, Track 2).** Provenance goes in an agent-written file beside the contract, keyed by example id and admitted by the agent's `saveExample` (`/project/save-example` in `apps/agent/src/project.ts`). It does not go in `project.json`: that schema is `.strict()` (`packages/composer-core/src/project.ts`), so a new key would fail connect on older builds.

**What ratification in dspack changes.**
- The format moves into the dspack spec (the RFC is titled "a `blocks` section for dspack 0.5") and is byte-synced like the contracts (NEW `check-sync` entries).
- RFC §9 asks whether blocks live inside the contract or beside it. Inside makes the binding implicit, but the default composer artifact would then carry block ids, and `apps/composer/scripts/check-default-artifact.mjs` would fail by design. Recommended: a separate artifact that the contract references by digest.
- An additive audit field in dspack-gen's report version 1 replaces the turn-level trace (dspack-gen `docs/AUDIT.md`, `schemas/audit-report.v1.schema.json`). Today, attempt 0 of the report holds only `model: "block-expansion"` and a `meta.blockTrace` mirror.
- Provenance may then name the spec version, and readers keep accepting `v: 1`.

## 9. Observability and receipts

**What users see today.**
- **Block row**, first in the pipeline detail (`BlockRow` in `apps/composer/app/views/build-view.tsx`): block and version, the block phase's model calls, and each call's outcome with its B1 and B2 counts, ending with the digest or the fallback, provider or invariant reason.
- **Block note** on the context line: the selection and its reason, a withdrawn choice, or why the project is ineligible.
- **Receipt** (`describeCalls` and `describeTimings` in `packages/composer-core/src/usage.ts`): calls by operation (plan, block, block-repair, generate, refine, repair), provider-reported input and output tokens, refused requests and timings.
- **Failure explanation** (`packages/composer-core/src/build.ts`): "N model calls used: X block, Y surface", with the budget wording.

**Phase 2 for users (NEW).**
- The receipt splits tokens between block and surface calls. `reconcileBlockTrace` in `packages/composer-core/src/blocks/phase.ts` already counts calls this way, but the app does not use it yet.
- Records read each call's own model, falling back to the top-level one, to match the harness (`callRecords` in `apps/composer/app/hosted-build.ts`). This is reply parsing only, so request bytes do not change.
- A budget line ("2 of 3 model calls") and the refinement mode in words: compact, or switched and why.
- Never an estimate, as `packages/composer-core/src/usage.ts` already requires.

**What operators see today.** Workers observability on the composer Worker (`wrangler.jsonc`), and AI Gateway analytics for `ds-ai-gateway`, which the af-site theme generator shares, with `collectLog` false. There is no client telemetry and no prompt log, so operators cannot see block outcomes.

**Phase 2 for operators (NEW).**
- **Separate metrics.** The beta's own Worker gives separate request and error metrics.
- **One shape-only log line per beta request:** status, error, `maxCalls`, each call's outcome, tokens and model, and duration. Never the prompt, schema or output. A variable production does not set gates it.
- **Beta traffic in the shared gateway.** Telling it apart, for example by request metadata, is unverified. The fallback is a separate gateway, whose id is a constant in `apps/composer/worker/propose.mjs` today.
- **Canary.** The owner runs the hosted harness against the beta (`eval:live`), with request and dollar caps, integrity stops and the served model held fixed. A Stage 1 smoke follows each beta deploy that changes block code or sidecars; a pilot runs at a cadence the owner sets.
- **Optional diagnostics export** (§13): a user-initiated file of `durableTrace` records, call records, timings and outcomes, with no prompt and no model text.

**Metrics the beta reports (ADR-B3 definitions).**

| Metric | Definition | Source |
|---|---|---|
| Tokens per success | provider-reported input plus output, over every call (planning, block, repairs, re-issues, fallback, refinement) of runs whose calls were all metered, failures included, divided by successes | canary, decision-grade; export, descriptive |
| Pass rate | passed over evaluated, with provider and policy failures counted apart. On corpus v2 the canary applies amendment 2's binding add and remove check; field data uses the pipeline's pass only, labelled so | both |
| First-attempt rate; repairs per success | as ADR-B3 | both |
| Selection | canary: accuracy, counting explicit null, omitted and planning failures apart; field: rates only | both |
| Fallbacks and failures | by classification (`invalid-call`, `unsupported-refinement`, `switch`); invariant failures; budget exhaustion; provider failures, busy included | both |
| Latency | first valid preview (equal to completion, and reported so); first gated attempt; block phase; emit; total; all execution time | both |
| Input bytes | request bytes per run | both |
| Semantic parity | the frozen checklist | canary only |
| Refinement retention | the share of refinements that stay in block mode | both |

Counts appear beside every rate, and figures are kept per reference and per provider and model. The prompt thread is the canary's unit, with paired intervals. Field data never feeds the ADR-B3 decision, and nothing is estimated.

**Alarms (NEW).** The owner is alerted on any invariant failure, any served-model change, or canary point estimates that cross an ADR-B3 threshold. A canary below the minimum of 20 threads cannot decide; it only warns.

## 10. Accessibility

**Target:** WCAG 2.2 AA. The repository's scans check WCAG 2.0 A and AA rules today. There are three layers: the governed template (the sidecars); Composer's preview renderers (`packages/shadcn-renderers` and `packages/astryx-renderers`, with the wireframe fallback from `apps/composer/app/registries.ts`); and the host's renderer, which is host-owned and covered in the guide.

**auth-form.**
- **Labels.** Astryx carries `label` on each input. On shadcn, the profile donates the `form-label` text to the field, and the preview renders a `<label for>`.
- **Required.** Astryx sets `isRequired`. The shadcn 3.2.0 `input` has no required prop, so nothing is marked (a vocabulary gap).
- **Input purpose (SC 1.3.5).** This fails from the surface alone. Neither contract has `autocomplete` (sidecar notes), and both profiles map `email` to A2UI `shortText`, so even `type="email"` is lost on emission.
  - **The beta's exception is explicit.** auth-form ships in the experimental beta only under a recorded accessibility exception: it is written in `docs/blocks/BETA.md` with its host mitigation, and shown among the beta's known gaps.
  - **GA stays blocked** until the relevant vocabulary lands upstream (`autocomplete`, and `required` on shadcn) and the host semantics are defined: how a host's renderer carries input purpose, and what it does with entered values when an action fires.
- **Accessible authentication (SC 3.3.8).** The host must allow paste and password managers. Missing input purposes weaken autofill.
- **Errors (SC 3.3.1, 3.3.3, 4.1.3).** `form-message` is dropped as runtime data, so error text, `aria-invalid` and announcements are host-owned.
- **Order and names.** Submit stays inside the form (sidecar note), provider buttons have distinct names, and "Forgot password?" is a button.

**guide-steps.**
- Steps are a table: with "Step" and "Instruction" headers on Astryx, captioned on shadcn. Numbers and row order carry the sequence (SC 1.3.1, 1.3.2).
- There are no checkboxes, because checking off is presentation state (sidecar note). A host that adds checking owns the state and its announcement (SC 4.1.2).
- "Start" and "Save guide" are generic names; review them against SC 2.4.6. Changing them is a template change under the §13 policy.

**records-table.**
- Status keeps its text, so color is never the only signal (sidecar notes; SC 1.4.1). The shadcn preview uses `th scope="col"`.
- Caption: the shadcn profile routes `table-caption` to the A2UI `caption` prop, but `packages/shadcn-renderers/src/components/TableRender.tsx` does not render it. Astryx has no caption prop, so its caption is a separate text before the table.
- Up to 8 columns and 50 rows: check reflow at 320 px (SC 1.4.10).

**Across blocks, in the preview.** `packages/astryx-renderers/src/components/TextRender.tsx` renders heading variants as `<p>`, so block titles are not headings in the Astryx preview. `Separator` has no renderer in `packages/shadcn-renderers/src/registry.tsx`, so it draws through the wireframe fallback.

**Testing.**
- **Today.** `e2e/composer-blocks.spec.ts` runs axe in CI (`wcag2a`, `wcag2aa`, `region` off) on Settings, the Block row, the note and the receipt. It excludes the rendered canvas, because the wireframe fallback's annotation chips fail contrast, and it builds shadcn projects only.
- **NEW, automated.** Run axe on each rendered block surface, for each reference, on example and boundary calls, with the native registry and no canvas exclusion; fix or scope the chip contrast first. Add the `wcag21a`, `wcag21aa` and `wcag22aa` tags, and add Astryx builds to the e2e.
- **NEW, manual.** A keyboard pass and a screen-reader check (VoiceOver and NVDA) per block and reference; 200% zoom and 320 px reflow; visible focus; target size (SC 2.5.8). Check autocomplete by hand: axe cannot detect a missing `autocomplete`.

## 11. Documentation deliverables

- **`docs/BLOCKS.md`.** Replace "Status: Phase 0" and the stale Files note ("not wired into the app"), record the 1B result per reference, and add a Phase 2 section.
- **`docs/blocks/`.** Both Stage 3 reports with their manifests, each linked to its evidence branch and commit; `docs/blocks/baseline.json`, as a historical run record (§3); and a Phase 2 decision record (the branch and the §13 answers). These merge after the shadcn run closes.
- **`docs/blocks/HOST-ACTIONS.md` (NEW).** The host guide from §7.
- **`docs/blocks/BETA.md` (NEW).** Opting in, eligibility, storage per origin, known gaps, the runbook and the metrics.
- **`docs/deployment.md`.** The beta Worker, workflow, guards and rollback. Also fix its contradiction: it says both that the composer Worker never had a Workers Builds integration and that it has one.
- **`docs/release-checklist.md`.** A blocks beta section taken from §12.
- **`docs/CONTRACT-PIN.md`.** State what the pin covers, and that it does not cover the composer's 3.2.0 reference.
- **`docs/PHASE-NEXT.md`.** Update the P6 status.
- **RFC §9.** Record the answers, then open the upstream PR (Track 2).
- **In-product copy.** Settings still says "Reading the draft blocks…". All copy follows AF brand voice, with no em-dashes.

## 12. Release acceptance criteria

**Gate**
- [ ] G1 to G3 hold (§3), and the chosen branch is recorded in `docs/blocks/`.

**Beta scope**
- [ ] Only approved blocks in approved sidecars are offered (fail-first test).
- [ ] Named calls only, a budget of 3, and `maxCalls: 1` on block-mode requests; the existing e2e assertions still pass.
- [ ] On each offered reference, imported, repository, local-model and edited projects get no blocks, and the note says so (Astryx e2e added).
- [ ] In branch B or C, shadcn projects get no blocks, and the note says why.

**Flags and rollback**
- [ ] `apps/composer/out/` stays clean: `apps/composer/scripts/check-default-artifact.mjs`, the chunk scan in `e2e/composer-prod-smoke.spec.ts` and the `.github/workflows/deploy-composer.yml` guard all pass.
- [ ] The beta workflow refuses unflagged builds, and a test holds `wrangler.jsonc` to `apps/composer/out/`.
- [ ] The preference is off on a fresh origin, and a switch that is off, missing or unreadable offers no blocks (e2e with a stubbed `/api/models`).
- [ ] Opted-out beta requests hash to `packages/block-bench/results.json`, and production Worker replies are unchanged with the beta variables absent.
- [ ] A beta baseline is recorded against the beta deployment (the `docs/blocks/BASELINE.md` procedure).
- [ ] Rollback is rehearsed once on the beta: anchor recorded, rolled back, smoke green.

**Host actions**
- [ ] H1: a template with a model-controlled action id fails at load (fail-first).
- [ ] Emitted names equal the §7 table for every example and boundary call on each offered reference, and auth-form actions carry an empty context.
- [ ] The manifest is in the beta's Catalog export, and the default export is byte-identical.
- [ ] A test and the host guide show that a surface id plus an action name, without the block's verified provenance or expansion identity and the manifest, grants nothing.
- [ ] The owner has reviewed `docs/blocks/HOST-ACTIONS.md`.

**Provenance**
- [ ] Provenance is written only when the surface equals its expansion, reads as inert on a version or base mismatch, and the UI says which.
- [ ] An export and import round trip works in the beta, and a default build drops the field.

**Observability**
- [ ] Receipts split block and surface tokens, name each call's model, and show no estimate.
- [ ] The beta log line holds no prompt, schema or output (test).
- [ ] A canary Stage 1 on the deployed beta is clean: integrity holds, the served model is recorded, and the preflight matches the baseline.
- [ ] A metrics report in the form of the §9 table, with counts.

**Accessibility**
- [ ] axe passes on each rendered block surface on each offered reference, or a written waiver exists.
- [ ] Manual keyboard and screen-reader passes are recorded.
- [ ] The auth-form accessibility exception is explicit: recorded in `docs/blocks/BETA.md` with its host mitigation, and shown among the beta's known gaps. The beta does not ship auth-form without it.
- [ ] The release is labelled an experimental beta everywhere it appears; GA stays out of it, blocked on the vocabulary and host semantics in §10.

**Documentation**
- [ ] Every §11 deliverable is merged.

## 13. Open decisions for the owner

**Before the gate**
1. **Delivery.** Recommended: a separate beta origin with its own Worker (§6). Alternatives: a default-build flag, or a path on the production origin.
2. **Audience.** Recommended: invite-only for the first window (for example behind Cloudflare Access), then public opt-in. Alternative: public opt-in from the first day.
3. **Kill switch.** Recommended: a block-specific runtime switch with reference and block lists, plus `HOSTED_AI`. Alternative: `HOSTED_AI` and rollback only.
4. **auth-form and SC 1.3.5. Decided by the owner (2026-10-15):** the release is an experimental beta; auth-form ships only under an explicit accessibility exception; GA remains blocked on the relevant vocabulary and host semantics (§10).
5. **Branch B.** Recommended: go Astryx-only only if the owner wants to learn from a reference that is not the default; otherwise, no release.

**During the beta**

6. **Gateway.** Recommended: keep the shared `ds-ai-gateway` while traffic is small, and watch busy rates. Alternative: a separate gateway id.
7. **Telemetry.** Recommended: the canary plus an opt-in diagnostics export, with no beacon. Alternatives: none, or a consented beacon.
8. **Selection.** Recommended: planner-default with a per-turn opt-out. Alternative: a manual block picker, which is unmeasured.
9. **Change policy after the decision.** Recommended, three classes:
   - A change to a signature, the actions, the intents, the summary, the prompt or the model is a new block version and needs a new evaluation stage.
   - A template change that is presentational or for accessibility only needs the ratchet, new goldens, a Stage 1 smoke and owner approval.
   - A base re-bind with the blocks unchanged needs the ratchet and a Stage 1 smoke.
10. **Provenance across re-binds.** Recommended: inert in the beta. Alternative: carry entries forward when a block-definition digest is unchanged, as provenance `v: 2`.

**Track 2**

11. **Ratification timing.** Recommended: open the upstream RFC during the beta, and make GA depend on it. In branch B or C, hold it until a second reference passes.
12. **Upstream form (RFC §9).** Recommended: a separate artifact that the contract references by digest. Alternative: a section inside the contract.
13. **Positional encoding.** Recommended: no compatibility commitment; named calls only. On Astryx, the paired interval for positional's token reduction against named is -54.4% to -6.1%, so positional costs more.

**Branch C**

14. **Stage 4 for shadcn.** Recommended: authorize it only if Stage 3 completes as valid but uncertain, and the intervals could still flip the outcome (the addendum's stages). Status, 2026-10-16: Stage 3 completed valid and uncertain, and the pass-rate interval against capped (−8.0 to +10.3 points) crosses the margin, so the outcome could still flip.

## 14. Out of scope

- **OpenUI.** An independent emit track that never gates blocks (ADR-O1).
- **Further blocks.** The other nine families in `docs/BLOCKS.md`. Per-row actions also wait, on the dropdown-menu vocabulary (`docs/PHASE-NEXT.md` P4).
- **The full corpus** (Stage 4, 3,600 cells). A measurement decision under the addendum, not Phase 2 work.
- **Ollama and other local models.** There is no ADR-B3 evidence for them, and they stay ineligible (`local-model`).
- **Wider adoption.** Default-on (GA), eligibility for repository and imported projects, and refinement from stored provenance across sessions.
- **Action execution in Composer.** No action execution or runtime binding inside Composer (`docs/ARCHITECTURE.md` §9).
- **The exhibit** (`apps/web`).
