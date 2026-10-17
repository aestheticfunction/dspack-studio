# The invite-only beta: deployment plan

**Phase 2, step 7** ([PHASE-2-RELEASE-PLAN.md](PHASE-2-RELEASE-PLAN.md), §4 and §12). Prepared on 2026-10-17. **Nothing in it has been applied.** No Cloudflare setting has changed, nothing has been deployed to the beta, and no paid model call has been made. Cloudflare Access waits on the owner's invite list; the deploy waits on the release review ([RELEASE-REVIEW.md](RELEASE-REVIEW.md)), the manual checks ([MANUAL-A11Y-PACKET.md](MANUAL-A11Y-PACKET.md)) and Access; the canary waits on the owner's explicit authorization.

The design is unchanged from steps 2 to 6 ([../deployment.md](../deployment.md), "The beta composer"):
- a separate beta Worker and hostname serving the experimental artifact;
- Astryx only;
- the user preference off by default;
- the block runtime switch off at first;
- the production artifact kept free of block code;
- independent rollback anchors and kill switches.

What is new is the audience: the owner wants AF Composer itself to be invite-only, so Access protects production's hostname as well as the beta's, under one allowlist.

## What deploys

| | Production | Beta |
|---|---|---|
| Hostname | `composer.aesthetic-function.com` | `composer-beta.aesthetic-function.com` (the owner's choice, 2026-10-16) |
| Worker | `dspack-studio-composer` | `dspack-studio-composer-beta` |
| Config | `wrangler.jsonc` | `wrangler.composer-beta.jsonc` |
| Artifact | `apps/composer/out`, the default build: no block code (`check-default-artifact`, 15 markers) | `apps/composer/out-experimental`: the block code, behind the preference and the switch |
| Deploys by | Workers Builds, on every merge to `main` | only the dispatched `deploy-composer-beta` workflow, from `main`, through the protected `composer-beta` environment |
| Other entry points | workers.dev and Preview URLs: confirm off (below) | `workers_dev: false`, `preview_urls: false`, held by `check-beta-deploy` |
| References offered | n/a | Astryx only (`BETA_REFERENCES` in `apps/composer/worker/blocks-beta.mjs`; shadcn/ui v3 would need a code change) |
| Block switch | none (`/api/models` byte-identical, pinned by a test) | `BLOCKS_BETA`, Text, set in the dashboard; off at first |
| Hosted kill switch | `HOSTED_AI` in `wrangler.jsonc` (`on`) | `HOSTED_AI` in the dashboard (absent means on) |
| Rollback | `npx wrangler rollback --config wrangler.jsonc <version id>`, or the dashboard | `npx --yes wrangler@4.146.0 rollback --config wrangler.composer-beta.jsonc <anchor version id>`, or the dashboard |

**The release candidate.** `main` at `7ff13c96c7b0ef6d8d7bacc91b9e3c2d839a771c` (tree `2c89ef980b27938f64a29687b0056aed45fe4097`), frozen on 2026-10-17 ([RELEASE-REVIEW.md](RELEASE-REVIEW.md)). The workflow deploys whatever `main` holds when it is dispatched, so nothing merges to `main` before the first beta deploy, except a documentation-only commit the owner approves (below).

## Cloudflare Access (proposed, not applied)

### Before applying it

1. **Confirm that no other entry point bypasses Access.** Access protects hostnames. A Worker's `workers.dev` URL or a Preview URL would reach the same Worker without it.
   - The beta's config turns both off, and `check-beta-deploy` refuses a config that turns either on.
   - Production's `wrangler.jsonc` sets neither. Wrangler 4.146.0, on each deploy of a Worker whose config has a custom-domain route and no `workers_dev`, turns workers.dev off and leaves Preview URLs to follow it (`subdomainDeploy` in wrangler's `cli.js`). The Workers Builds comments on pull requests show no Preview URL. That is inference, not proof: **in the dashboard, Workers & Pages → `dspack-studio-composer` → Settings → Domains & Routes, confirm that workers.dev and Preview URLs are both disabled**, and disable either that is not. If either was enabled, Composer was reachable without Access, and that is a blocking finding (an invite-access bypass).
