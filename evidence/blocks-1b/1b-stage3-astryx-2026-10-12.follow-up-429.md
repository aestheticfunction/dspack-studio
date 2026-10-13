# Follow-up candidate: the Worker reads a gateway 429 from its message text

**Status, when written:** documented only, as the owner directed. No code change, pull request, merge or deployment had been made.

**Update, 2026-10-13:** the owner then approved the correction (option C). It landed as aestheticfunction/dspack-studio#101, merged to main as `eaf6ae3` and deployed as build `w6ajVrX5g8V0WhqowIBGN`.
- **It works differently from the fix proposed below.** The Worker reads the HTTP status the AI binding records for each reply (`env.AI.lastRequestHttpStatusCode`), not the gateway's log: the owner ruled out querying gateway logs at runtime. The message check remains only as a fallback, for when no status is known. The pull request's description gives the exact rules.
- **The trace and the effect on results stand as written.** Request 539's records and its $1.118208 hold are unchanged.

## What happened

**The request:** #539 of window 1, the first request of `astryx | block-positional | nb-02 | refine-add`. It was reserved at 01:25:47.892Z and finalized at 01:25:50.062Z on 2026-10-13, 2.2 s later.

**The Worker's reply** is not recorded. The run's files keep only the integrity stop's text: a refine call, outcome `provider-error`, no input tokens. With the code paths below, that implies a 502 `provider-unavailable`, `cause: "provider"`, with one call `{inputTokens: null, outputTokens: null, outcome: "provider-error"}` and `usage: null`.
- It is the only Worker reply to a gateway 429 that the harness neither releases nor retries.
- A transport failure between the harness and the Worker would read the same in the run's files. The gateway's log of a 429 for the request makes that unlikely.

**The harness's response:**
- **The run stopped:** its integrity check ended it with exit 3, `usage-missing`.
- **The ledger raised the request** to the most a request can cost, $1.118208 ("usage not verified"). The hold stays as the owner directed.

**What the gateway saw:** the owner's AI Gateway log shows the request as HTTP 429 for `anthropic/claude-haiku-4.5`, with no usage and no cost. It was a refusal: no model ran.

**The other refusals were handled correctly.** Eight other gateway refusals in this run took the busy path: 503 `busy`, released at no cost, and passed after one 30 s backoff each.

## The trace

1. **`runModel`** (`apps/composer/worker/propose.mjs`) calls `env.AI.run(PRIMARY, input, { gateway: { id: "ds-ai-gateway", collectLog: false } })`. When the gateway refuses, the binding rejects instead of returning a response.
2. **`callModel`** records the rejected call as `{inputTokens: null, outputTokens: null, outcome: "provider-error"}` and throws `CallFailure(error, calls, "provider")`. That failure carries the binding error's message.
3. **`failed()` classifies by the message alone:** `busy = failure !== "unusable-output" && /\b429\b|too many requests|rate.?limit|capacity/i.test(message)`.
   - The status of the gateway's reply is never read.
   - A message without those words gives 502 `provider-unavailable`, `cause: "provider"`.
4. **The harness** (`packages/block-bench/live/providers/hosted.ts`) releases a non-OK reply at no cost only when it shows that no model ran:
   - a Worker refusal made before any provider call;
   - a 503 `busy` reporting exactly one unspent `provider-error` call.

   Among these it retries only the 429s and 503s, after a backoff (`retryableRefusal`), for as long as the backoff schedule lasts. A 502 is neither, so it is settled as a provider failure:
   - `holdCalls` (`live/integrity.ts`) finds a call that reached the provider without whole token counts, and throws `RunHalted("usage-missing", …)`;
   - the ledger raises the request to its worst case.
5. **The result:** a refusal the gateway made before any model ran became an integrity stop, with a worst-case hold.

**Why the message did not match is unknown.**
- The Worker deliberately never logs or echoes a provider error's text, which can quote the prompt. The run kept nothing of the reply beyond what the integrity stop names.
- The binding declares its errors as plain `Error` subtypes, with no typed status field: `InferenceUpstreamError` and `AiInternalError` in `@cloudflare/workers-types` 5.20261013.1.
- The Worker's tests pin one message shape, `"InferenceUpstreamError: 429 Too Many Requests"`.
- So any 429 whose message lacks "429", "too many requests", "rate limit" and "capacity" takes the provider path. A spending or account limit worded otherwise would be one.

## Effect on results: it interrupts runs and cannot bias them

- **In a paced hosted run, which every Stage-3 run is, a misclassified refusal always stops the run.**
  - It never becomes a cell result: `holdCalls` throws before any record is written.
  - The cell in flight logs nothing and runs again from its start on resume.
  - No completed cell contains the refusal.
