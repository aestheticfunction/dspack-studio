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
A `HOSTED_AI` var is the kill switch. It lives in the dashboard: `wrangler.jsonc` declares no vars and keeps the dashboard's (`keep_vars: true`), so a flip there lasts across deploys, though not across a rollback ("The invite-only beta", Runbook, below). Absent means on.

**Cloudflare Access.** Under the owner's single-host amendment, Access protects this hostname with email one-time PIN, admitting the owner's exact email and the testers the owner adds. The owner applies it in the dashboard; nothing in this repository applies it, and the experimental workflow refuses to deploy until anonymous requests go to its login. Applying it removes anonymous access: the existing public Composer becomes the invite-only beta, and this repository's anonymous checks of production (the build id, `/api/models`, the live-artifact scan, the production smoke) meet the Access login. The order of the cutover, the experimental deploy and the rollback to the block-free release candidate is in [blocks/BETA-DEPLOY-PLAN.md](blocks/BETA-DEPLOY-PLAN.md).

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

The composer's default artifact therefore has **two deploy paths**: the reconnected Workers
Builds Git integration (auto-deploys the root `wrangler.jsonc` to the
production composer from `main`, below), and the explicit **`deploy-composer`**
GitHub Actions workflow for a dispatched, gate-checked deploy (same posture
as `deploy-exhibit`): it re-verifies the composer, records the rollback
anchor, deploys through `wrangler.jsonc`, and runs the production smoke. It
is inert until the `CLOUDFLARE_API_TOKEN` repository secret exists. Behind
Cloudflare Access its production smoke runs anonymously, meets the login, and
fails after the deploy has landed. A third path, `deploy-composer-experimental`,
deploys the experimental artifact to this same Worker for the invite-only beta
("The invite-only beta", below). The equivalent local sequence for the default
artifact:

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

Rollback: `npx wrangler rollback <version id> --config wrangler.jsonc` (or
redeploy the previous commit), then set the dashboard's switches again ("The
invite-only beta", Runbook, below); the exhibit Worker is untouched either way.

## The invite-only beta (the composer Worker, behind Cloudflare Access)

Under the owner's single-host amendment
([blocks/PHASE-2-DECISION-RECORD.md](blocks/PHASE-2-DECISION-RECORD.md), "The
single-host amendment"), the interface-blocks beta is this composer:
`composer.aesthetic-function.com` and its Worker, `dspack-studio-composer`,
behind Cloudflare Access. There is no separate beta hostname or Worker. The
beta is the EXPERIMENTAL artifact, `apps/composer/out-experimental`, deployed
to this Worker only by the dispatched `deploy-composer-experimental` workflow.
Workers Builds keeps deploying the block-free default artifact through
`wrangler.jsonc`. The order of the cutover, Access first, and the rollback are
in [blocks/BETA-DEPLOY-PLAN.md](blocks/BETA-DEPLOY-PLAN.md).

**The two configs.** `wrangler.jsonc` (Workers Builds, `deploy-composer`) and
`wrangler.composer-experimental.jsonc` (`deploy-composer-experimental` only) are
the one Worker and differ only in the assets directory: `apps/composer/out`
and `apps/composer/out-experimental`. Both set `workers_dev: false`,
`preview_urls: false` and `keep_vars: true`, declare no vars, and have one
route, the custom domain, with no custom-domain Preview URLs.
`apps/composer/scripts/check-experimental-deploy.mjs` refuses any other
config, and `apps/composer/lib/experimental-deploy.test.mjs` holds the
committed configs to it.

**Who can reach it.** Cloudflare Access protects the whole hostname, the page,
`/api/*` and the static assets alike, with email one-time PIN, admitting the
owner's exact email and the testers the owner adds. The owner applies it in
the dashboard; nothing in this repository applies it. The workflow's check
proves that anonymous requests go to the Access login, not who that login
lets in, so the owner confirms the policy by hand. A route or custom domain
attached in the dashboard outside the config survives every deploy, so the
owner also confirms that the Worker has only its custom domain
([blocks/BETA-DEPLOY-PLAN.md](blocks/BETA-DEPLOY-PLAN.md), step D).

**How the experimental artifact deploys.** Only the
`deploy-composer-experimental` GitHub Actions workflow deploys it: dispatched
by hand from `main`, confirmed by typing `deploy-composer-experimental`, and
run in the protected `composer-experimental` environment. There is no local
deploy path: one would skip the required reviewer, the `main`-only rule, the
dedicated token and the Access check. The workflow:
1. refuses to run without its own token and the account id, which reach only
   the steps that run wrangler, never the install or the build;
2. installs from the frozen lockfile and builds the experimental artifact;
3. runs the guards: both configs, and an artifact that carries the block code
   and the switch;
4. checks that anonymous GET requests for the page, `/api/models` and the
   static assets, and an anonymous POST to `/api/propose`, already go to the
   Cloudflare Access login. Nothing else passes: the hostname always exists,
   so any failure to reach it refuses, and so does a bare 401 or 403, which a
   WAF rule or bot challenge could send this runner alone. The POST's empty
   body would reach no model even if the Worker answered it;
5. records the rollback anchor, the currently active version, and refuses to
   deploy when the listing fails or names no version. wrangler itself is
   installed first, with no credentials;
6. deploys with the pinned wrangler 4.146.0, and records the new version;
7. checks Access again, retrying for about five minutes. A failure there means
   the hostname answered an anonymous request: roll back to the anchor at
   once.

The workflow sends no Access credential, so it cannot test the app behind
Access; that waits on the machine credential the owner has not authorized
(below). The checks need no credentials, and run from any checkout after
`pnpm install --frozen-lockfile`:

```sh
pnpm --filter composer build:experimental
node apps/composer/scripts/check-experimental-deploy.mjs                   # the configs and the artifact
node apps/composer/scripts/check-experimental-deploy.mjs --access=before   # Access, on the live hostname
```

**Workers Builds and the beta.** Every merge to `main` deploys the block-free
default artifact through `wrangler.jsonc`, so once the beta is live a merge
replaces it with the block-free artifact, an automatic rollback, until the
experimental workflow is dispatched again. Once the anchor of step F.1 is
recorded, the owner can turn off automatic production-branch builds for the
beta's duration (Workers & Pages → `dspack-studio-composer` → Settings →
Build). Branch builds upload versions of the default artifact only, and with
Preview URLs off they get no URL.

