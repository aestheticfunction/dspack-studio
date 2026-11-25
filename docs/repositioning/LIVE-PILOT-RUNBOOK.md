# Live pilot runbook

**Status:** executed 2026-11-25; results in [LIVE-PILOT-REPORT.md](LIVE-PILOT-REPORT.md). As run, the temporary Access application was removed at cleanup (section 2 action 9 kept it) and requests were paced 31 s apart for the gateway's 5-per-minute limit. Written before the run:

## 1. Recommended restricted environment

**Put Cloudflare Access in front of `/api` only, admit one service token, then switch hosted AI on.**

| Path on `composer.aesthetic-function.com` | Public visitor | Pilot harness (service token) |
|---|---|---|
| `/` and every page and asset | Open, as today | Open |
| `/api/models` | Access login; the page falls back to Demo replay | Worker: `["scripted", "hosted-ai"]` |
| `/api/propose` | Access login; no generation | Worker: hosted generation |

Why this one:

- **The public site stays public.** Pages and assets are not covered. Public visitors keep Demo replay: when `/api/models` does not answer with JSON, the page's probe (`apps/composer/app/agent-client.ts` `hostedModels`) falls back to `["scripted"]`, and the availability notice says generation is unavailable.
- **No public generation, even for a moment.** Access is applied and checked before `HOSTED_AI` is switched on, and switched off before Access is removed.
- **The same pipeline and configuration as production.** The harness posts the app's exact request bytes to the deployed Worker, which calls Claude Haiku 4.5 through `ds-ai-gateway`. Nothing is redeployed for the pilot.
- **No code change in the Worker.** A shared-secret check in `propose.mjs` would do the same job, but it needs a code change, a secret and a production deploy. Access does it in the dashboard and is undone in the dashboard.

