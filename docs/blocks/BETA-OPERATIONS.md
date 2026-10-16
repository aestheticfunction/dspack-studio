# The beta's receipts and operator signals

Phase 2, step 5 ([PHASE-2-RELEASE-PLAN.md](PHASE-2-RELEASE-PLAN.md), §9). The owner authorized it on 2026-10-16, limited to what this page describes. It is built in the experimental artifact and in the Worker that production and the beta share. Nothing is deployed, no hosted canary has run, and production behaves as before:
- **Production's Worker** writes no new log line, because the variable that turns the log on is never set there.
- **Production's requests** are byte-identical. The Phase 0 oracle in `apps/composer/app/hosted-build.test.ts` still hashes every body.
- **Production's client** carries none of this code. `check-default-artifact` and the smoke suite scan for its markers in every build.

The owner's step-5 authorization takes the telemetry course the plan recommended (§13, decision 7): the canary plus a diagnostics export the user asks for, with no beacon. Nothing here sends anything on its own, and nothing here estimates a token count.

## Field data is never decision evidence

Receipts, operator log lines and diagnostics files are field data. They describe what one beta session or one Worker saw, and they can raise an alarm (below). They never feed the ADR-B3 decision, and no report may present them as its evidence. Decision-grade numbers come only from the owner-run canary, under the ADR-B3 definitions ([../BLOCKS.md](../BLOCKS.md), ADR-B3; [ADR-B3-ADDENDUM.md](ADR-B3-ADDENDUM.md)). The export file says this in its `notice`, and Settings says it beside the button.

## The receipt

In an experimental build, a finished turn shows a second receipt line under the default one whenever it has something to add: a block phase, a refinement, or a model that served a call. It is built by `betaReceipt` and `describeBetaReceipt` in `packages/composer-core/src/blocks/receipts.ts`. Its parts, joined by " · ":
1. **The split.** Only for a turn that ran a block phase.
   - Block calls are `block` and `block-repair`; surface calls are `generate`, `refine` and `repair`. Planning is in neither: the default receipt counts it.
   - Each side gives its model calls and their provider-reported input and output tokens. A call whose usage was not reported adds nothing to the sums and is named ("input not reported for 1 call"); it is never estimated, and never zero.
   - Requests that reached no model are counted apart: scripted calls, and requests refused before a provider call.
2. **The budget.** Only for a turn that ran a block phase: "budget U of 3 model calls".
   - U is every request the run's budget of 3 counted: block calls, block repairs, re-issues of an unusable output, surface repairs and the fallback. Planning is outside the budget (ADR-B4).
   - Re-issues are named ("1 re-issued"). When some counted requests reached no model, the line says "calls", not "model calls", and names how many ("1 reached no model").
3. **The refinement mode.** Only for a refinement, in words:
   - "compact refinement: the block's call was revised";
   - "switched to a full-surface refinement: the model answered that the block cannot express the change", or "...: the revised call did not pass the block's checks";
   - "switched to a full-surface refinement:" followed by why, before any block call: "the previous turn has no validated block call to revise", "the previous turn's block is no longer offered", "the previous surface was repaired after its expansion", or "the previous surface changed after its expansion";
   - "compact refinement, stopped by a provider failure", or "compact refinement, stopped: the expansion failed its invariant checks";
   - "full-surface refinement (no block)".
4. **The served model.** "served by M", or each model with its calls when there are several.
   - A call that names no model is counted ("model not named for 1 call").
   - A name that is not a model id is counted and never shown ("1 call named an unrecognized model"). A model id is at most 100 characters of letters, digits and `.` `_` `:` `/` `@` `+` `-` (`MODEL_ID_PATTERN`).

For example, a hosted block build whose planning reply named its model only at the top level, and whose block call named its own:

```
block 1 model call: 1,000 input + 50 output tokens · surface no calls · budget 1 of 3 model calls · served by claude-haiku-4.5 (1 call), claude-haiku-4-5-20251001 (1 call)
```

**Each call's own served model.** In an experimental build, each call record keeps the `model` its own entry in the Worker's `calls` list names (`callRecords` in `apps/composer/app/hosted-build.ts`). An entry that names none takes the reply's top-level `model`, which is how a Worker from before the per-call field answered. This is reply parsing only; request bytes do not change. Two consequences:
- A failed reply's calls that got a response now carry their model, an unusable output included.
- The default build keeps today's reading: every record of a reply takes the reply's top-level model.

