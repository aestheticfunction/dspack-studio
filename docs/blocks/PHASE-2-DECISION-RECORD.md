# Phase 2 decision record: branch C

**Decided by the owner on 2026-10-16.** This record holds the owner's acceptance of the Phase 1B result, the Phase 2 branch the owner chose, and the owner's answers to the release plan's open decisions ([PHASE-2-RELEASE-PLAN.md](PHASE-2-RELEASE-PLAN.md), §3 and §13).

It authorizes nothing beyond what it states. The owner directed G1 only, first: "a documentation-and-records PR with no runtime behavior change", which this record is part of. Each Phase 2 change still needs the owner's authorization. The first the owner gave, for step 2, is recorded below.

## The Phase 1B result, accepted

| Reference | Decision (ADR-B3, corpus v2, binding scoring) | Accepted |
| --- | --- | --- |
| Astryx | **pass, clear** | 2026-10-13 |
| shadcn/ui v3 | **pass, uncertain** | 2026-10-16, as valid |

The evidence and what the results mean are in [PHASE-1B-MILESTONE-REPORT.md](PHASE-1B-MILESTONE-REPORT.md). The two runs' reports, manifests and preflights are in [stage3/](stage3/README.md).

## The branch: C

The plan's §3 defines the branches by the shadcn/ui v3 result. An uncertain result is branch C: an Astryx-only beta now, with shadcn/ui v3 joining only if a Stage 4 that the owner authorizes passes clearly. **The owner selected branch C.**

## The owner's decisions

1. **Proceed with an Astryx-only experimental beta.**
2. **Do not authorize shadcn/ui v3 Stage 4 now.** In the owner's words: its results are promising, but the personal cost of the larger experiment is not worthwhile at this stage.
3. **Record this as a deferral,** not a shadcn/ui v3 failure or a permanent exclusion.
4. **Withhold shadcn/ui v3 blocks from the beta,** and explain that its evaluation remains inconclusive.
5. **Delivery:** a separate beta origin and Worker (plan §13, decision 1).
6. **Audience:** invite-only first. Public opt-in is considered after the first clean beta window (decision 2).
7. **Kill switch:** a block-specific runtime kill switch with reference and block allowlists, in addition to `HOSTED_AI` and rollback (decision 3).
8. **auth-form:** included under the documented accessibility exception and its host mitigation. GA remains blocked on the vocabulary gap (decision 4; the release plan §10).
9. **Encoding:** named encoding only (decision 13).
10. **Gateway:** keep the shared gateway initially, with the documented monitoring and stop conditions (decision 6).

Decision 5 (branch B) does not arise. Decision 14 (Stage 4 for shadcn/ui v3) is answered by decision 2 above.

For context, not the owner's words: shadcn/ui v3 met every criterion on the rule's point estimates, and its decision is uncertain because one criterion's interval crosses its threshold ([PHASE-1B-MILESTONE-REPORT.md](PHASE-1B-MILESTONE-REPORT.md), section 4.1).

**Still open,** for the owner during the beta: telemetry (decision 7), selection (8), the change policy after the decision (9), and provenance across re-binds (10). Step 5's authorization has since taken decision 7's recommended course ("Step 5, authorized", below). Under branch C the plan holds ratification (decision 11, and so the upstream form, 12) until a second reference passes clearly.

## Reconsidering shadcn/ui v3

Under branch C, shadcn/ui v3 joins the beta only if an owner-authorized Stage 4 passes clearly under the unchanged frozen rule. The milestone report proposes what could make Stage 4 worth its cost, for the owner to weigh ([PHASE-1B-MILESTONE-REPORT.md](PHASE-1B-MILESTONE-REPORT.md), section 11). Those proposals are not owner decisions.

## The gate (plan §3)

- **G1, records on main:** this change. It commits the two Stage 3 reports with their manifests and preflights, their run ids, and links to their evidence branches and commits. It also commits `docs/blocks/baseline.json` ([BASELINE.md](BASELINE.md)). It merges only after the shadcn/ui v3 run closed, which it did on 2026-10-16.
- **G2, the shadcn/ui v3 decision is known:** met. The result is pass, uncertain, accepted as valid.
- **G3, the branch and the decisions marked "before the gate":** met. The owner chose branch C and answered decisions 1 to 4; decision 5 does not arise.

## Step 2, authorized (2026-10-16)

