# Incident: production deployed with hosted generation on (2026-11-26)

**Status:** contained 2026-11-26 02:15 UTC. Preventive changes are in the pull request that adds this record; they are not deployed until it merges.

## Summary

Merging PR #121 (`1b3b08e`) at 02:13 UTC made Cloudflare Workers Builds deploy production version `5005a813` with `HOSTED_AI` set to `on`. With no Cloudflare Access in front of `/api`, anyone could request hosted generation for about 1 minute 44 seconds. AI Gateway analytics show no request at all between the end of the live pilot (2026-11-25 22:43 UTC) and 02:21 UTC, so nothing was generated and nothing was spent.

## Timeline (UTC)

| Time | Event |
|---|---|
| 11-25 21:59 | The live pilot uploads version `515a90eb` with `HOSTED_AI` "on", behind a temporary Access application on `/api`, and deploys it |
| 11-25 22:42 | Pilot cleanup rolls production back to `65b2b753` (`HOSTED_AI` "off") and checks the **active deployment** from outside. The **latest uploaded version** is not checked; it is still `515a90eb` |
| 11-25 22:48, 11-26 01:02, 01:33 | Workers Builds uploads three branch versions, undeployed. Each copies its variables from the latest upload and carries `HOSTED_AI` "on" |
| 11-26 ~02:12 | The temporary Access application has been deleted (pilot cleanup) |
| 11-26 02:13:40 | #121 merges; Workers Builds deploys `5005a813`, which inherited `HOSTED_AI` "on". `/api/models` offers `hosted-ai` to anyone |
| 11-26 02:15:24 | Contained: version `235c6a63` deployed. It has the deployed version's code and bindings with only `HOSTED_AI` set to "off". It is also now the latest upload |
| 11-26 02:21 | AI Gateway analytics checked from the pilot's end to 02:21: no requests |

Exposure window: 02:13:40 to 02:15:24, about 1 minute 44 seconds.

## Root cause

Three things combined.

1. **Variables were inherited from the latest upload, not the active deployment.** `wrangler.jsonc` declared no `vars` and set `keep_vars: true`. Wrangler implements that by uploading no plain-text bindings and asking Cloudflare to keep the existing ones (`keep_bindings: ["plain_text", "json", ...]`). Cloudflare keeps them from the most recently uploaded version, which is not necessarily the deployed one. Evidence: [2026-11-26-wrangler-upload-metadata.txt](2026-11-26-wrangler-upload-metadata.txt).
2. **The switch failed open.** The Worker treated an absent `HOSTED_AI` as on (`(env.HOSTED_AI ?? "on") === "on"`).
3. **The pilot's cleanup checked the wrong thing.** It confirmed the active deployment was "off" but never checked the version future uploads would inherit from, and it removed Access before that was known.

## Containment

- A version was uploaded from the deployed version's own module, with every binding inherited except `HOSTED_AI` "off", and deployed at 100%.
  - Module bytes, compatibility settings and asset configuration are identical to `5005a813`.
  - All 11 page assets checked were unchanged.
- From outside:
  - `/api/models` answers `["scripted"]`;
  - `/api/propose` refuses with 503 "unavailable" before reading the request.
- Production smoke afterwards: 31 passed, plus the known analytics-beacon exception, the same as before the merge.
- The next branch build (`9eeaf8ed`, from `d76b251`) inherited "off", confirming the chain was broken.
- The temporary write permissions used for the pilot were then removed by the owner.

## Active deployment and latest upload

| | What it is | Where it matters |
|---|---|---|
| Active deployment | The version or versions serving traffic | What visitors get now |
| Latest uploaded version | The most recent version uploaded, deployed or not | What the next upload inherits under `keep_vars` |

Every check of hosted generation now reads both: `apps/composer/scripts/verify-hosted-ai-off.mjs`.

## Preventive actions

| # | Action | Where |
|---|---|---|
| P1 | **Fail closed.** Hosted generation is on only for the exact string "on". Absent, empty, misspelled or any other value is off | `apps/composer/worker/propose.mjs` `hostedAiEnabled`; tests in `apps/composer/lib/hosted-ai-safety.test.mjs` |
| P2 | **Every ordinary deploy sets it off explicitly.** Both composer configs declare `vars: { "HOSTED_AI": "off" }`, so wrangler uploads the binding and nothing is inherited. `keep_vars` still keeps `BLOCKS_BETA` and `BETA_OPERATOR_LOG` | `wrangler.jsonc`, `wrangler.composer-experimental.jsonc`; held by `check-experimental-deploy.mjs` |
| P3 | **Verification after every deploy.** It checks the effective configuration (active versions and latest upload) and the public API | `verify-hosted-ai-off.mjs` in `deploy-composer.yml`, `deploy-composer-experimental.yml` and, public checks only, a CI job on `main` that watches the API for 10 minutes while Workers Builds deploys |
| P4 | **Turning hosted generation on is a deliberate act on one version**, and cleanup verifies both versions before Access is removed | `docs/deployment.md` "Hosted AI"; `docs/repositioning/LIVE-PILOT-RUNBOOK.md` |

## Limits that remain

- **The Workers Builds deploy command is set in the dashboard.** This repository cannot read or change it. The automatic path is protected by P1 and P2, because Workers Builds reads `wrangler.jsonc`, and watched by the CI job in P3, which checks the public API without credentials. It is not gated by a pre-deploy check. An owner action, optional, is to append the verification script to the deploy command in the dashboard.
- **A dashboard variable edit or a rollback can still turn hosted generation on**, because each deploys a version with the variables it is given. That is the deliberate path in P4. A rollback to `515a90eb`, or any version with "on", would re-enable it. The runbook names this.
- **Not demonstrated against Cloudflare itself:** an ordinary deploy *overriding* an inherited "on". Doing so needs write access, which this work did not have. The recorded upload metadata shows wrangler sends the explicit "off", and Cloudflare's documentation says variables in the config are set on deploy. The first deploy after this change will be verified by P3.
