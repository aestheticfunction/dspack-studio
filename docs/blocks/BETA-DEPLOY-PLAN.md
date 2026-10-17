# The invite-only beta: single-host deployment plan

**Phase 2, step 7** ([PHASE-2-RELEASE-PLAN.md](PHASE-2-RELEASE-PLAN.md), §4 and §12), revised on 2026-10-17 for the owner's single-host amendment ([PHASE-2-DECISION-RECORD.md](PHASE-2-DECISION-RECORD.md), "The single-host amendment"). **Nothing in it has been applied.** No Cloudflare setting has changed, the experimental artifact has not been deployed, and no paid model call has been made.

## The decision

The invite-only beta runs on the existing Composer: the hostname `composer.aesthetic-function.com` and its Worker `dspack-studio-composer`. **No new hostname, subdomain or Worker is created.** At cutover the existing public Composer becomes the invite-only beta, behind Cloudflare Access with email one-time PIN, admitting at first only the owner's exact email. There is no shared password and no client-side password screen.

This amends the release plan's recommendation of a separate beta origin. The owner accepted these consequences:
- **No independent controls.** Production and the beta no longer have independent hostnames, Workers or rollback controls: they are one.
- **No anonymous Composer.** Applying Access removes anonymous access to the existing Composer.
- **The experimental artifact takes the origin.** The experimental artifact will replace the default artifact on the current live origin.
- **The block-free anchor stays.** The default block-free artifact and the release candidate remain available as the rollback anchor, and rollback restores the block-free release candidate on the same hostname.
- **Shared storage.** Browser storage is shared with the existing origin, so testers start from packaged reference projects or fresh Example sessions.
- **Access first.** Access must be active and verified before the experimental artifact is deployed.
- **No bypass.** workers.dev and Preview URLs must be disabled or proven inaccessible, so they cannot bypass Access.
- **No conformance claim.** No claim of full WCAG 2.2 AA conformance is made during this invite-only beta.

## What can proceed now, and what is blocked

| Can proceed now (no cost) | Blocked |
|---|---|
| This documentation, merged | **Access (A, B)** waits on the owner, who enters their own exact email in the policy. It is not recorded in this repository |
| The cutover change, prepared for review and not merged or deployed (below) | **The experimental deploy (F)** waits on A to E, then on merging the cutover change |
| The manual accessibility packet, ready for testers ([MANUAL-A11Y-PACKET.md](MANUAL-A11Y-PACKET.md)) | **The beta baseline by the harness, and the hosted canary**, wait on a temporary machine credential, which the owner has not authorized (below) |
| | **Calling it an official beta** waits on the canary and on the minimum manual checks |

## Before and after the cutover

| | Today, at the release candidate | After the cutover |
|---|---|---|
| Hostname | `composer.aesthetic-function.com`, public | the same hostname, behind Access |
| Worker | `dspack-studio-composer` | the same Worker |
| Artifact served | `apps/composer/out`, the default build, with no block code | `apps/composer/out-experimental`, with the block code behind the per-user preference (off by default) and the block switch (off) |
| How it deploys | Workers Builds, from `main`, through `wrangler.jsonc` | the experimental artifact only through the dispatched, Access-gated workflow the cutover change adds; Workers Builds keeps deploying the block-free default artifact from `main` |
| Switches | `HOSTED_AI` declared in `wrangler.jsonc` | `BLOCKS_BETA`, `HOSTED_AI` and `BETA_OPERATOR_LOG` in the dashboard, kept across every deploy but not across a rollback, which restores the variables the target version had |
| Rollback | `wrangler rollback` to a previous version, or a redeploy of a previous commit ([../deployment.md](../deployment.md)) | to the recorded anchor: the block-free deployment of the release candidate's code, on the same hostname |

**The release candidate** is `main` at `7ff13c96c7b0ef6d8d7bacc91b9e3c2d839a771c` ([RELEASE-REVIEW.md](RELEASE-REVIEW.md)). Its block-free artifact is what production serves today. The rollback anchor is a block-free deployment of the release candidate's application code: the one Workers Builds makes when the cutover change merges, whose version id the owner records then (F.1). Until then every merge to `main`, this documentation's included, redeploys the same block-free artifact. Until the cutover change merges, `main` still carries a separate beta Worker's config and workflow (`wrangler.composer-beta.jsonc`, `.github/workflows/deploy-composer-beta.yml`). They are superseded: the workflow must never be dispatched.

