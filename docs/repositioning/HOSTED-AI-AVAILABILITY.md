# Hosted AI availability on composer.aesthetic-function.com

**Status:** M0 investigation, 2026-11-25. Read-only. Nothing was changed in Cloudflare, the Worker, the AI Gateway, Access or any deployment setting.

## Finding

**Verified cause: the `HOSTED_AI` kill switch is set to `off` in the Worker's dashboard variables.** Nothing is broken: the code, the `AI` binding and the configuration files are as intended. The switch was set deliberately on the night of the single-host cutover, and the release plan describes setting it.

Facts, each checked directly:

| Fact | How it was checked |
|---|---|
| `GET /api/models` returns `{"models":["scripted"]}` | Public request |
| An empty `POST /api/propose` returns `503 {"error":"unavailable", "calls":[], …}` before any body validation | Public request. This answer comes only from the first check in `proposeReply` (`apps/composer/worker/propose.mjs:386-391`): `(env.HOSTED_AI ?? "on") !== "on" \|\| !env.AI`. With hosted AI on, an empty body would be refused later with `invalid-request` |
| The active deployment is a version uploaded by wrangler on 2026-10-18 | Cloudflare API, `GET …/workers/scripts/dspack-studio-composer/deployments` and `/versions` |
| Version 248 is the Workers Builds deploy of PR #112, merged at 02:20:45 UTC | Times line up with `git log origin/main` |
| Version 248 has the `AI` binding, the `ASSETS` binding, the `PROPOSE_RATE_LIMIT` binding, and one plain-text variable: `HOSTED_AI = "off"` | The version's configuration (secret values were not requested) |
| `HOSTED_AI` was changed in the dashboard at 2026-10-18 01:44:47 UTC (version 247, "Updated variable: HOSTED_AI"), 36 minutes before #112 merged | Version annotations |
| Every later version carries `HOSTED_AI = "off"`, because `wrangler.jsonc` sets `keep_vars: true` and declares no variables | Versions 248 to 251; `wrangler.jsonc:46-51` |
| Deployment history after the cutover: experimental build deployed (12:03, version 249), rolled back to 248 (16:48); operator-log variable added (17:06, version 251), rolled back to 248 (17:19). No deployment since 2026-10-18 | `GET …/deployments` |
| The hostname is publicly reachable without signing in | Public `GET /` returns 200 with no Access redirect |

## Why the switch is off

`docs/blocks/BETA-DEPLOY-PLAN.md`, step I: "the owner can set `HOSTED_AI` to `off` once G is recorded, until hosted builds are allowed: scripted mode is unaffected. Set it on again before the harness baseline and the canary." The switch is doing what that step intended.

Two observations the owner should weigh, both from the same evidence:

1. **The beta is not currently live.** The experimental artifact was deployed and then rolled back the same day. The active version serves the default (block-free) artifact, and the configured `BLOCKS_BETA` switch is absent.
2. **Cloudflare Access is not covering the hostname today.** An anonymous request is served. The cutover plan assumed Access covers the whole hostname. Whether Access was removed deliberately after the rollback, or never applied, cannot be told from the Worker's configuration. Access settings were not read: the owner allowed reading the Worker's configuration only.

What could not be verified without a paid call: whether the AI Gateway (`ds-ai-gateway`) and its Unified Billing credit would serve a request if the switch were turned on. The binding is present; the gateway and billing state were not probed.

## Recommendation

Turning hosted AI back on is a production change and the owner's decision. Before doing so:

1. **Decide the audience first.** With the hostname public and no Access in front, `HOSTED_AI = "on"` makes paid generation available to anyone. `docs/deployment.md` records that the per-client rate limiter does not enforce on this account and that the real cap is the gateway's daily spend limit. Either re-apply Access to the hostname, or accept public hosted generation with the daily limit as the only bound.
2. **Check the spend guard.** Confirm the AI Gateway daily limit (documented as $10, auto top-up off) and the account's remaining credit.
3. **Then flip the switch in the dashboard**, not in `wrangler.jsonc`: Workers & Pages → `dspack-studio-composer` → Settings → Variables → `HOSTED_AI` = `on`. `keep_vars` keeps it across deploys. A rollback restores the variables of the target version, and every version since 247 carries `off`, so after any rollback set it again.
4. **Verify at no cost:** `GET /api/models` should list `hosted-ai`; an empty `POST /api/propose` with `content-type: application/json` should answer `400 invalid-request` with `calls: []`.

Until then, the product should say plainly that hosted AI is off. That is M0 trust fix (b) (`docs/repositioning/M0-TRUST-FIXES.md`).

## Method and limits

- Public probes: `curl` to `/`, `/api/models` and `/api/propose` (empty body). None reaches a model.
- Cloudflare API, GET only, through the session's connected token: `/accounts`, `/workers/scripts/dspack-studio-composer/settings`, `/deployments`, `/versions`, `/versions/{id}`. No write, update or delete request was made. No secret value was requested or recorded.
- Not read: Access applications and policies, AI Gateway settings, billing.
