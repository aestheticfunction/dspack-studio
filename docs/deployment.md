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
are unaffected. The composer Worker never had such an integration; its
deploys were always explicit.

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

## The composer (second Worker, same posture)

**https://composer.aesthetic-function.com** is the catalog composer
(`apps/composer`), deployed as its **own** Worker so the exhibit and the
composer keep independent deploy cadences. It is the **repo-root
`wrangler.jsonc`** — deliberately, because the composer Worker
(`dspack-studio-composer`) is the one connected to the GitHub → Cloudflare
**Workers Builds** integration, which reads `./wrangler.jsonc` by default;
the name, route, and assets there match the deployed Worker (Cloudflare's
reconciliation request). Static Assets from `apps/composer/out`, the custom
domain declared in `routes` (wrangler attaches it; Cloudflare manages DNS),
and **zero runtime bindings**: no AI, KV, Durable Objects, databases, or
secrets. The hosted composer ships the pre-emitted demo project only;
connecting a real project, emitting, saving, and generation all run on the
visitor's machine via the local agent (`pnpm --filter agent dev`), stated
plainly in the UI. No user project source is ever uploaded or executed.

The composer therefore has **two deploy paths**: the reconnected Workers
Builds Git integration (auto-deploys the root `wrangler.jsonc` on push — the
continuous integration environment), and the explicit **`deploy-composer`**
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

For a **continuously-deployed integration environment** (auto-deploy on push
to a branch), attach a Cloudflare Workers Builds Git integration to the
composer Worker in the dashboard (Workers & Pages → the composer Worker →
Settings → Build), build command `pnpm build:deploy:composer`, deploy command
`npx wrangler deploy --config wrangler.jsonc`. That is a
dashboard-only, owner action; the explicit `deploy-composer` workflow above
is the checked-in alternative and does not require it.

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