## The cutover order

Each step has its owner and its check. A step starts only when the one before it passed.

**A. Configure Cloudflare Access on `composer.aesthetic-function.com`** (owner, dashboard). Zero Trust → Access → Applications → Add an application → Self-hosted:
- application name `AF Composer`;
- one public hostname, `composer.aesthetic-function.com`, with the path empty, so the whole hostname is covered, `/api/*` and the static assets included;
- keep it out of the App Launcher, and leave CORS settings off: no other origin calls this hostname.

**B. Allow only the owner's exact email, through one-time PIN** (owner, dashboard):
- Zero Trust → Settings → Authentication → Login methods: add **One-time PIN**.
- On the application, one policy:
  - action **Allow**;
  - Include: **Emails**, holding exactly the owner's own address;
  - no email-domain rule, no "Everyone", no group, no IP range;
  - session duration 24 hours.
- Choose One-time PIN as the application's login method. If it is the only one, Access skips the identity-provider picker.
- Tester addresses are added to the same Include list later.
- No service token, and no Service Auth policy.

**C. Confirm that anonymous GET and POST requests are denied before they reach the Worker or the provider** (anyone; no cost). From the repository root of a checkout of `main`, after `pnpm install --frozen-lockfile`, on a machine whose Node reaches the internet directly:

```sh
node --input-type=module -e '
  import { checkAccess } from "./apps/composer/scripts/check-beta-deploy.mjs";
  const problems = await checkAccess("https://composer.aesthetic-function.com", { phase: "after", attempts: 1 });
  console.log(problems.length ? problems.join("\n") : "GET: anonymous requests go to the Cloudflare Access login");
  process.exit(problems.length ? 1 : 0);'
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' -X POST -H 'accept: text/html' -H 'content-type: application/json' -d '{}' https://composer.aesthetic-function.com/api/propose
```

The first probes `/`, `/api/models` and a static-asset path, and passes only on a redirect to the Access login. The POST asks as a browser would, as the GET probes do, so that Access answers with its login redirect, and passes by the same rule: a redirect (301, 302, 303, 307 or 308) to `https://<team>.cloudflareaccess.com/cdn-cgi/access/login/…`, or to `/cdn-cgi/access/` on the hostname itself. A bare 401 or 403 is no proof, since a WAF rule or a bot challenge could stop this machine alone. The Worker's `400` JSON means the request reached the Worker: an empty body reaches no model, but the Worker must not answer at all. (The cutover change adds this POST to `checkAccess`, under the same rule, and renames the script; the command above is the one that works on `main` today.)

**D. Confirm that workers.dev and Preview URLs cannot bypass Access** (owner, dashboard):
- Workers & Pages → `dspack-studio-composer` → Settings → Domains & Routes: **workers.dev disabled** and **Preview URLs disabled**. Disable either that is not.
- Today's `wrangler.jsonc` sets neither. Wrangler 4.146.0, on a deploy of a Worker whose config has a custom-domain route and no `workers_dev`, turns workers.dev off and lets Preview URLs follow it, and the Workers Builds comments on pull requests show no Preview URL. That is inference, not proof; the dashboard is the proof.
- In the same place: the Worker has **one entry, the custom domain `composer.aesthetic-function.com`**, with no other route or custom domain, since a deploy never removes a route attached in the dashboard; and **no Preview URLs on that custom domain**. Wrangler 4.146.0 can give a custom domain its own Preview URLs, `https://<preview-name>.composer.aesthetic-function.com`, which an Access application for the exact hostname does not cover.
- The cutover change then sets `workers_dev: false` and `preview_urls: false` in both configs, held by a test, so every deploy keeps them off, and its guard refuses a route that turns on custom-domain Preview URLs.

**E. Confirm that the owner can sign in and use the existing application** (owner). In a private window:
- open `https://composer.aesthetic-function.com`, receive the one-time PIN, sign in, and run a **scripted** build (no model call);
- `/api/models` still reads exactly `{"models":["scripted","hosted-ai"]}`;
- an address not on the list is refused.

