# Deployment

Two artifacts, deliberately separable:

| Artifact | What it is | Needs |
|---|---|---|
| `apps/web` | fully static export (`apps/web/out`) — the whole replay experience, all curated fixtures, session import, inspectors, Break-it deterministic docs | any static host; no server, no keys |
| `apps/agent` | small Node HTTP server (AG-UI SSE + `/action`) — live generation and interactive scenarios | Node ≥ 22, a reachable model backend for `ollama:*` refs |

## Production (live since 2026-07-11)

**https://studio.aesthetic-function.com** runs the static-only topology on
**Cloudflare Workers Static Assets**, configured by the committed
`wrangler.jsonc` at the repository root:

| Setting | Value |
|---|---|
| Repository path | `/` (repo root) |
| Application build command | `pnpm --dir apps/web run build` (the dashboard's actual setting; `pnpm build:deploy` works too) |
| Deploy command | `npx wrangler deploy` |
| Static asset directory | `apps/web/out` (from `wrangler.jsonc`) |
| Environment variables | none (`NEXT_PUBLIC_AGENT_URL` deliberately unset) |

The web build is self-sufficient on a clean checkout: `apps/web`'s `build`
script generates the gated contract artifacts first (`packages/contracts/out`
is gitignored emission output) and then runs the Next.js static export.
`pnpm build:deploy` remains the canonical local command: it does the same
and additionally verifies `apps/web/out` exists. Cloudflare installs
dependencies itself; do not fold `pnpm install` into the build command.

Analytics: Cloudflare Web Analytics (zone-injected beacon, cookieless).

Production smoke suite (agent-free specs against the deployed site):

```sh
npx playwright test --config playwright.production.config.ts
```

## The composer (second Worker, same posture)

**https://composer.aesthetic-function.com** is the catalog composer
(`apps/composer`), deployed as its **own** Worker so the exhibit and the
composer keep independent deploy cadences. Configured by
`wrangler.composer.jsonc` at the repository root — Static Assets from
`apps/composer/out`, the custom domain declared in `routes` (wrangler
attaches it; Cloudflare manages DNS), and **zero runtime bindings**: no AI,
KV, Durable Objects, databases, or secrets. The hosted composer ships the
pre-emitted demo project only; connecting a real project, emitting, saving,
and generation all run on the visitor's machine via the local agent
(`pnpm --filter agent dev`), stated plainly in the UI. No user project
source is ever uploaded or executed.

```sh
pnpm build:deploy:composer                          # demo assets + static export -> apps/composer/out
npx wrangler deploy --config wrangler.composer.jsonc
npx playwright test --config playwright.composer-production.config.ts   # smoke against the deployed URL
```

Rollback: `npx wrangler rollback --config wrangler.composer.jsonc` (or
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