After G1 merged (aestheticfunction/dspack-studio#103), the owner treated the gate as open and authorized the plan's step 2, the beta's delivery path, guards and switches, as its own PR: no deploy, no Cloudflare change, no paid model call. The owner's inputs:

- **Hostname:** `composer-beta.aesthetic-function.com`.
- **Audience:** Cloudflare Access, the owner only. Anyone more needs an explicit later decision.
- **The switch:** the variable `BLOCKS_BETA`, strict JSON: `{"enabled":true,"references":["astryx"],"blocks":["records-table","auth-form","guide-steps"]}`. Unknown fields, references or block ids are rejected. Missing, malformed, unreadable or disabled configuration fails closed and offers no blocks.
- **Credentials:** a dedicated least-privilege deploy token, `CLOUDFLARE_API_TOKEN_BETA`, never the production token. `CF_ACCESS_CLIENT_ID_BETA` and `CF_ACCESS_CLIENT_SECRET_BETA` are reserved for a later authenticated smoke.
- **Gateway:** the shared gateway at first, with its $10 daily limit and auto top-up off.
- **Initial stop conditions:** disable blocks at once on any model mismatch, unmetered provider-reached call, integrity failure, or authorization or provenance failure. Pause on two consecutive non-busy provider errors; when busy or refusal responses reach 10% over at least 20 beta requests; and when the shared gateway's daily spend reaches $8, leaving headroom below the $10 hard limit.

How these are applied is in [../deployment.md](../deployment.md), "The beta composer".

## Step 5, authorized (2026-10-16)

The owner authorized the plan's step 5, receipts and operator signals (§9), as its own PR. The owner limited it, in the owner's words, to:
- "beta receipts that split block and surface tokens using provider-reported usage only;"
- "each call's own served model, with the documented top-level fallback;"
- "exact call-budget usage and the refinement mode in plain language;"
- "beta-only, shape-only operator logging gated by a variable production does not set;"
- "one structured record containing only status, error classification, `maxCalls`, call operation/outcome, token counts, served model and duration;"
- "a user-initiated diagnostics export containing durable traces, call records, timings and outcomes, with no prompt or model-generated text;"
- "documentation of the canary and alarm rules, without running a hosted canary."

And preserved its scope: "no beta deploy, Cloudflare changes, accessibility work, shadcn, Stage 4, catalog changes, action execution or paid model calls."

The owner's privacy and compatibility requirements, in the owner's words:
- "never log or export prompts, schemas, generated output, surface content, credentials, entered values or action parameters;"
- "no automatic beacon or client telemetry;"
- "no estimated token values;"
- "no production logging change when the beta variable is absent;"
- "production request bytes and default artifact remain unchanged;"
- "field data must never be presented as ADR-B3 decision evidence."

This takes decision 7's recommended course: the canary plus a diagnostics export the user asks for, with no beacon. How it is applied is in [BETA-OPERATIONS.md](BETA-OPERATIONS.md).

**Confirmed by the owner (2026-10-16),** when the owner directed step 5's merge, in the owner's words:
1. "In the invite-only live beta, a provider error that produces no usable response or result counts toward the 'pause after two consecutive provider errors' rule. It does not trigger immediate disable on the first transient failure."
2. "Immediate disable still applies when: a provider-reached call returns a completed or usable result without mandatory usage accounting; or the served model is missing or does not match the expected model."
3. "The canary remains fail-fast on any missing usage or model identity."
4. "I accept the decision-record wording and the documented minifier-only runtime rename. Neither changes the frozen experiment conclusion or public contract."

## Step 6, authorized (2026-10-16)

The owner authorized step 6 in the message that directed step 5's merge, to begin once step 5's post-merge checks passed: "accessibility hardening for the Astryx beta path" (the plan's §10), on a fresh branch, as its own PR, neither deployed nor merged automatically. Its scope, in the owner's words:
- "Treat WCAG 2.2 AA as the target."
- "Test native rendered surfaces for authentication, recipe/guide, and analytics/table blocks using example and boundary payloads."
- "Add automated axe coverage for wcag2a, wcag2aa, wcag21a, wcag21aa, and wcag22aa."
- "Fix Astryx heading semantics and any relevant contrast, keyboard, focus, target-size, 200% zoom, or 320px reflow defects."
- "Record manual keyboard and screen-reader evidence where the environment supports it. Clearly identify any checks still requiring human verification; do not claim unsupported NVDA or VoiceOver testing."
- "Document the auth-form SC 1.3.5 limitation and beta host mitigation. Do not expand the upstream component vocabulary in this PR."
- "Run shadcn accessibility scans for information only. They do not gate this Astryx-only beta, and shadcn renderer fixes should be deferred unless essential to the shared test harness."
- "Do not change block signatures, templates, prompts, model selection, frozen evaluation evidence, or release-admission decisions."
- "Preserve default production request and artifact invariants."

How it is applied, and what still needs a person, is in [ACCESSIBILITY.md](ACCESSIBILITY.md). The auth-form exception and its host mitigation are in [BETA.md](BETA.md).

## The release candidate and the waivers (2026-10-17)

The owner directed step 6's merge and a bounded release-candidate closeout on 2026-10-17: "Do not begin another open-ended hardening cycle." In the owner's words:

**Step 6's merge** (aestheticfunction/dspack-studio#110, squash-merged as `7ff13c9`): "I accept the shared renderer, canvas and Composer shell accessibility changes; do not split them into another PR."

**The waivers** that step 6 proposed ([ACCESSIBILITY.md](ACCESSIBILITY.md), "Waivers"):
1. auth-form SC 1.3.5: "Accept as a documented invite-only beta exception with the existing host mitigation. It remains a blocker for GA."
2. Astryx resting field border: "Accept temporarily for the invite-only beta, but do not claim full WCAG 2.2 AA conformance. Record a 3:1 treatment as required before public expansion or GA."
3. "Start" and "Save guide": "Accept for the invite-only beta in their current context."
4. shadcn/ui findings: "Accept as deferred because shadcn is withheld and is not part of this beta."

**The freeze.** "Then freeze the resulting main SHA as the release candidate. From that point until the first beta deploy, do not merge opportunistic improvements or nits." The release candidate is `main` at `7ff13c96c7b0ef6d8d7bacc91b9e3c2d839a771c` ([RELEASE-REVIEW.md](RELEASE-REVIEW.md)). "A new finding may block the beta only if it involves:
- an authentication or invite-access bypass;
- security, privacy or sensitive-data exposure;
- data loss or corruption;
- provider spending or model/usage integrity;
- a broken kill switch or rollback path;
- inability to complete a core task with keyboard or screen-reader access;
- a regression in production isolation or request-byte invariants.

Everything else must be recorded in a post-beta backlog instead of starting another fix-and-review cycle." The backlog is [POST-BETA-BACKLOG.md](POST-BETA-BACKLOG.md).

**Step 7.** "Next, perform Phase 2 Step 7 as a release review against the existing §12 acceptance criteria. Produce one pass/fail matrix with evidence links. Do not implement new work merely because an item could be improved." The review is [RELEASE-REVIEW.md](RELEASE-REVIEW.md).

**The official beta.** "At minimum, require a real keyboard pass in Safari and Firefox and a real screen-reader pass for the three Astryx blocks before calling the release an official beta. Do not claim NVDA, VoiceOver or TalkBack evidence that was not actually collected." The packet is [MANUAL-A11Y-PACKET.md](MANUAL-A11Y-PACKET.md).

**The audience.** "Because composer.aesthetic-function.com is currently publicly reachable and I want AF Composer itself to be invite-only, the Access plan must protect: 1. composer.aesthetic-function.com; and 2. the separate beta Composer hostname. Use one explicit allowlist policy for both. Do not infer the allowed users or domains; stop for that list before applying Access." This superseded step 2's audience, "the owner only" (above), and was itself superseded the same day by the single-host amendment (below), which drops the separate beta hostname and Worker. As first stated, the deployment design stayed as step 2 set it: "a separate beta Worker and hostname serving the experimental artifact; Astryx only; the user preference off by default; the block runtime switch initially off; the existing production artifact kept free of block code; independent rollback anchors and kill switches." No Access change is applied until the owner provides the invite identities.

**The sequence** (replaced by the single-host amendment's order A to I, below). "Once the release matrix passes, the human checks are recorded, and Access is confirmed:
- deploy the beta with the block switch off;
- record its baseline and rollback anchor;
- rehearse rollback;
- run the zero-cost smoke checks;
- propose the exact capped Stage 1 canary command and expected maximum cost;
- do not make the paid calls until I explicitly authorize that canary;
- if the canary is clean, recommend enabling Astryx blocks for invited users."

**The UI redesign.** "UI redesign is deliberately outside this closeout. Record it as the next planning phase, informed by invite-only beta feedback." It is recorded in [POST-BETA-BACKLOG.md](POST-BETA-BACKLOG.md).

## The single-host amendment (2026-10-17)

Later on 2026-10-17 the owner changed the deployment decision. This is a deliberate amendment to the release plan's recommendation of a separate beta origin (§6 and §13, decision 1, as decided on 2026-10-16). The owner's decisions, in the owner's words:

1. "Do not create composer-beta.aesthetic-function.com or any other new subdomain."
2. "Do not create dspack-studio-composer-beta or another Worker."
3. "Use the existing composer.aesthetic-function.com hostname and existing Composer Worker for the invite-only beta."
4. "The existing public Composer will become the invite-only beta at cutover."
5. "Do not implement a client-side password screen or store a shared password in application code."
6. "Use Cloudflare Access on composer.aesthetic-function.com, with email one-time PIN and initially only the owner's exact email."
7. "Additional tester email addresses can be added later."
8. "Do not create a service token yet. Record that the hosted canary remains blocked until a temporary machine credential is explicitly authorized."
9. "UI redesign remains the next planning phase and does not block this beta closeout."

**The consequences the owner accepted**, in the owner's words:
- "production and beta no longer have independent hostnames, Workers or rollback controls;"
- "applying Access will remove anonymous access to the existing Composer;"
- "the experimental artifact will eventually replace the default artifact on the current live origin;"
- "the default block-free artifact and release candidate must remain available as the rollback anchor;"
- "browser storage is shared with the existing origin, so the beta instructions must tell testers to start from packaged references or fresh Example sessions;"
- "Access must be active and verified before the experimental artifact is deployed;"
- "workers.dev and preview URLs must be disabled or proven inaccessible so they cannot bypass Access;"
- "rollback restores the block-free release candidate for the same hostname;"
- "no claim of full WCAG 2.2 AA conformance is made during this invite-only beta."

**The cutover order**, in the owner's words. A cutover change is prepared and not deployed; it "must preserve the current release candidate 7ff13c9 as the rollback anchor and enforce this order:
- A. Configure Cloudflare Access on composer.aesthetic-function.com.
- B. Allow only the owner's exact email through one-time PIN.
- C. Confirm anonymous GET requests and anonymous POST requests to the hosted endpoint are denied before reaching the Worker or provider.
- D. Confirm workers.dev and preview URLs cannot bypass Access.
- E. Confirm the owner can sign in and use the existing application.
- F. Only then deploy the experimental artifact to the existing Worker with the block runtime switch off.
- G. Record the deployed baseline and rehearse rollback to 7ff13c9.
- H. Run zero-cost scripted-mode and accessibility checks.
- I. Stop before any hosted canary or paid provider call."

"Do not implement shared-password authentication unless Cloudflare Access OTP is shown to be unworkable. If that happens, stop and propose a separate edge-auth design; never use a cosmetic client-side password gate." The owner's exact email is the only human-access value still needed; it is not inferred, and it is not recorded in this repository.

**The canary**, two future options, as the owner set them:
- recommended: "create a narrowly scoped, short-lived Access service token immediately before the canary and revoke it immediately afterward;"
- alternative: "remain at CONDITIONAL GO and do not call the release an official live beta until another secure harness-authentication method is approved."

"Do not start another general hardening cycle. Only release blockers from the previously frozen severity classes may generate additional implementation work."

How these are applied: [BETA-DEPLOY-PLAN.md](BETA-DEPLOY-PLAN.md). Until the cutover change merges, `main` still carries the separate beta Worker's config and workflow (`wrangler.composer-beta.jsonc`, `.github/workflows/deploy-composer-beta.yml`). They are superseded: no beta Worker or hostname is to be created, and that workflow is never to be dispatched.

## Operational record

- **The daily spend limit.** For the shadcn/ui v3 run the owner raised the Cloudflare daily spend limit from $10 to $40, from 2026-10-15 22:47Z. Auto top-up stayed off. The change is recorded on the run's evidence branch. On 2026-10-16, after the run closed, the owner reported restoring the limit to $10, with auto top-up still off. No evidence branch records the restoration; this record does.
- **The hold in window 7.** Request #61 is held in the run's ledger at $1.118208 permanently, as the owner directed. The owner's AI Gateway log shows it as HTTP 502, with no recorded usage and no charge. The owner authorized window 8 only, as an explicit exception for that hold (the milestone report, section 6).
