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

## Operational record

- **The daily spend limit.** For the shadcn/ui v3 run the owner raised the Cloudflare daily spend limit from $10 to $40, from 2026-10-15 22:47Z. Auto top-up stayed off. The change is recorded on the run's evidence branch. On 2026-10-16, after the run closed, the owner reported restoring the limit to $10, with auto top-up still off. No evidence branch records the restoration; this record does.
- **The hold in window 7.** Request #61 is held in the run's ledger at $1.118208 permanently, as the owner directed. The owner's AI Gateway log shows it as HTTP 502, with no recorded usage and no charge. The owner authorized window 8 only, as an explicit exception for that hold (the milestone report, section 6).