Rejected alternatives: Access on the whole hostname (closes the public site); `HOSTED_AI = "on"` with no Access (public generation, bounded only by the gateway's daily limit); a separate Worker or environment (more infrastructure, and not the production configuration).

**To confirm in the dashboard, because Cloudflare's documentation could not be read from this environment:** that a self-hosted Access application can be scoped to the path `api` and covers everything under it; that a "Service Auth" policy admits a service token by its `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers; and that one application and one service token cost nothing on the account's Zero Trust plan. The harness's preflight (section 3) verifies the result from outside either way, before any spend.

## 2. Owner actions, in order

| # | Where | Action | Spend |
|---|---|---|---|
| 1 | Zero Trust → Access → Service credentials → Service tokens | Create a token named `composer-live-pilot` with the shortest duration offered. Keep the client id and secret somewhere safe; give them only to whoever runs the pilot | None |
| 2 | Zero Trust → Access → Applications → Add → Self-hosted | Domain `composer.aesthetic-function.com`, path `api`. One policy: action **Service Auth**, include **Service Token** `composer-live-pilot`. Optionally a second policy allowing the owner's email, for checking in a browser | None |
| 3 | A terminal with the repository | Run `pilot check` (section 3). Expected now: the two public lines `ok`, and a `FAIL` saying hosted-ai is not offered, because hosted AI is still off. If a public line fails, stop: Access is not in front of `/api` | None |
| 4 | AI → AI Gateway → `ds-ai-gateway` | Confirm the daily spend limit is at most $10 and auto top-up is off, as `docs/deployment.md` records | None |
| 5 | Workers & Pages → `dspack-studio-composer` → Settings → Variables | Set `HOSTED_AI` to `on`. Changing a variable deploys a new version of the current code with that value | None until requests are sent |
| 6 | Terminal | Run `pilot check` again. Every line must read `ok` | None |
| 7 | Terminal | Run `pilot run` (section 3), once authorized | At most $5 |
| 8 | Workers & Pages → Variables | Set `HOSTED_AI` back to `off` | None |
| 9 | Zero Trust | Revoke the service token. Keep the Access application until the owner decides whether and for whom hosted AI comes back (decision N1); removing it while `HOSTED_AI` is off changes nothing for visitors | None |

**Rollback at any point:** set `HOSTED_AI` to `off` (immediate: the Worker refuses before any provider call), then revoke the token. A Worker rollback restores the target version's variables, and every version since 2026-10-18 carries `off`, so a rollback also switches hosted AI off. Removing the Access application is the last step, never the first.

## 3. Commands

The harness is `packages/block-bench/live/pilot/`. It reads the token from the environment and never writes it to a record or a log.

```bash
export PILOT_ACCESS_CLIENT_ID=<client id> PILOT_ACCESS_CLIENT_SECRET=<client secret>
```

Check access, with no model call. This checks four things: without the token, `/api/propose` is answered by Access, not the Worker; without the token, `/api/models` offers no hosted model; with the token, `/api/models` offers `hosted-ai`; with the token, the Worker refuses an empty body before any provider call and names each call's model:

```bash
pnpm --filter @dspack-studio/block-bench pilot check
```

Run the pilot. It runs the check first and sends nothing if any line fails. The run directory holds the ledger, the state and the evidence; re-running the same command resumes:

```bash
pnpm --filter @dspack-studio/block-bench pilot run --out acceptance/live-pilot/run-1
```

Read the totals at any time:

```bash
pnpm --filter @dspack-studio/block-bench pilot status --out acceptance/live-pilot/run-1
```

Stop before the next request; delete the file and run again to resume:

```bash
touch acceptance/live-pilot/run-1/STOP
```

Interrupting the process also stops it. A request in flight is then counted at the most a request can cost, and the next run starts from that total.

There is no option to choose prompts, the reference, the model or a higher ceiling. `--max-usd` can only lower the $5 ceiling. When the twelve runs are recorded, the pilot reports itself complete and sends nothing more: the full baseline needs its own authorization.

## 4. What the controls guarantee

| Requirement | How | Test (`pilot.test.ts`, no network) |
|---|---|---|
| A cumulative $5 ceiling across the whole pilot | One ledger file for every invocation and resume (`ledger.ts`), in whole nanodollars | Resume starts from the committed total; a torn last line is set aside |
| Worst-case reservation before dispatch | Each request is written at its priced worst case before it is sent, and admitted only while the most any request can cost ($1.12, at the model's documented limits) still fits (`providers/hosted.ts`, `cost.ts`, reused from Phase 1B) | Every request's reservation is on disk before the fake Worker answers it; a $1 ceiling admits nothing |
| Planning, generation, retries and repairs | Every request goes through the same provider: goal plans, flow plans, generations, repairs; the Worker's own parse retry is a second call inside one request, priced as such | A build that fails its gates makes one plan and three generation requests, each charged |
| Returned model identity | Every call must name Claude Haiku 4.5, and the same snapshot throughout (`integrity.ts`) | Another model stops the pilot; a different Haiku snapshot stops it |
| Provider usage reporting | A reply's usage must be itemized, stated once and within the request's bounds, or it is charged at the most it could cost; a call that reached the provider without usage stops the pilot | No usage stops it; usage past what a request can read is charged its absolute worst case; total stays at or under $5 |
| Early termination | $5 ceiling; another model or no usage; three consecutive provider failures; any 429; every plan identical across three goals; an operator `STOP` | One test per rule |
| No continuation into the baseline | A closed list of twelve runs; a complete pilot sends nothing | A second invocation after completion sends nothing |
| No generation outside the harness | Access on `/api`, checked from outside before any spend | The preflight refuses an unrestricted endpoint, a public `hosted-ai`, hosted AI still off, or a missing token |
| Corpus prompts and goldens unchanged | The three corpus prompts are read from `corpus.mjs` by number; no request builder changes | Prompts equal the committed corpus |

One rule is stricter than the proposal. A provider failure that reached the provider but reports no usage stops the pilot at once, because its cost cannot be verified (Phase 1B's integrity rule). The three-failure rule applies to failures that reached no model, such as the gateway's busy refusals. A pilot stopped this way can be resumed once the cause is understood.

## 5. Cost

| | Amount | Basis |
|---|---|---|
| Expected inference | About $1 | Phase 1B: about 16,000 tokens per successful Astryx build at $1 / $5 per million tokens and Cloudflare's 5% credit fee; about 60 provider calls |
| Ceiling the harness enforces | $5, cumulative | Committed spend plus unverified reservations; in practice the pilot stops once about $3.88 is committed, because the next request's absolute worst case ($1.12) must still fit |
| Outer bound outside the harness | The AI Gateway's daily limit, at most $10 | Owner action 4 |
| Access, service token | Expected to be none | To be confirmed on the account's Zero Trust plan |

What no reply can show stays outside the harness's bound: a call the gateway retried or billed without the Worker seeing it (`cost.ts`). The gateway's daily limit covers that case.

## 6. Risks

- **Access path behaviour is unverified here.** The preflight checks it from outside before any spend; if it fails, nothing is sent.
- **Public pages.** Covering `/api/models` turns the page's availability probe into a redirect. The page falls back to Demo replay by design, but the browser may log a console error for that request. The production smoke test filters `/api/models` errors. Run the production smoke suite once after owner action 2, with no spend.
- **Early stops.** A provider failure without usage, or a Haiku snapshot change mid-run, stops the pilot. That is intended; resuming is one command.
- **Expected limitations, not faults.** Astryx as contracted has no date, number or select input, and no purposes for loading, empty or result states ([ASTRYX-D5B.md](ASTRYX-D5B.md)). The hotel request will show this.
- **Scripted results never count.** The harness only talks to the Worker's hosted endpoint, and the preflight requires `hosted-ai` to be offered.

## 7. What is recorded

One JSON file per run in the run directory, a `requests.jsonl` ledger, `state.json` (completed runs, the served model, any stop) and `SUMMARY.md`. For each build the evidence records:

- the planned intent, and for a flow the steps proposed;
- the outcome, whether it passed first time, and the repairs used;
- each call's model, tokens and latency, and the build's cost;
- which components rendered natively and which as wireframes, or the emitter's refusal;
- the final surface.

Task fit is a checklist per goal, left unmarked for a person, and kept separate from the gates: passing the design system's rules is not doing what was asked. The proposal's decision table says what each pattern of results justifies next.