2. **The zone already answers the beta's hostname.** On 2026-10-17, `composer-beta.aesthetic-function.com` and a made-up name under the zone both answered HTTP 522 from Cloudflare: the zone has a proxied wildcard record, and no Worker serves the beta hostname. So an Access application can protect the beta hostname before the beta Worker exists, and should ([../deployment.md](../deployment.md), "The first deploy").

### The configuration

**One allowlist policy for people, used by both hostnames.** In Zero Trust → Access → Policies, a reusable policy:

| Setting | Value |
|---|---|
| Name | `AF Composer invite allowlist` |
| Action | Allow |
| Include | **Emails**: exactly the addresses the owner provides, one per invited person, the owner's own included. No email-domain rule, no "Everyone", no identity-provider group, no IP range, no country rule. |
| Require | none, unless the owner chooses a login method to require (below) |
| Exclude | none |
| Session duration | 24 hours (recommended) |

**Two self-hosted applications, each with only that policy:**

| Application | Destination | Path | Policies |
|---|---|---|---|
| `AF Composer` | `composer.aesthetic-function.com` | empty (the whole hostname, `/api/*` and the static assets included) | `AF Composer invite allowlist` |
| `AF Composer beta` | `composer-beta.aesthetic-function.com` | empty (the whole hostname) | `AF Composer invite allowlist` (and, if approved, the machine policy below) |

Two applications keep each hostname's Access settings and logs apart, and match the workflow's expectation that the beta's application covers the whole hostname. One application with both hostnames as destinations would also satisfy "one policy for both". Either way there is exactly one policy for people. Keep the applications out of the App Launcher, and leave CORS settings off: the app calls only its own origin.

**Machine access (a separate decision).** The canary harness and the zero-cost baseline capture call the beta without a browser, so they need an Access service token. Access admits a service token through a policy whose action is Service Auth, not through an Allow policy for people. Proposed, for the owner to approve or refuse:
- a service token `composer-beta-canary`, with the shortest duration the dashboard offers, revoked once the canary is done, and stored only as `CF_ACCESS_CLIENT_ID_BETA` and `CF_ACCESS_CLIENT_SECRET_BETA` on the machine that runs the harness;
- a policy `composer-beta canary token`, action Service Auth, Include: that service token only, attached to `AF Composer beta` only. Never to production.

Without it, nothing automated can reach the beta: not the baseline, not the canary. The alternative is a manual baseline in a signed-in browser, and no canary.

**Login method.** One-time PIN works for any email address with no identity provider. If a GitHub or Google identity provider is already set up in Zero Trust, it can be used instead; the allowlist matches the email the provider returns.

### What changes for production when Access is on

