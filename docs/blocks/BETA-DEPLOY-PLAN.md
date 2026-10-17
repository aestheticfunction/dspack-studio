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
| Switches | `HOSTED_AI` declared in `wrangler.jsonc` | `BLOCKS_BETA`, `HOSTED_AI` and `BETA_OPERATOR_LOG` in the dashboard, kept across every deploy |
| Rollback | `wrangler rollback` to a previous version, or a redeploy of a previous commit ([../deployment.md](../deployment.md)) | to the recorded anchor: the block-free deployment of the release candidate's code, on the same hostname |

**The release candidate** is `main` at `7ff13c96c7b0ef6d8d7bacc91b9e3c2d839a771c` ([RELEASE-REVIEW.md](RELEASE-REVIEW.md)). Its block-free artifact is what production serves today, and the rollback anchor is that artifact's deployment. Until the cutover change merges, `main` still carries a separate beta Worker's config and workflow (`wrangler.composer-beta.jsonc`, `.github/workflows/deploy-composer-beta.yml`). They are superseded: the workflow must never be dispatched.

## The cutover order

Each step has its owner and its check. A step starts only when the one before it passed.

**A. Configure Cloudflare Access on `composer.aesthetic-function.com`** (owner, dashboard). Zero Trust → Access → Applications → Add an application → Self-hosted:
- application name `AF Composer`;
- one public hostname, `composer.aesthetic-function.com`, with the path empty, so the whole hostname is covered, `/api/*` and the static assets included;
- keep it out of the App Launcher, and leave CORS settings off: the app calls only its own origin.

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

**C. Confirm that anonymous GET and POST requests are denied before they reach the Worker or the provider** (anyone; no cost). From a machine whose Node reaches the internet directly:

```sh
node --input-type=module -e '
  import { checkAccess } from "./apps/composer/scripts/check-beta-deploy.mjs";
  const problems = await checkAccess("https://composer.aesthetic-function.com", { phase: "after", attempts: 1 });
  console.log(problems.length ? problems.join("\n") : "GET: anonymous requests go to the Cloudflare Access login");
  process.exit(problems.length ? 1 : 0);'
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' -X POST -H 'content-type: application/json' -d '{}' https://composer.aesthetic-function.com/api/propose
```

The first probes `/`, `/api/models` and a static-asset path, and passes only on a redirect to the Access login. The POST must answer with a redirect to the Access login, or Access's own 401 or 403, never the Worker's `400` JSON: an empty body reaches no model even when the Worker answers, but the Worker must not answer at all. (The cutover change adds the POST to `checkAccess`, and renames the script; this command is the one that works on `main` today.)

**D. Confirm that workers.dev and Preview URLs cannot bypass Access** (owner, dashboard):
- Workers & Pages → `dspack-studio-composer` → Settings → Domains & Routes: **workers.dev disabled** and **Preview URLs disabled**. Disable either that is not.
- Today's `wrangler.jsonc` sets neither. Wrangler 4.146.0, on a deploy of a Worker whose config has a custom-domain route and no `workers_dev`, turns workers.dev off and lets Preview URLs follow it, and the Workers Builds comments on pull requests show no Preview URL. That is inference, not proof; the dashboard is the proof.
- The cutover change then sets `workers_dev: false` and `preview_urls: false` in both configs, held by a test, so every deploy keeps them off.

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
- **Baseline, by hand.** The harness cannot pass Access without a machine credential, so in the signed-in browser record:
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
- with the preference on and the switch off, the build's note says blocks are switched off;
- an Example session's export and import keep working;
- then, with the switch turned on for the test window only, the minimum manual accessibility checks ([MANUAL-A11Y-PACKET.md](MANUAL-A11Y-PACKET.md)), still in scripted mode. Turning the switch on is the owner's decision at that point. Scripted mode reaches no model.

**I. Stop before any hosted canary or paid provider call.** Hosted builds are possible once a person is signed in, because `HOSTED_AI` stays on, so the beta's own testing uses scripted mode until the owner decides otherwise.

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

**Workers Builds and the beta.** Workers Builds keeps deploying the block-free default artifact on every merge to `main`. Once the beta is live, a merge therefore replaces it with the block-free artifact, an automatic rollback, until the experimental workflow is dispatched again. For the beta's duration the owner can turn off automatic production-branch builds in the Worker's build settings, so that `main` deploys only when dispatched.

**The owner's GitHub and Cloudflare setup for F.** The `composer-experimental` GitHub environment needs:
- the owner as required reviewer;
- deployment branches limited to `main`;
- the secret `CLOUDFLARE_API_TOKEN_EXPERIMENTAL`: a new account-owned token, never the repository's production `CLOUDFLARE_API_TOKEN`, as step 2 decided. It needs only Editor on the one Worker `dspack-studio-composer`, plus Workers Routes Write on the `aesthetic-function.com` zone, which the custom domain needs. The distinct name makes the workflow refuse when the secret is missing, instead of reaching the repository-level token;
- the variable `CLOUDFLARE_ACCOUNT_ID` (a token scoped to one Worker cannot look the account up).

