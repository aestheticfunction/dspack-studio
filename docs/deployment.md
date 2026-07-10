# Deployment

Two artifacts, deliberately separable:

| Artifact | What it is | Needs |
|---|---|---|
| `apps/web` | fully static export (`apps/web/out`) — the whole replay experience, all curated fixtures, session import, inspectors, Break-it deterministic docs | any static host; no server, no keys |
| `apps/agent` | small Node HTTP server (AG-UI SSE + `/action`) — live generation and interactive scenarios | Node ≥ 22, a reachable model backend for `ollama:*` refs |

## Recommended topology

**Launch topology: static-only.** Deploy `apps/web/out` to Cloudflare Pages
(matches the af-site stack; Vercel/Netlify equivalent). Do NOT set
`NEXT_PUBLIC_AGENT_URL`: the live tab then shows the offline panel with the
exact local command (`pnpm --filter agent dev`) — "run it live" is a
bring-your-own-machine feature, which is the honest cost model (no hosted
inference, no keys, no abuse surface).

**Optional live topology (later, owner decision):** agent on a long-lived-
process host (Fly.io / Railway — SSE-friendly), `NEXT_PUBLIC_AGENT_URL`
baked at build time, `AGENT_ALLOWED_ORIGINS` set to the site origin, and the
agent's `OLLAMA_URL` / `ANTHROPIC_API_KEY` kept server-side only.

## Build and start

```sh
pnpm install --frozen-lockfile
pnpm --filter @dspack-studio/contracts build:catalogs   # gated artifacts
pnpm --filter web build                                  # -> apps/web/out
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