**The switches.** All three live in the dashboard, as type Text, and both
configs keep them (`keep_vars: true`), so no deploy resets them. A rollback
does: it restores the variables the target version had (Runbook, below).
- `HOSTED_AI`, the kill switch: `off` stops hosted generation for every user
  of Composer; absent means on. Scripted mode and the local agent are
  unaffected.
- `BLOCKS_BETA`, the block switch, says what the beta offers:

  ```json
  {"enabled":true,"references":["astryx"],"blocks":["records-table","auth-form","guide-steps"]}
  ```

  - It is strict JSON with exactly these three fields, each once. References
    come from the beta's allowlist, which holds Astryx only
    (`apps/composer/worker/blocks-beta.mjs`); block ids come from the Astryx
    sidecar's approved blocks; each is named once, and an enabled switch names
    at least one of each. Anything else is malformed: an unknown field,
    reference or block id, and a repeated field too, since JSON keeps the last
    of two equal fields. A variable of the dashboard's JSON type is malformed
    as well: it reaches the Worker already parsed, a repeated field already
    resolved. To turn blocks off, change `true` to `false` in place; never add
    a second `enabled`.
  - `GET /api/models` reports it, normalized, as a `blocks` field. A malformed
    value, or `"enabled": false`, is reported as off with its reason, and the
    value itself is never echoed. With it unset, `/api/models` is
    byte-identical to the release candidate's, `{"models":["scripted","hosted-ai"]}`;
    a Worker test pins the bytes. The default artifact never reads the field.
  - The experimental client reads it before every build. A switch that is
    missing, malformed, unreadable or disabled offers no blocks, and the
    build's note says which. A shadcn/ui v3 project is offered none, and the
    note says its evaluation remains inconclusive (branch C,
    [blocks/PHASE-2-DECISION-RECORD.md](blocks/PHASE-2-DECISION-RECORD.md)).
    Offering shadcn/ui v3 would be a code change to the allowlist, never a
    variable.
- `BETA_OPERATOR_LOG`, the operator log: set to exactly `on`, it writes one
  shape-only JSON line per `/api/propose` request to Workers Logs: the status,
  the error and cause codes, `maxCalls`, the operation, each call's outcome,
  tokens, served model and duration, and the request's duration
  ([blocks/BETA-OPERATIONS.md](blocks/BETA-OPERATIONS.md), "The operator log").
  - Never the prompt, the schema, the output, an error's message, a header or
    an address; and the reply is byte-identical with the log on or off.
  - It is on only when the Worker sees exactly the string `on`. Keep it Text:
    a JSON variable holding the string `"on"`, or a secret set to `on`, would
    turn it on too. Anything else, or none, writes nothing.
  - The experimental client names each request's operation in an
    `x-composer-operation` header, so the request body stays byte-identical.
    The default build never sends the header.