- Anyone not on the allowlist gets the Access login instead of Composer, including from public links to `composer.aesthetic-function.com`. That is the owner's intent.
- `/api/models` and `/api/propose` sit behind Access too, so hosted generation becomes invite-only as well. The app's own requests are same-origin and carry the Access cookie.
- The Studio exhibit, the af-site and the local agent are other hostnames or the visitor's own machine, and are unaffected.
- Anonymous checks of production stop working: the build-id read, the `/api/models` comparison and the live-artifact scan used after each merge (this review's post-merge record) all meet the login. Production verification after Access needs a signed-in browser, or a production service token, which is not proposed now (backlog).
- The `deploy-composer` workflow's production smoke (never dispatched) would fail behind Access for the same reason (backlog).

### Verify after applying (no credentials, no cost)

From any machine whose Node reaches the internet directly:

```sh
node apps/composer/scripts/check-beta-deploy.mjs --access=after       # the beta hostname
node --input-type=module -e '
  import { checkAccess } from "./apps/composer/scripts/check-beta-deploy.mjs";
  const problems = await checkAccess("https://composer.aesthetic-function.com", { phase: "after", attempts: 1 });
  console.log(problems.length ? problems.join("\n") : "production: anonymous requests go to the Cloudflare Access login");
  process.exit(problems.length ? 1 : 0);'
```

Each probes `/`, `/api/models` and a static-asset path anonymously, and passes only on a redirect to the Access login. The paid endpoint is a POST, which those probes do not send, so check it too; the Worker would answer an empty body with its own 400 JSON, and Access must answer first:

```sh
for h in composer.aesthetic-function.com composer-beta.aesthetic-function.com; do
  curl -sS -o /dev/null -w "$h %{http_code} %{redirect_url}\n" -X POST -H 'content-type: application/json' -d '{}' "https://$h/api/propose"
done
```

Each must answer with a redirect to the Access login (or Access's own 401 or 403), never the Worker's 400. The Worker does not check Access's token itself; Access covering the whole hostname is the boundary. Then, in a private browser window:
- sign in with an allowlisted address: Composer loads on both hostnames;
- sign in with an address not on the list: Access refuses it on both.

## The invite information needed from the owner

1. **The exact email addresses to allow**, the owner's included. Not domains: the policy lists people.
2. **The login method:** One-time PIN, or a named identity provider already configured in Zero Trust.
3. **Session duration**, if not 24 hours.
4. **The machine policy:** approve or refuse the beta-only service token for the baseline and the canary.
5. **The test window's list,** if different: who is on the allowlist while the manual checks and the canary run, before the wider invitations ([MANUAL-A11Y-PACKET.md](MANUAL-A11Y-PACKET.md)).
6. **Confirmation of the dashboard check above** (workers.dev and Preview URLs off on production's Worker).

## Prerequisites before the first dispatch

1. Access applied and verified on both hostnames, as above.
2. The `composer-beta` GitHub environment, as `docs/deployment.md` lists: the owner as required reviewer, deployment branches limited to `main`, the secret `CLOUDFLARE_API_TOKEN_BETA` and the variable `CLOUDFLARE_ACCOUNT_ID`. The token is account-owned and never production's. It needs Admin at the Workers scope for the first deploy only (which creates the Worker), then Editor on `dspack-studio-composer-beta` plus Workers Routes Write on the zone.
3. The gateway: Cloudflare's daily spend limit at $10 with auto top-up off, and `ds-ai-gateway`'s Retry Requests off.
4. The release review passes, apart from the items that need the deployed beta.
5. `main` is still the release candidate, or a documentation-only successor the owner approved. Check: `git diff --stat 7ff13c9 origin/main -- . ':(exclude)docs'` prints nothing.
6. For the baseline and the canary: the harness can send the beta's service token. Today it cannot (`packages/block-bench/live/preflight.ts` and `providers/hosted.ts` send no Access headers); [BETA-OPERATIONS.md](BETA-OPERATIONS.md) records this as a later, separately authorized change. It is harness-only, never part of either artifact, and can run from its own branch, so it does not touch the release candidate.

## Deploy, with the block switch off

0. **Access first, proved before the dispatch.** A first deploy skips the workflow's pre-deploy Access check, the Worker answers hosted requests as soon as it exists (`HOSTED_AI` absent means on), and nothing undoes a deploy whose post-deploy check fails. So with Access applied, run `node apps/composer/scripts/check-beta-deploy.mjs --access=before` and the POST probe above: both must show the Access login. Today, before Access, the first fails on the zone's 522, as it should.
1. Dispatch `deploy-composer-beta` from `main`: `confirm` = `deploy-composer-beta`, `first_deploy` checked. It builds the experimental artifact, runs `check-beta-deploy` (both configs, and an artifact that carries the block code and the switch), deploys with wrangler 4.146.0, records the new version, and checks that anonymous requests go to the Access login.
2. In the dashboard, on `dspack-studio-composer-beta`, set `BLOCKS_BETA` as type **Text** to:
   ```json
   {"enabled":false,"references":["astryx"],"blocks":["records-table","auth-form","guide-steps"]}
   ```
   Off on purpose: the beta's `/api/models` then reports `"blocks":{"enabled":false,"reason":"disabled"}` instead of no field at all.
3. Leave `HOSTED_AI` unset (on): the baseline's zero-cost probe needs the Worker to reach its 400 refusal, which `HOSTED_AI=off` would pre-empt with a 503.
4. Set `BETA_OPERATOR_LOG` to exactly `on`, as type **Text**. The stop conditions read the served model, the usage and the provider errors from this shape-only log ([BETA-OPERATIONS.md](BETA-OPERATIONS.md), "Alarms"), and no endpoint shows whether it is on. The baseline's refused probe (below) writes one line, which confirms it in Workers Logs at no cost. Production never sets it.

## Baseline and rollback anchors

- **Beta anchor.** The first deploy has none: the workflow records the version it created. The second deploy (the rehearsal, below) records the first as its anchor.
- **Production anchor.** Production's current version is the deployment of `7ff13c9` (build `gKkER1t3h4vi7NqRO7_Yh`, live from 2026-10-17T12:37:01Z). The owner records its version id from the dashboard or `npx wrangler deployments list --config wrangler.jsonc`. Production and the beta roll back independently.
- **Beta baseline.** With the service token:
  ```sh
  CF_ACCESS_CLIENT_ID_BETA=… CF_ACCESS_CLIENT_SECRET_BETA=… \
    pnpm --filter @dspack-studio/block-bench baseline --base-url https://composer-beta.aesthetic-function.com --out <file>
  ```
  Four requests, none of which reaches a model ([BASELINE.md](BASELINE.md)). Keep the record beside the canary's run, never over `docs/blocks/baseline.json`.

## Rollback rehearsal (once)

1. Dispatch `deploy-composer-beta` again, without `first_deploy`: same release candidate, a second version, with the first recorded as its anchor.
2. Roll back to the anchor: Workers & Pages → `dspack-studio-composer-beta` → Deployments → the anchor version → Rollback; or `npx --yes wrangler@4.146.0 rollback --config wrangler.composer-beta.jsonc <anchor version id>` with the beta token. Always name the anchor: each variable change in the dashboard deploys a new version, so "the previous version" may be another one.
3. Set `BLOCKS_BETA` (off), `HOSTED_AI` and `BETA_OPERATOR_LOG` again as above: a rollback can bring back the variables the anchor had.
4. Run the zero-cost smoke. Record the anchor, the rollback time and the smoke result.

## Zero-cost smoke

No model call, no cost:
1. The two Access checks above: anonymous requests go to the login on both hostnames.
2. Signed in, on the beta:
   - `/api/models` is exactly `{"models":["scripted","hosted-ai"],"blocks":{"enabled":false,"reason":"disabled"}}`;
   - the page loads; in a fresh browser profile, Settings → Experimental shows the blocks preference off;
   - a scripted build completes; with the preference on, the build's note says blocks are switched off.
3. Signed in, on production: the page loads, and `/api/models` is exactly `{"models":["scripted","hosted-ai"]}`.
4. The beta baseline above.
5. Workers Logs shows the baseline probe's operator-log line: `"event":"composer.propose"`, `status` 400, `calls` empty.

## The Stage 1 canary (proposed; not authorized)

ADR-B3's systems smoke ([ADR-B3-ADDENDUM.md](ADR-B3-ADDENDUM.md), "The stages"), on the beta's one reference: fresh prompts `rt-01`, `af-01`, `gs-01` and `nb-01`, all four arms, Astryx only, 16 cells. It is systems evidence, never decision evidence. It needs the harness's service-token support (prerequisite 6), and runs only on the owner's explicit authorization:

```sh
CF_ACCESS_CLIENT_ID_BETA=… CF_ACCESS_CLIENT_SECRET_BETA=… \
pnpm --filter @dspack-studio/block-bench eval:live -- --provider hosted \
  --base-url https://composer-beta.aesthetic-function.com \
  --reference astryx --conditions fresh --prompts rt-01,af-01,gs-01,nb-01 \
  --max-total-requests 80 --max-requests 80 --max-total-usd 5 --spacing-ms 12000
```

- **Caps.** At most 80 requests. A dollar ceiling of $5.00, the smallest whole-dollar ceiling the harness accepts: it admits a cell only while the committed spend plus the cell's absolute worst case ($4.472832) fits under the ceiling, and a request only while the committed spend plus $1.118208 fits. 80 requests leave room for every cell at four requests each.
- **Expected cost: about $0.20.** The Option B systems smoke's 16 Astryx cells settled at $0.1833 at reported usage (2026-10-12, corpus v1, served by `claude-haiku-4-5-20251001`). **Maximum: $5.00**, the harness's hard ceiling, inside the beta's $8 pause line and the $10 daily limit.
- **Time:** about 10 minutes at 12-second spacing.
- **Clean means:** the run completes 16 cells; no integrity stop (every provider-reached call reports usage and its served model; one model throughout, Claude Haiku 4.5); the preflight equals the beta baseline apart from its time; and no request leaves the reservation it was priced at.
- **Stops:** any integrity stop ends the run and is an alarm ([BETA-OPERATIONS.md](BETA-OPERATIONS.md)): disable blocks, keep them off, and report. The run is never resumed without the owner.

## The invitation

Settings in the release candidate calls the build "experimental" but never "beta", and lists no known gaps (the release review, criteria 25 and 26). Until that copy changes, the invitation carries both. A draft, in AF voice:

> You are invited to the AF Composer experimental beta. It is invite-only and not generally available.
>
> Composer: https://composer.aesthetic-function.com. The beta, with interface blocks on Astryx: https://composer-beta.aesthetic-function.com. Sign in with this email address.
>
> To try blocks, open the beta, go to Settings, Experimental, and turn on "Use interface blocks when a goal matches one". Start from the Astryx reference project or an Example session. Imported projects, local models and shadcn/ui projects are not offered blocks.
>
> Known gaps: the auth-form block does not state its fields' input purpose (WCAG 2.2 SC 1.3.5), so a host must restore it; never type a real password into a preview. Fields' resting borders are low contrast. The beta does not claim full WCAG 2.2 AA conformance. Its storage is separate from Composer's. The full list: https://github.com/aestheticfunction/dspack-studio/blob/main/docs/blocks/BETA.md
>
> Reply to this email with anything that confuses you or gets in your way.

## After a clean canary

Recommend enabling Astryx blocks, in two moves the owner controls:
1. Turn the switch on, as Text: `{"enabled":true,"references":["astryx"],"blocks":["records-table","auth-form","guide-steps"]}`. Every user still opts in through the preference. If the owner wants criterion 25 met literally before the in-product copy changes ("the beta does not ship auth-form without" its exception shown), list only `"records-table","guide-steps"` until it does.
2. While the allowlist holds only the owner and the testers, run the minimum manual checks ([MANUAL-A11Y-PACKET.md](MANUAL-A11Y-PACKET.md)). Only when they pass is the release an official beta, and only then does the allowlist grow.

The stop conditions and alarms stay as the owner set them ([../deployment.md](../deployment.md), "Stop conditions"; [BETA-OPERATIONS.md](BETA-OPERATIONS.md), "Alarms").

## Not part of this closeout

The UI redesign is the next planning phase, informed by the invite-only beta's feedback ([POST-BETA-BACKLOG.md](POST-BETA-BACKLOG.md)).