The harness differs on purpose. It reads the per-call model only, and a call that names none stops a hosted run (`packages/block-bench/live/integrity.ts`). The app's fallback serves display, not measurement.

## The operator log

**The variable.** `BETA_OPERATOR_LOG` on the beta Worker, set in the dashboard as type Text to exactly `on`. Any other value, or none, writes nothing:
- **Production never sets it.** Production's `wrangler.jsonc` does not name it, and a test holds it there.
- **The beta's config declares no vars.** `wrangler.composer-beta.jsonc` keeps the dashboard's (`keep_vars: true`), so a deploy never resets the variable. To stop the log, delete the variable or set it to anything else; the next request writes nothing.

**The line.** One JSON line per `/api/propose` request, written with `console.log` after the reply is made, which Workers Logs keeps (`observability` is on in both configs). The fields, in this order:

| Field | Value |
|---|---|
| `event` | `"composer.propose"` |
| `v` | `1` |
| `status` | the reply's HTTP status |
| `error` | the reply's error code, or `null`; a code outside the Worker's list is `"other"` |
| `cause` | `"unusable-output"` or `"provider"` for a 502 `provider-unavailable`, else `null` |
| `maxCalls` | the `maxCalls` the request was accepted with (1 or 2), or `null` when it was refused first |
| `operation` | the operation the beta client named (`plan`, `flow-plan`, `block`, `block-repair`, `generate`, `refine`, `repair`), else `null` |
| `calls` | for each provider call, at most two: `outcome` (`ok`, `unusable-output`, `provider-error`, else `"other"`), `inputTokens` and `outputTokens` (the provider's report, or `null`), `model` (a model id, `"unrecognized"`, or `null` when none was named) and `durationMs` |
| `durationMs` | the request's duration in the Worker |

**What it never holds.** Built from an allowlist (`apps/composer/worker/operator-log.mjs`), it never holds:
- the prompt, the system prompt, the conversation, the schema or the output, or anything a model wrote;
- an error's message;
- a header, a cookie, a credential, an address or the user agent.

Every string in the line is a fixed code or a model id that passes the receipt's grammar.

**What it never changes.** The reply. With the log on, each reply's status, headers and body are byte-identical to the reply with it off (`apps/composer/worker/operator-log.test.mjs`). Only `/api/propose` logs: `/api/models`, unknown paths and assets write nothing.

**The operation header.** An experimental build names each request's operation in the `x-composer-operation` header. A header keeps the body byte-identical to the default build's, so the Phase 0 oracle holds. The default build never sends it. The Worker reads the header only for the log, and anything outside the seven operations logs as `null`.

## The diagnostics export

**Where.** Settings → Experimental → Diagnostics → "Download build diagnostics", in an experimental build only.

**When.** Only when the user presses the button. The file is saved on the user's device and sent nowhere. The runtime it needs is loaded when the section opens, so saving makes no request. The button is disabled until there is a build to describe.

**What it holds.** The file `composer-beta-diagnostics-<time>.json` holds one entry per build turn of the browser session, in the order they ran (`diagnosticsExport` in `packages/composer-core/src/blocks/receipts.ts`):
- `format` (`composer-beta-diagnostics`), `version` (1), `exportedAt` and the `notice` that it is never ADR-B3 decision evidence.
- For each turn:
  - its number, model reference (`hosted-ai`, `scripted` or `other`), status and outcome code;
  - its refinement mode and budget, and the receipt line;
  - its call records: operation, attempt, sub-call, source, outcome, provider-reported tokens, model and duration;
  - its timings: plan, first gated attempt, first valid preview, emit and total, in whole milliseconds;
  - the shape of its block trace:
    - the block id (a block this build bundles, else `other`), version, encoding, outcome, provider calls and expansion attempt;
    - the fallback classification, with its reason for a switch, and the provider error's classification;
    - the number of invariant failures, and the bundled block's schema and system digests;
    - each block attempt's outcome, its B1 and B2 issue counts, tokens and duration.

**What it never holds.** Every value is a code from a closed list, a number, a model id or a sha256 of the bundled sidecar's text. So the file never holds:
- the prompt, the plan's restatement or reasons, or the schema;
- the block call, any generated output or any surface content;
- an issue's text, or a digest of model text;
- a credential, an entered value or an action parameter.

The e2e spec `e2e/composer-blocks-receipts.spec.ts` and the composer-core tests (`receipts.test.ts`) inject sensitive-looking text into every field and prove none of it reaches the file.

**Scope.** Build turns live in memory, so a reload starts a new session with nothing to export. A flow outline's own planning call (`flow-plan`) belongs to no build turn and is not in the file; each flow step's planning call is, on that step's turn.

## The canary (owner-run; not run by this change)

The canary is the only source of decision-grade numbers about the beta. The owner runs the live harness against the beta origin:

```sh
pnpm --filter @dspack-studio/block-bench eval:live -- --provider hosted \
  --base-url https://composer-beta.aesthetic-function.com \
  --max-total-requests <n> --max-total-usd <dollars> --max-requests <n> --spacing-ms 3000
```

**Prerequisite, not built yet.** The beta sits behind Cloudflare Access, and the harness sends no Access credentials. A canary cannot reach the beta until the harness can send the Access service token reserved for this, `CF_ACCESS_CLIENT_ID_BETA` and `CF_ACCESS_CLIENT_SECRET_BETA` ([../deployment.md](../deployment.md), "The beta composer"). That support is a later, separately authorized change; until it lands, no canary runs.

**Rules.**
- **Caps.** Every run has a request cap and a dollar ceiling across all its invocations (`--max-total-requests`, `--max-total-usd`), and a per-invocation cap and spacing. They are recorded in the run's manifest ([../../packages/block-bench/live/README.md](../../packages/block-bench/live/README.md)).
- **Integrity stops.** The run stops cleanly at any call it cannot trust (`live/integrity.ts`):
  - a call that reached the provider without its usage or its served model;
  - a model outside Claude Haiku 4.5;
  - a model other than the one the run's first metered call recorded.
- **The served model held fixed.** One model per comparison (ADR-B3). A served-model change stops the run, and is an alarm (below).
- **When.**
  - A Stage 1 systems smoke after each beta deploy that changes block code or sidecars ([ADR-B3-ADDENDUM.md](ADR-B3-ADDENDUM.md), "The stages").
  - A pilot at a cadence the owner sets.
- **The minimum.** A canary decides only at or above the minimum of 20 prompt threads per arm. Below it, a canary can only warn.
- **The unit and the metrics** are ADR-B3's, with the addendum's paired intervals and counts beside every rate (the release plan, §9, "Metrics the beta reports").

## Alarms

The owner is alerted on any of these. The owner acts on them; nothing here acts on its own.

| Alarm | Where it shows | What the owner does |
|---|---|---|
| Any invariant failure | the turn's failure explanation; the diagnostics file (`block.outcome` `invariant-failure`, `invariantCount`); the canary's report | Disable blocks at once (`BLOCKS_BETA` off): an integrity failure |
| Any served-model change | the operator log (`calls[].model`), the receipt's "served by", a canary's integrity stop | Disable blocks at once: a model mismatch |
| A call that got a response without its usage | the operator log (a call with `outcome` `ok` or `unusable-output` and `inputTokens` or `outputTokens` `null`); the diagnostics file (such a call without a token figure); a canary's integrity stop | Disable blocks at once: an unmetered provider-reached call |
| An authorization or provenance failure | a host's report ([HOST-ACTIONS.md](HOST-ACTIONS.md)) | Disable blocks at once |
| Canary point estimates that cross an ADR-B3 threshold (tokens per success down less than 30%, or a pass rate more than 5 points below either primitive arm) | the canary's report | With at least 20 threads per arm, an alarm for the owner's decision; below 20, a warning only |
| Two consecutive non-busy provider errors | the operator log (`status` 502, `cause` `provider`) | Pause the beta |
| Busy or refusal responses at 10% over at least 20 beta requests | the operator log (`status` 503 `busy`, 429 and the other refusals) | Pause the beta |
| The shared gateway's daily spend at $8 | the gateway's dashboard | Pause the beta |

The stop conditions are the owner's ([PHASE-2-DECISION-RECORD.md](PHASE-2-DECISION-RECORD.md), "Step 2, authorized"). A pause turns blocks off and sets `HOSTED_AI` to `off` on the beta until the owner resumes it ([../deployment.md](../deployment.md), "Runbook"). No alert is automated yet: the owner reads Workers Logs, the gateway's dashboard and the canary's report. A field signal that crosses a threshold is a reason to look, never a decision.