- **Dropping the first attempt selects nothing.** The refusal came before any model output, so nothing about the cell's outcome decided which attempt was discarded. The re-run draws the cell afresh.
- **Tokens per success do not change.** They are summed from the cells' own calls. The hold sits in the ledger alone and is in no arm's figures.
- **Without the pacer**, which no Stage-3 run uses, the same reply would be a `provider` failure. That is eligible for a re-run, left out of the pass rate and re-run symmetrically: again no bias.
- **What it costs is operational:**
  - a stopped run, and an owner authorization for each resume;
  - a worst-case hold in the committed total: $1.118208 here, 15% of the run's committed $7.63;
  - elapsed time: 33 minutes here between the stop and the resume.
- **It reaches production too.** A user whose request meets such a 429 is told "Hosted generation did not return a usable proposal" instead of "busy, try again in a moment".

## Proposed fix (minimal; not implemented)

**Classify a rejected call by the gateway's structured status, and keep failing safe.**
1. **Read the gateway's log entry after a rejection.** When `env.AI.run` rejects, read `env.AI.aiGatewayLogId`, then `env.AI.gateway("ds-ai-gateway").getLog(id)`.
   - This returns an `AiGatewayLog` with `status_code`, `success`, `tokens_in`, `tokens_out` and `cost`, as declared in `@cloudflare/workers-types` 5.20261013.1.
   - It is a read of the gateway's record of the request. No model is called.
2. **Call it a busy refusal only when** `status_code` is 429 and the entry shows no usage and no cost (`!tokens_in && !tokens_out && !cost`).
   - The reply is then today's 503 `busy` shape, with the one unspent `provider-error` call.
   - The harness already releases and retries that, so it needs no change.
3. **Fall back to today's message-based classification** whenever:
   - the log id is null;
   - `getLog` rejects (`AiGatewayLogNotFound`, `AiGatewayInternalError`);
   - the read passes a short bound, for example 2 s;
   - the entry shows any usage or cost.

   A provable refusal is released; anything else is held as now.
4. **Read only `status_code` and the usage figures.** Never read or echo `request_head` or `response_head`, which can hold the prompt, and never log the error message: the Worker's existing privacy rule.
5. **Keep the reply's shape.** It gains no keys, so the request goldens and the harness's refusal checks still hold.

**To settle before building it**, by the owner or by a no-cost check:
- whether `getLog` returns the entry when `collectLog` is false. The owner's dashboard shows this request's status and model without bodies, which suggests the metadata is kept;
- how soon after a rejection the entry can be read.

**An alternative with fewer unknowns but a larger change:** `returnRawResponse: true` on `env.AI.run`, then branch on the response's status before parsing. It changes how successful replies are parsed as well, so more can break.

**Not recommended: widening the message pattern** (with "limit", "quota" or "exceeded", say). It would release requests on wording alone, so a provider failure that did cost something could be released at zero. That is the opposite of the ledger's rule.

## Fail-first test plan

**Worker cases** (`apps/composer/worker/propose.test.mjs`), written against today's code first.
1. **The case that fails today:**
   - A rejected call with a message that has none of the words ("Gateway request rejected"), `env.AI.aiGatewayLogId = "log-1"`, and `env.AI.gateway().getLog("log-1")` resolving `{status_code: 429, success: false, tokens_in: 0, tokens_out: 0, cost: 0}`.
   - Expected: 503 `busy`, one call `{inputTokens: null, outputTokens: null, outcome: "provider-error"}`, `usage: null`.
   - Today it gives 502 `provider`.
2. **Unchanged:** `status_code` 500 gives 502 `provider`.
3. **Unchanged, failing safe:** `getLog` rejecting, or `aiGatewayLogId` null, gives 502 `provider`.
4. **Never released when spend shows:** `status_code` 429 with `tokens_out: 12`, or a `cost` above zero, gives 502 `provider`.
5. **Bounded:** a `getLog` that never settles gives 502 `provider` within the bound.
6. **The existing busy tests** (`"InferenceUpstreamError: 429 Too Many Requests"`) still pass, with no log read when the message already classifies.
7. **Privacy:** the reply never contains the error message, `request_head` or `response_head`, even when the entry has them.

**Harness pin** (`packages/block-bench/live/hosted.test.ts`, which already imports the Worker's `handlePropose`): the Worker's reply for case 1 satisfies `retryableRefusal`, and is released and backed off.

**Then:** `pnpm --filter composer test`, `pnpm --filter @dspack-studio/block-bench test` (the request-golden drift test included, with bytes unchanged), and `pnpm typecheck`.

**When it can land:** merging it redeploys the composer, because Workers Builds deploys main.
- It must land while no run is open: a run refuses to resume across a build change.
- A new zero-cost baseline follows the deployment.