**F. Only then deploy the experimental artifact to the existing Worker, with the block switch off.**
1. **Merge the cutover change** (owner's approval). Workers Builds redeploys the block-free default artifact from `main`, now with the hardened config. Record that deployment's version id: it is the rollback anchor, built from the release candidate's application code.
2. **Dispatch the experimental workflow** from `main` (owner). Before it deploys, it:
   - re-runs C and refuses unless anonymous GET and POST requests already go to the Access login;
   - records the active version as the anchor, and refuses to deploy without one;
   - checks both configs, and that the built artifact carries the block code and the switch.

   It deploys `apps/composer/out-experimental` to `dspack-studio-composer` with pinned wrangler, then checks Access again.
3. **Leave `BLOCKS_BETA` unset, or set it as Text to the disabled value:** `{"enabled":false,"references":["astryx"],"blocks":["records-table","auth-form","guide-steps"]}`. Either way no block is offered, and the build's note says why.

**G. Record the deployed baseline, and rehearse rollback to the release candidate** (owner):
- **Baseline, by hand, as a stand-in** (decision D11 in the release review). The harness baseline the release plan names cannot pass Access without a machine credential; it runs with the canary's credential, just before the canary. Until then, in the signed-in browser, record:
  - the build id: the page source's flight payload `"b":"…"`;
  - `/api/models`;
  - the Worker's refusal of an empty body: in the console, `await (await fetch("/api/propose",{method:"POST",headers:{"content-type":"application/json"},body:"{}"})).json()`. It reaches no model; expect `invalid-request`, `calls: []` and `capabilities` naming `per-call-model`;
  - Settings → Experimental's sidecar status lines.
- **Rehearsal.**
  1. Roll back to the anchor: Workers & Pages → `dspack-studio-composer` → Deployments → the anchor version → Rollback, or `npx --yes wrangler@4.146.0 rollback --config wrangler.jsonc <anchor version id>`. Always name the anchor: each variable change in the dashboard deploys a new version.
  2. Confirm the page is the default build: Settings has no Experimental section.
  3. Roll forward to the experimental version the same way, and set the switches again: a rollback can restore the variables a version had.
  4. Record both version ids and times.

**H. Run the zero-cost checks** (owner, then the testers):
- scripted builds only;
- with the preference on and the switch unset or off, the build's note reads "No interface blocks for this build: beta-switch-missing." or "…: beta-switch-disabled.";
- an Example session's export and import keep working;
- then, with the switch turned on for the test window only, the minimum manual accessibility checks ([MANUAL-A11Y-PACKET.md](MANUAL-A11Y-PACKET.md)), still in scripted mode. Turning the switch on is the owner's decision at that point. Scripted mode reaches no model.

**I. Stop before any hosted canary or paid provider call.** Hosted builds are possible once a person is signed in, because `HOSTED_AI` stays on, so the beta's own testing uses scripted mode until the owner decides otherwise. A fresh browser profile defaults to the hosted model, so each tester first chooses Settings → Scripted → "Use scripted". To make that a guarantee rather than an instruction, the owner can set `HOSTED_AI` to `off` once G is recorded, until hosted builds are allowed: scripted mode is unaffected. Set it on again before the harness baseline and the canary: with it off, `/api/models` lists only scripted and the Worker answers an empty body with `unavailable`, so both refuse.

## The cutover change (prepared, not merged)

A pull request, opened for review and never deployed by itself. Its merge redeploys only the block-free default artifact. It:
- **retargets the experimental deploy at the existing Worker.** `wrangler.composer-beta.jsonc` becomes `wrangler.composer-experimental.jsonc`:
  - name `dspack-studio-composer` and route `composer.aesthetic-function.com`;
  - assets `./apps/composer/out-experimental`;
  - `workers_dev: false`, `preview_urls: false` and `keep_vars: true`;
  - no vars;
  - production's rate-limit namespace.
- **hardens `wrangler.jsonc`.** It keeps the default artifact, the Workers Builds path and the rollback anchor's source, and adds `workers_dev: false`, `preview_urls: false` and `keep_vars: true`. It moves `HOSTED_AI` to the dashboard: absent means on, and the value already set there is kept.
- **retargets the workflow.** `deploy-composer-beta.yml` becomes `deploy-composer-experimental.yml`:
  - dispatch-only, from `main`, through a protected `composer-experimental` environment;
  - no `first_deploy`: the Worker exists, so an anchor is always required;
  - the Access check before the deploy, which now fails on a hostname that does not resolve.
- **retargets the guard.** `check-beta-deploy.mjs` becomes `check-experimental-deploy.mjs`:
  - both configs target the same Worker and hostname;
  - the default config serves `out/` and the experimental config serves `out-experimental/`;
  - both keep workers.dev and Preview URLs off, both keep vars and declare none, and neither declares `BLOCKS_BETA`;
  - the Access check also POSTs to `/api/propose`.
- **retargets the tests and the code-describing docs.** It updates the guard's tests and `operator-log.test.mjs` (neither config declares vars), and rewrites the beta's runbook in `docs/deployment.md` for the single host.

Nothing in the application, the Worker's code, the block code or the request builders changes. The experimental artifact it deploys is the release candidate's.

**Workers Builds and the beta.** Workers Builds keeps deploying the block-free default artifact on every merge to `main`. Once the beta is live, a merge therefore replaces it with the block-free artifact, an automatic rollback, until the experimental workflow is dispatched again. Once F.1's version is recorded, and not before, since F.1 relies on Workers Builds deploying the cutover merge, the owner can turn off automatic production-branch builds in the Worker's build settings for the beta's duration, so that a merge no longer replaces the beta.

**The owner's GitHub and Cloudflare setup for F.** The `composer-experimental` GitHub environment needs:
- the owner as required reviewer;
- deployment branches limited to `main`;
- the secret `CLOUDFLARE_API_TOKEN_EXPERIMENTAL`: a new account-owned token, never the repository's production `CLOUDFLARE_API_TOKEN`, as step 2 decided. It needs only Editor on the one Worker `dspack-studio-composer`, plus Workers Routes Write on the `aesthetic-function.com` zone, which the custom domain needs. The distinct name makes the workflow refuse when the secret is missing, instead of reaching the repository-level token;
- the variable `CLOUDFLARE_ACCOUNT_ID` (a token scoped to one Worker cannot look the account up).

If step 2's `composer-beta` environment or its `CLOUDFLARE_API_TOKEN_BETA` was ever created, delete both, and revoke the API token behind that secret in Cloudflare: nothing uses them after the cutover change, and step 2 gave that token Workers Routes Write on the zone.

## Rollback

- **To the anchor, exactly:** the dashboard's Deployments, or `npx --yes wrangler@4.146.0 rollback <anchor version id> --config wrangler.jsonc`. It restores the block-free release candidate on the same hostname within seconds.
- **Then set the switches again.** A rollback restores the variables the target version had: for the anchor, `HOSTED_AI` on, and no `BLOCKS_BETA` or `BETA_OPERATOR_LOG`. So after any rollback or roll-forward, set all three again, `HOSTED_AI` to `off` if hosted generation was paused. Check `HOSTED_AI` and `BLOCKS_BETA` in `/api/models` in a signed-in browser, and `BETA_OPERATOR_LOG` in the dashboard, since no endpoint shows it. Otherwise a rollback after a pause turns hosted generation, and its cost, back on for every signed-in user.
- **To stay rolled back:** with Workers Builds connected, any later merge deploys the block-free default artifact from `main` anyway. Dispatch the experimental workflow only when the beta should return.
- **To end the beta for good:** a forward change that deletes the experimental config and workflow, and keeps `wrangler.jsonc`'s `workers_dev: false`, `preview_urls: false` and `keep_vars: true`. Never revert the cutover change: a revert restores the superseded separate-Worker files, and redeclares `HOSTED_AI` `on` without `keep_vars`, so its own deploy would turn a paused kill switch back on and drop the other two switches.
- **Browser data survives a rollback.** The preference key and block provenance written by the experimental build stay in each browser. The default build ignores the preference (a seeded preference changes nothing, `e2e/composer-prod-smoke.spec.ts`) and never reads the provenance store. Removing a project deletes its provenance in every build.
- **Stopping without a rollback:**
  - blocks only: `BLOCKS_BETA` disabled;
  - hosted generation: `HOSTED_AI` set to `off`.

  After the cutover change, both are kept across deploys, but not across a rollback (above).

## Storage

The beta shares the existing origin's browser storage. A tester who used Composer before keeps their projects. The beta instructions therefore tell testers to start from a packaged reference project or a fresh Example session: imported projects are never offered blocks, and a project edited before the beta may not be eligible.

## The hosted canary (blocked)

The canary is the only decision-grade check of the beta ([BETA-OPERATIONS.md](BETA-OPERATIONS.md), "The canary"). It needs the harness to pass Access, which needs a machine credential. The owner has not authorized one, so **the hosted canary is blocked**, and the release cannot be called an official live beta. Two future options, as the owner recorded them:
1. **Recommended:** create a narrowly scoped, short-lived Access service token immediately before the canary, and revoke it immediately afterward. This needs:
   - a Service Auth policy on the `AF Composer` application that includes only that token;
   - the small harness-only change that sends `CF-Access-Client-Id` and `CF-Access-Client-Secret` from the environment variables `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`. The values are never logged or recorded, and the change touches neither artifact. Step 2's reserved GitHub secret names, `CF_ACCESS_CLIENT_ID_BETA` and `CF_ACCESS_CLIENT_SECRET_BETA`, are retired with the separate Worker.
2. **Alternative:** stay at CONDITIONAL GO, and do not call the release an official live beta, until another secure harness-authentication method is approved.

If option 1 is authorized, the harness baseline comes first, with the same credential (`pnpm --filter @dspack-studio/block-bench baseline --out <file>`, [BASELINE.md](BASELINE.md)), then the Stage 1 command: the systems smoke on the beta's one reference, 16 cells, all four arms, fresh prompts. The credential is read without echo, so it never reaches the shell's history:

```sh
read -rs CF_ACCESS_CLIENT_ID && export CF_ACCESS_CLIENT_ID
read -rs CF_ACCESS_CLIENT_SECRET && export CF_ACCESS_CLIENT_SECRET
pnpm --filter @dspack-studio/block-bench baseline --out <new file beside the run>
pnpm --filter @dspack-studio/block-bench eval:live -- --provider hosted \
  --base-url https://composer.aesthetic-function.com \
  --reference astryx --conditions fresh --prompts rt-01,af-01,gs-01,nb-01 \
  --max-total-requests 80 --max-requests 80 --max-total-usd 5 --spacing-ms 12000
unset CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET
```

- **Caps.** At most 80 requests, and a $5.00 hard ceiling: the smallest whole-dollar ceiling the harness accepts, since it admits a cell only while the committed spend plus the cell's absolute worst case ($4.472832) fits.
- **Expected cost: about $0.20.** The Option B systems smoke's 16 Astryx cells settled at $0.1833 (2026-10-12).
- **Time:** about 10 minutes.
- **Clean means:** 16 cells; no integrity stop; one served model; and the preflight equal to the harness baseline taken just before it, apart from its time and the sidecars the run omits: an Astryx run's preflight lists Astryx's only ([BASELINE.md](BASELINE.md)).

## The invitation

Settings at the release candidate says "experimental build", never "beta", and lists no known gaps (the release review, criteria 25 and 26), so the invitation carries both. A draft:

> You are invited to the AF Composer experimental beta. It is invite-only and not generally available.
>
> Open https://composer.aesthetic-function.com and sign in with this email address; you will receive a one-time code. Then, in Settings, choose "Use scripted" under Scripted: it builds without calling an AI model, and the beta uses it until we tell you otherwise. To try interface blocks, go to Settings, Experimental, and turn on "Use interface blocks when a goal matches one". Start from the Astryx reference project or a fresh Example session: projects you made before, and imported projects, may not be offered blocks.
>
> Known gaps: the auth-form block does not state its fields' input purpose (WCAG 2.2 SC 1.3.5), so a host must restore it; never type a real password into a preview. Fields' resting borders are low contrast. The beta does not claim full WCAG 2.2 AA conformance. The full list: https://github.com/aestheticfunction/dspack-studio/blob/main/docs/blocks/BETA.md
>
> Reply to this email with anything that confuses you or gets in your way.

## Not part of this closeout

The UI redesign is the next planning phase, informed by the invite-only beta's feedback ([POST-BETA-BACKLOG.md](POST-BETA-BACKLOG.md)). It does not block this closeout.