**Before the first dispatch (owner).** In this order, as the cutover order
sets it ([blocks/BETA-DEPLOY-PLAN.md](blocks/BETA-DEPLOY-PLAN.md), steps A to F):
1. **Cloudflare Access.** The self-hosted application `AF Composer` for
   `composer.aesthetic-function.com`, covering the whole hostname, with
   One-time PIN as its login method and one Allow policy that includes only
   the owner's exact email. No service token and no Service Auth policy yet.
2. **The checks.** Anonymous GET and POST requests go to the Access login;
   workers.dev and Preview URLs are off and the Worker has only its custom
   domain; the owner can sign in and run a scripted build.
3. **The `composer-experimental` GitHub environment.** A required reviewer (the
   owner), deployment branches limited to `main`, the secret
   `CLOUDFLARE_API_TOKEN_EXPERIMENTAL`, and the variable `CLOUDFLARE_ACCOUNT_ID`
   (a token scoped to one Worker cannot look the account up).
4. **The token.** A new account-owned API token, never the repository's
   production `CLOUDFLARE_API_TOKEN`. It needs only Editor on the one Worker
   `dspack-studio-composer`, plus Workers Routes Write on the
   `aesthetic-function.com` zone, which the custom domain needs. That zone
   permission reaches every hostname in the zone, so the token lives only in
   the protected environment. Its own secret name matters: a dispatch to an
   environment that does not exist yet creates it unprotected, and the run
   then refuses for want of the secret instead of reaching the repository's
   token. If step 2's `composer-beta` environment or its token was ever
   created, delete the environment and revoke the token.
5. **The gateway.** The composer shares `ds-ai-gateway` with the af-site theme
   generator. Keep the Cloudflare daily spend limit at $10 with auto top-up
   off, and keep the gateway settings above (Retry Requests off).
6. **The anchor.** After the cutover change merges, Workers Builds deploys the
   block-free default artifact with the hardened config. Record that
   version's id: it is the rollback anchor, the release candidate's
   application code. Then dispatch, leaving `BLOCKS_BETA` unset or disabled.

**Runbook.**
- Stop blocks but keep hosted builds: set `"enabled": false` in `BLOCKS_BETA`,
  or delete it. The next build offers none, with no deploy and no reload.
- Stop hosted generation: set `HOSTED_AI` to `off`. This stops it for every
  user of Composer, since the beta is the composer.
- Roll back: `npx --yes wrangler@4.146.0 rollback <anchor version id> --config wrangler.jsonc`,
  or the dashboard's Deployments; always name the anchor, since each variable
  change deploys a new version. A rollback deploys that version as it was, and
  restores the `BLOCKS_BETA`, `HOSTED_AI` and `BETA_OPERATOR_LOG` it had: for
  the anchor, `HOSTED_AI` on and neither of the others. So roll back first,
  then set all three again, `HOSTED_AI` to `off` if hosted generation was
  paused, and check `/api/models` in a signed-in browser; no endpoint shows
  `BETA_OPERATOR_LOG`, so confirm it in the dashboard. A rollback never stops
  blocks on its own.
- End the beta for good with a forward change that deletes the experimental
  config and workflow and keeps `wrangler.jsonc`'s `workers_dev`,
  `preview_urls` and `keep_vars`. Never revert this change: a revert restores
  the superseded separate-Worker files and redeclares `HOSTED_AI` without
  `keep_vars`, so its own deploy would turn a paused kill switch back on.

**Stop conditions (initial, set by the owner).**
- Disable blocks at once (`BLOCKS_BETA` off) on any model mismatch, any
  provider-reached call that is unmetered, any integrity failure, or any
  authorization or provenance failure.
- Pause the beta on two consecutive non-busy provider errors.
- Pause the beta when busy or refusal responses reach 10% over at least 20 beta
  requests.
- Pause the beta when the shared gateway's daily spend reaches $8, which leaves
  headroom below the $10 hard limit.

A pause turns blocks off and sets `HOSTED_AI` to `off` until the owner decides
to resume; on the single host it pauses hosted generation for every user of
Composer. The owner reads these signals (release plan step 5;
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

None of these is ADR-B3 decision evidence; only the owner-run canary is, and
it waits on a temporary machine credential the owner has not authorized
([blocks/BETA-DEPLOY-PLAN.md](blocks/BETA-DEPLOY-PLAN.md), "The hosted canary").

**What meets the Access login.** Every anonymous check of this hostname: the
build-id read, the `/api/models` comparison and the live-artifact scan after a
merge, the `deploy-composer` workflow's production smoke (which then fails
after its deploy has landed), and the harness baseline. Until a machine
credential exists, verify in a signed-in browser
([blocks/BETA-DEPLOY-PLAN.md](blocks/BETA-DEPLOY-PLAN.md), step G;
[blocks/POST-BETA-BACKLOG.md](blocks/POST-BETA-BACKLOG.md), O3 and O4).

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