If step 2's `composer-beta` environment or its `CLOUDFLARE_API_TOKEN_BETA` was ever created, delete both: nothing uses them after the cutover change.

## Rollback

- **To the anchor, exactly:** the dashboard's Deployments, or `wrangler rollback <anchor version id>`. It restores the block-free release candidate on the same hostname within seconds.
- **To stay rolled back:** with Workers Builds connected, any later merge deploys the block-free default artifact from `main` anyway. Dispatch the experimental workflow only when the beta should return. Reverting the cutover change removes the experimental path altogether.
- **Browser data survives a rollback.** The preference key and block provenance written by the experimental build stay in each browser. The default build ignores the preference (a seeded preference changes nothing, `e2e/composer-prod-smoke.spec.ts`) and never reads the provenance store. Removing a project deletes its provenance in every build.
- **Stopping without a rollback:**
  - blocks only: `BLOCKS_BETA` disabled;
  - hosted generation: `HOSTED_AI` set to `off`.

  Both are kept across deploys after the cutover change.

## Storage

The beta shares the existing origin's browser storage. A tester who used Composer before keeps their projects. The beta instructions therefore tell testers to start from a packaged reference project or a fresh Example session: imported projects are never offered blocks, and a project edited before the beta may not be eligible.

## The hosted canary (blocked)

The canary is the only decision-grade check of the beta ([BETA-OPERATIONS.md](BETA-OPERATIONS.md), "The canary"). It needs the harness to pass Access, which needs a machine credential. The owner has not authorized one, so **the hosted canary is blocked**, and the release cannot be called an official live beta. Two future options, as the owner recorded them:
1. **Recommended:** create a narrowly scoped, short-lived Access service token immediately before the canary, and revoke it immediately afterward. This needs:
   - a Service Auth policy on the `AF Composer` application that includes only that token;
   - the small harness-only change that sends `CF-Access-Client-Id` and `CF-Access-Client-Secret` from the environment. It is never logged or recorded, and touches neither artifact.
2. **Alternative:** stay at CONDITIONAL GO, and do not call the release an official live beta, until another secure harness-authentication method is approved.

If option 1 is authorized, the Stage 1 command is the systems smoke on the beta's one reference: 16 cells, all four arms, fresh prompts.

```sh
CF_ACCESS_CLIENT_ID=… CF_ACCESS_CLIENT_SECRET=… \
pnpm --filter @dspack-studio/block-bench eval:live -- --provider hosted \
  --base-url https://composer.aesthetic-function.com \
  --reference astryx --conditions fresh --prompts rt-01,af-01,gs-01,nb-01 \
  --max-total-requests 80 --max-requests 80 --max-total-usd 5 --spacing-ms 12000
```

- **Caps.** At most 80 requests, and a $5.00 hard ceiling: the smallest whole-dollar ceiling the harness accepts, since it admits a cell only while the committed spend plus the cell's absolute worst case ($4.472832) fits.
- **Expected cost: about $0.20.** The Option B systems smoke's 16 Astryx cells settled at $0.1833 (2026-10-12).
- **Time:** about 10 minutes.
- **Clean means:** 16 cells; no integrity stop; one served model; and the preflight equal to the beta's baseline apart from its time.

## The invitation

Settings at the release candidate says "experimental build", never "beta", and lists no known gaps (the release review, criteria 25 and 26), so the invitation carries both. A draft:

> You are invited to the AF Composer experimental beta. It is invite-only and not generally available.
>
> Open https://composer.aesthetic-function.com and sign in with this email address; you will receive a one-time code. To try interface blocks, go to Settings, Experimental, and turn on "Use interface blocks when a goal matches one". Start from the Astryx reference project or a fresh Example session: projects you made before, and imported projects, may not be offered blocks.
>
> Known gaps: the auth-form block does not state its fields' input purpose (WCAG 2.2 SC 1.3.5), so a host must restore it; never type a real password into a preview. Fields' resting borders are low contrast. The beta does not claim full WCAG 2.2 AA conformance. The full list: https://github.com/aestheticfunction/dspack-studio/blob/main/docs/blocks/BETA.md
>
> Reply to this email with anything that confuses you or gets in your way.

## Not part of this closeout

The UI redesign is the next planning phase, informed by the invite-only beta's feedback ([POST-BETA-BACKLOG.md](POST-BETA-BACKLOG.md)). It does not block this closeout.
