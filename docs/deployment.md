# Deployment

Two artifacts, deliberately separable:

| Artifact | What it is | Needs |
|---|---|---|
| `apps/web` | fully static export (`apps/web/out`) — the whole replay experience, all curated fixtures, session import, inspectors, Break-it deterministic docs | any static host; no server, no keys |
| `apps/agent` | small Node HTTP server (AG-UI SSE + `/action`) — live generation and interactive scenarios | Node ≥ 22, a reachable model backend for `ollama:*` refs |

## Production (live since 2026-07-11)

**https://studio.aesthetic-function.com** runs the static-only topology on
**Cloudflare Workers Static Assets**, configured by the committed
`wrangler.exhibit.jsonc` at the repository root.

**Deployment is explicit (issue #34).** CI verifies every merge to `main`;
production deploys only when a person dispatches the
`deploy-exhibit` GitHub Actions workflow (frozen install → contract gates →
`pnpm build:deploy` → rollback-anchor capture → `npx wrangler deploy
--config wrangler.exhibit.jsonc` → production smoke), or runs the same sequence
locally:

```sh
pnpm build:deploy                       # contracts + static export -> apps/web/out
npx wrangler deployments list --config wrangler.exhibit.jsonc   # record the rollback anchor FIRST
npx wrangler deploy --config wrangler.exhibit.jsonc
npx playwright test --config playwright.production.config.ts
```

Rollback: `npx wrangler rollback --config wrangler.exhibit.jsonc` — fully
independent from the composer Worker (`wrangler.jsonc`); neither
rollback touches the other.

The workflow authenticates with the repository secret
`CLOUDFLARE_API_TOKEN` (Account → Workers Scripts → Edit, that account
only). Until the secret exists the workflow is inert.

**The previous implicit path (disconnected 2026-08-04):** the
`dspack-studio` Worker carried a Cloudflare Workers Builds Git integration — repository
`aestheticfunction/dspack-studio`, production branch `main`, root directory
`/`, build command `pnpm --dir apps/web run build`, deploy command
`npx wrangler deploy`, no path filters, no environment variables — which
rebuilt and redeployed the exhibit on **every** push to `main` (observed
six consecutive times on 2026-08-04, four of them from commits touching
nothing the exhibit consumes; evidence in #34). The owner disconnected it
on 2026-08-04 (Workers & Pages → `dspack-studio` → Settings → Build →
disconnect the Git repository); disconnecting stops future git-triggered
builds only — the Worker, its versions, its route, and the custom domain
are unaffected. At the time the composer Worker had no such integration,
and its deploys were explicit. By 2026-08-08 it had one: see the composer,
below.

The web build is self-sufficient on a clean checkout: `apps/web`'s `build`
script generates the gated contract artifacts first (`packages/contracts/out`
is gitignored emission output) and then runs the Next.js static export.
`pnpm build:deploy` remains the canonical local command: it does the same
and additionally verifies `apps/web/out` exists.

Analytics: Cloudflare Web Analytics (zone-injected beacon, cookieless).

Production smoke suite (agent-free specs against the deployed site):

```sh
npx playwright test --config playwright.production.config.ts
```

## The composer (second Worker)

**https://composer.aesthetic-function.com** is the catalog composer
(`apps/composer`), deployed as its **own** Worker so the exhibit and the
composer keep independent deploy cadences. It is the **repo-root
`wrangler.jsonc`** — deliberately, because the composer Worker
(`dspack-studio-composer`) is the one connected to the GitHub → Cloudflare
**Workers Builds** integration, which reads `./wrangler.jsonc` by default;
the name, route, and assets there match the deployed Worker (Cloudflare's
reconciliation request). Static Assets from `apps/composer/out`, the custom
domain declared in `routes` (wrangler attaches it; Cloudflare manages DNS).

**Static-first, with ONE governed API namespace.** `worker/index.mjs` sets
`main`, and `assets.run_worker_first` is scoped to `/api/*`, so every ordinary
request is served by the asset layer exactly as before; only `/api/*` enters
Worker code, and any non-API fall-through is delegated to `env.ASSETS.fetch`
unchanged. The one runtime binding is the **AI binding** (`"ai": {"binding":
"AI"}`): hosted Build proposals go to Claude Haiku through the account's
**`ds-ai-gateway`** — the SAME gateway the af-site theme generator uses (shared
zone ⇒ shared account) — over Unified Billing, so there is **no provider key, no
BYOK credential, and no gateway secret**. No KV, Durable Objects, or databases.
A `HOSTED_AI` var is the kill switch.

**Cost protection (measured 2026-08-09).** The **enforced** cap is the
`ds-ai-gateway` zone rate limit — a concurrent burst to `/api/propose` is
rate-limited to `503 busy` (verified), which bounds total Haiku spend zone-wide
— plus the kill switch, the per-call `max_tokens`, and the request body-size
cap. The Worker also declares a native per-client rate-limit binding
(`PROPOSE_RATE_LIMIT`) for fairness, but that binding **does not currently
enforce on this account** (`.limit()` reports success for every call; 20+ rapid
requests all passed). It is kept as forward-compatible defense-in-depth; the
gateway ceiling is the real gate. A per-client KV/DO counter is the follow-up if
per-IP fairness becomes necessary.

**Busy refusals.** The Worker answers `503 busy`, a refusal that cost nothing,
only when the gateway turned away the request's only call before any model ran:
- **A known status decides.** The AI binding records the HTTP status of each
  reply (`lastRequestHttpStatusCode`) before it throws, and busy needs every
  known status to be a numeric 429; any other is a provider failure (`502`),
  whatever the error's message says. The binding's status counts as the call's
  own only when the Worker cleared it to `null` just before the call and no
  other model call in the isolate overlapped it; never after the Worker's own
  45 s timeout, and never for a call the binding threw on before returning. A
  call the binding never settles stops counting 5 minutes after it began.
- **Only when no status is known does the message decide**, by its busy words,
  as before.
- **A request that may have spent is never busy:** a 429 after an unusable
  first output, or an error that shows a model result, as a usage, token or
  `model` field, or as a quoted usage or token key in a string such as its
  message (the binding makes a reply's whole body the message when the body
  names no error code; a model's name alone in text does not count, since a
  refusal's body may name the model it refused). An error that holds what
  cannot be read in full, such as a `Response` and its body, counts as showing
  one.
- **This trusts that `ds-ai-gateway` answers 429 only before it forwards a
  request.** Keep its Retry Requests setting off, and if guardrails or DLP are
  enabled, check that they never block an answered request with a 429. The
  gateway is shared with the af-site theme generator, so its settings are a
  shared precondition.

A paced bench run backs off and retries a busy refusal until its backoff
schedule is spent, then reads it as a provider failure; a bench run without the
pacer reads it as a provider failure at once. In the browser, a busy generation
call shows the generic failure headline, "The model provider could not produce
a result — nothing was generated", with the Worker's busy message as the reason,
for the visitor to try again; a busy planning call falls back to deterministic
routing, as any failed planning call does.

Crucially, the Worker **never runs the deterministic pipeline** — Cloudflare
Workers ban the runtime `new Function` that AJV (S1/S2/S3 + emit) needs, so
S1/S2/S3, repair, emit, audit, preview, and export all run in the visitor's
**browser**; the Worker's only job is the one nondeterministic step, forwarding
a proposal request to Haiku. The hosted composer ships the pre-emitted demo
project; a visitor can watch the whole governed loop (scripted or hosted-ai)
with no install. Connecting your **own** project, saving worked examples, and
local/BYO models still run on the visitor's machine via the local agent
(`pnpm --filter agent dev`), stated plainly in the UI. No user project source is
ever uploaded or executed, and the visitor's prompt is never logged
(`collectLog: false`).

The composer therefore has **two deploy paths**: the reconnected Workers
Builds Git integration (auto-deploys the root `wrangler.jsonc` to the
production composer from `main`, below), and the explicit **`deploy-composer`**
GitHub Actions workflow for a dispatched, gate-checked deploy (same posture
as `deploy-exhibit`): it re-verifies the composer, records the rollback
anchor, deploys through `wrangler.jsonc`, and runs the production smoke. It
is inert until the `CLOUDFLARE_API_TOKEN` repository secret exists. The
equivalent local sequence:

```sh
pnpm build:deploy:composer                          # demo assets + static export -> apps/composer/out
npx wrangler deploy --config wrangler.jsonc
npx playwright test --config playwright.composer-production.config.ts   # smoke against the deployed URL
```

**The integration deploys `main`.** The three Phase 1B merges whose
deployments were timed each redeployed the composer within minutes, with a
new build id:
- aestheticfunction/dspack-studio#100 about two minutes after its merge,
  #101 about three and #102 about six;
- the evidence branches' READMEs record each time: the Astryx Stage 3
  branch for #100, and the `eaf6ae3` and `7e260c3` baseline branches for
  #101 and #102, all linked from `docs/blocks/PHASE-1B-MILESTONE-REPORT.md`,
  section 13;
- the `deploy-composer` workflow has never been dispatched, so those deploys
  came through the integration.

So treat any merge to main, documentation included, as a composer redeploy.
It changes the build id a hosted evaluation run is held to.

The integration's settings live in the Cloudflare dashboard (Workers & Pages →
the composer Worker → Settings → Build), and this repository does not record
them. The build it needs is `pnpm build:deploy:composer`, deployed with
`npx wrangler deploy --config wrangler.jsonc`, as the workflow does.

**Stop any local agent on `localhost:8787` before running the composer
production smoke.** The deployed page probes that port from the visitor's
browser — that is the product working as designed — so an agent running on
the machine executing the smoke makes the hosted page report
`agent: connected`, and the spec asserting honest degradation without an
agent fails. The failure is environmental, not a regression: stop the agent
(the `pnpm --filter agent dev` process) and re-run. Do not "fix" this by
changing the product's localhost connection behavior, and do not weaken the
assertion — degrading honestly when no agent is present is exactly what the
spec exists to protect.

Rollback: `npx wrangler rollback --config wrangler.jsonc` (or
redeploy the previous commit); the exhibit Worker is untouched either way.

## The beta composer (third Worker)

**https://composer-beta.aesthetic-function.com** is where the interface-blocks
beta will run ([blocks/PHASE-2-RELEASE-PLAN.md](blocks/PHASE-2-RELEASE-PLAN.md),
§5 and §6). It serves the EXPERIMENTAL artifact, `apps/composer/out-experimental`,
on its own Worker, `dspack-studio-composer-beta`, configured by
`wrangler.composer-beta.jsonc`. The path is built and guarded but not deployed:
nothing has been sent to Cloudflare, and the first deploy waits on the owner's
prerequisites below.

**What it shares with production.** The beta runs production's Worker code
(`apps/composer/worker/index.mjs`) on the same compatibility date, and reaches the
same `ds-ai-gateway` through the AI binding. Everything else is its own: the
Worker, the hostname, the deploy path, the rollback, the rate-limit namespace,
and the visitors' browser storage (a separate origin). Production's
`wrangler.jsonc` still serves `apps/composer/out`, which never carries block
code, and a test holds it there.

**Who can reach it.** Cloudflare Access protects the hostname, for the owner
only; adding anyone needs an explicit later decision. Access protects the custom
domain, so the beta config turns off the Worker's other entry points,
`workers_dev: false` and `preview_urls: false`, and a guard refuses a config that
turns either on. The workflow's Access check proves that anonymous requests go
to the Access login, not who that login lets in, so the owner confirms the
policy by hand (below).

**How it deploys.** Only the `deploy-composer-beta` GitHub Actions workflow
deploys it: dispatched by hand from `main`, confirmed by typing
`deploy-composer-beta`, and run in the protected `composer-beta` environment.
There is no local deploy path: one would skip the required reviewer, the
`main`-only rule and the dedicated token. Never connect this Worker to Workers
Builds: that integration reads `./wrangler.jsonc` and deploys production on
every merge. The workflow:
1. refuses to run without the beta's own token and account id, which reach only
   the steps that run wrangler, never the install or the build;
2. installs from the frozen lockfile and builds the experimental artifact;
3. runs the guards, `apps/composer/scripts/check-beta-deploy.mjs`: both configs,
   and an artifact that carries the block code and the switch;
4. checks that anonymous requests already go to the Cloudflare Access login.
   Only a hostname that does not exist yet (DNS not found) passes without
   that; any other failure does not, and neither does a bare 401 or 403, which
   a WAF rule or bot challenge could send this runner alone. A first deploy
   skips this check (below);
5. records the rollback anchor, and refuses to deploy without one, unless
   the dispatch is marked `first_deploy` and wrangler reports that the beta
   Worker does not exist (code 10007). It refuses `first_deploy` once the
   Worker exists. wrangler itself is installed first, with no credentials;
6. deploys with the pinned wrangler 4.146.0, and records the new version;
7. checks again that anonymous requests for the page, for `/api/models` and for
   the static assets go to the Access login. A hostname that cannot be reached
   yet is retried 50 times, 6 seconds apart (about five minutes, longer if a
   probe hangs to its 15-second timeout), while a new custom domain takes its
   DNS record and certificate.

The workflow sends no credentials to the beta, so it cannot test the app behind
Access. An authenticated smoke is later work, with its Access service token
already named (below). The checks need no credentials, and run from any
checkout:

```sh
pnpm --filter composer build:experimental
node apps/composer/scripts/check-beta-deploy.mjs                  # the configs and the artifact
node apps/composer/scripts/check-beta-deploy.mjs --access=after   # Access, on the live hostname
```

**The block switch.** The beta Worker's `BLOCKS_BETA` variable, set in the
dashboard as type Text and never in the config, says what the beta offers:

```json
{"enabled":true,"references":["astryx"],"blocks":["records-table","auth-form","guide-steps"]}
```

- It is strict JSON with exactly these three fields, each once. References
  come from the beta's allowlist, which holds Astryx only
  (`apps/composer/worker/blocks-beta.mjs`); block ids come from the Astryx
  sidecar's approved blocks; each is named once, and an enabled switch names at
  least one of each. Anything else is malformed: an unknown field, reference or
  block id, and a repeated field too, since JSON keeps the last of two equal
  fields. A variable of the dashboard's JSON type is malformed as well: it
  reaches the Worker already parsed, a repeated field already resolved. To
  turn blocks off, change `true` to `false` in place; never add a second
  `enabled`.
- `GET /api/models` reports it, normalized, as a `blocks` field. A malformed
  value, or `"enabled": false`, is reported as off with its reason, and the
  value itself is never echoed.
- The experimental client reads it before every build. A switch that is
  missing, malformed, unreadable or disabled offers no blocks, and the build's
  note says which. A shadcn/ui v3 project is offered none, and the note says its
  evaluation remains inconclusive (branch C,
  [blocks/PHASE-2-DECISION-RECORD.md](blocks/PHASE-2-DECISION-RECORD.md)).
  Offering shadcn/ui v3 would be a code change to the allowlist, never a
  variable.
- Production has no `BLOCKS_BETA`, and its `/api/models` reply is byte-identical
  to before; a Worker test pins the bytes.

**The operator log.** The beta Worker's `BETA_OPERATOR_LOG` variable, set in
the dashboard as type Text to exactly `on`, writes one shape-only JSON line per
`/api/propose` request to Workers Logs: the status, the error and cause codes,
`maxCalls`, the operation, each call's outcome, tokens, served model and
duration, and the request's duration
([blocks/BETA-OPERATIONS.md](blocks/BETA-OPERATIONS.md), "The operator log").
- Never the prompt, the schema, the output, an error's message, a header or an
  address; and the reply is byte-identical with the log on or off.
- It is on only when the Worker sees exactly the string `on`. Keep it Text: a
  JSON variable holding the string `"on"`, or a secret set to `on`, would turn
  it on too. Anything else, or none, writes nothing. Production never sets it,
  and its `wrangler.jsonc` does not name it; a test holds both configs so.
- The experimental client names each request's operation in an
  `x-composer-operation` header, so the request body stays byte-identical. The
  default build never sends the header.

**Before the first dispatch (owner).**
1. **Cloudflare Access.** A self-hosted Access application for
   `composer-beta.aesthetic-function.com` covering the whole hostname, with one
   Allow policy that includes only the owner's email.
2. **The `composer-beta` GitHub environment.** A required reviewer (the owner),
   deployment branches limited to `main`, the secret `CLOUDFLARE_API_TOKEN_BETA`,
   and the variable `CLOUDFLARE_ACCOUNT_ID` (a token scoped to one Worker cannot
   look the account up).
3. **The token.** A new account-owned API token, never the production
   `CLOUDFLARE_API_TOKEN`. It needs only Editor on the one Worker
   `dspack-studio-composer-beta`, plus Workers Routes Write on the
   `aesthetic-function.com` zone, which attaching the custom domain needs. That
   zone permission reaches every hostname in the zone, production's included,
   so the token lives only in the protected environment. A token can be scoped
   only to a Worker that exists, and creating a Worker takes Admin at the
   Workers product scope. So grant that Admin for the first deploy only, which
   creates the Worker, then replace the token with the narrower one.
   (Creating the Worker by hand first also works, but then the first dispatch
   is not a `first_deploy`; see the first deploy, below.) These permissions
   follow Cloudflare's Workers authorization guide; the first dispatch is their
   test.
4. **Named, not yet used.** `CF_ACCESS_CLIENT_ID_BETA` and
   `CF_ACCESS_CLIENT_SECRET_BETA`, an Access service token for the later
   authenticated smoke.
5. **The gateway.** The beta shares `ds-ai-gateway` with production and the
   af-site theme generator. Keep the Cloudflare daily spend limit at $10 with
   auto top-up off, and keep the gateway settings above (Retry Requests off).

**The first deploy.**
1. Dispatch it with `first_deploy` checked: the beta Worker has no earlier
   version to anchor, and wrangler reports it does not exist (code 10007). A
   first deploy skips the pre-deploy Access check, because the hostname does
   not exist yet and asking would only leave its absence cached on the runner
   for the check after the deploy. If the Worker was created by hand first,
   dispatch without `first_deploy`: the pre-deploy check then meets a hostname
   that does not exist yet, and the check after the deploy may fail on DNS
   (step 2).
2. If the check after the deploy still fails on DNS or TLS, the custom domain
   is still provisioning: run
   `node apps/composer/scripts/check-beta-deploy.mjs --access=after` again a
   few minutes later, from any machine. Do not re-run the workflow run: the
   Worker now exists, so it refuses `first_deploy`. If the check fails any other
   way, the beta may be public: remove its custom domain at once (Workers &
   Pages → `dspack-studio-composer-beta` → Settings → Domains & Routes), fix
   Access, and dispatch again, without `first_deploy`, to re-attach it.
3. Confirm by hand, in Zero Trust → Access → Applications, that the beta's
   application covers the whole hostname and has one Allow policy that
   includes only the owner's email.
4. Only then set `BLOCKS_BETA`. Until it is set, the switch reads as missing,
   and the beta offers no blocks.

**Runbook.**
- Stop blocks but keep hosted builds: set `"enabled": false` in `BLOCKS_BETA`,
  or delete it. The next build offers none, with no deploy and no reload.
- Stop hosted generation on the beta only: set `HOSTED_AI` to `off` on the beta
  Worker. The beta config declares no vars and keeps the dashboard's
  (`keep_vars: true`), so no deploy resets either switch, or the operator
  log's `BETA_OPERATOR_LOG`.
- Roll back: `npx --yes wrangler@4.146.0 rollback --config wrangler.composer-beta.jsonc`,
  to the anchor the workflow recorded. A rollback deploys that version as it
  was, and may bring back the `BLOCKS_BETA`, `HOSTED_AI` and
  `BETA_OPERATOR_LOG` it had. So roll back first, then set all three again.
  The beta's `/api/models` confirms `BLOCKS_BETA` and `HOSTED_AI`; no endpoint
  shows `BETA_OPERATOR_LOG`, so confirm it in the dashboard. A rollback never
  stops blocks on its own. Production and the beta roll back independently.

**Stop conditions (initial, set by the owner).**
- Disable blocks at once (`BLOCKS_BETA` off) on any model mismatch, any
  provider-reached call that is unmetered, any integrity failure, or any
  authorization or provenance failure.
- Pause the beta on two consecutive non-busy provider errors.
- Pause the beta when busy or refusal responses reach 10% over at least 20 beta
  requests.
- Pause the beta when the shared gateway's daily spend reaches $8, which leaves
  headroom below the $10 hard limit.

A pause turns blocks off and sets `HOSTED_AI` to `off` on the beta until the
owner decides to resume. The owner reads these signals (release plan step 5;
[blocks/BETA-OPERATIONS.md](blocks/BETA-OPERATIONS.md), "Alarms"); no alert is
automated:
- the operator log, when `BETA_OPERATOR_LOG` is `on`: each request's status and
  codes, and each call's outcome, tokens and served model. Its per-call model is
  the served-model signal: a call the provider rejected got no response, and
  names none;
- the beta's receipts: block and surface calls apart, the exact budget, the
  refinement mode, and each call's served model. A call that names none shows
  the reply's top-level model, which can be the Worker's configured id, so the
  receipt is a reason to look, not the served-model signal;
- a diagnostics file a beta user chooses to save and share: call records,
  timings, outcomes and the shape of each block trace;
- the gateway's dashboard: errors and spend.

None of these is ADR-B3 decision evidence; only the owner-run canary is.

## Recommended topology

**Launch topology: static-only.** Do NOT set `NEXT_PUBLIC_AGENT_URL`: the
live tab then shows the offline panel with the exact local command
(`pnpm --filter agent dev`) — "run it live" is a bring-your-own-machine
feature, which is the honest cost model (no hosted inference, no keys, no
abuse surface).

**Optional live topology (later, owner decision):** agent on a long-lived-
process host (Fly.io / Railway — SSE-friendly), `NEXT_PUBLIC_AGENT_URL`
baked at build time, `AGENT_ALLOWED_ORIGINS` set to the site origin, and the
agent's `OLLAMA_URL` / `ANTHROPIC_API_KEY` kept server-side only.

## Build and start

```sh
pnpm install --frozen-lockfile
pnpm build:deploy   # gated contract artifacts + static export -> apps/web/out
# agent (only for the live topology):
PORT=8787 AGENT_ALLOWED_ORIGINS=https://studio.example pnpm --filter agent dev
```

## Environment

See `.env.example`. Client bundle receives ONLY `NEXT_PUBLIC_*` values;
`OLLAMA_URL`, `AGENT_ALLOWED_ORIGINS`, and any provider key are agent-side
and never reach the browser (the browser sees model *refs*, not endpoints —
verified: the bundle contains no host addresses).

## Health checks

- web: any 200 on `/` (static).
- agent: `GET /` → `{ ok: true, name: "dspack-studio agent" }`;
  `GET /models` degrades gracefully to `["scripted"]` when the model backend
  is down (deterministic mode keeps working).

## Agent-unavailable behavior (by design)

The web app health-checks the agent on mount; if unreachable, the live tab
renders the offline panel (instructions, no errors, no retries hammering),
and replay/import remain fully functional. Mid-run disconnects surface as
`studio.action.failed` / run `error` status with retry affordances.

## Rollback

Static host: redeploy the previous `apps/web/out` artifact (both Pages and
Vercel keep prior immutable deploys — one-click rollback). Agent: redeploy
the previous image/commit; it is stateless (per-session state is in-memory
and disposable; fixtures live in the repo). No migrations exist.
