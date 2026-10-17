# The interface blocks beta

**An experimental beta: invite-only, on Astryx only, and not generally available.**

This page is what the release plan asks the beta's own page to hold ([PHASE-2-RELEASE-PLAN.md](PHASE-2-RELEASE-PLAN.md), §11): who can use it, opting in, eligibility, storage per origin, the runbook, the metrics and the known gaps. **The beta is not deployed yet.** Under the owner's single-host amendment it runs on the existing Composer, `composer.aesthetic-function.com` and its Worker, with no separate beta hostname or Worker. Cloudflare Access, the cutover and the canary wait on the owner ([BETA-DEPLOY-PLAN.md](BETA-DEPLOY-PLAN.md)). How it is built is in [../BLOCKS.md](../BLOCKS.md) ("The beta (Phase 2)").

## Who can use it

- **Invite-only.** Cloudflare Access is to protect `composer.aesthetic-function.com`, with email one-time PIN, admitting at first only the owner's exact email; tester addresses are added later ([PHASE-2-DECISION-RECORD.md](PHASE-2-DECISION-RECORD.md), "The single-host amendment"). It is not applied yet. Once it is, the existing public Composer is no longer reachable anonymously: it becomes the invite-only beta.
- **Not a conformance claim.** The target is WCAG 2.2 AA, but the beta does not claim full conformance: two exceptions are accepted for the invite-only beta only (below).

## Opting in

1. After the cutover, open `https://composer.aesthetic-function.com` and sign in through Cloudflare Access with the one-time code sent to your address.
2. In Settings → Experimental, turn on "Use interface blocks when a goal matches one". It is off on a fresh origin.
3. The beta's own switch must be on too. When it is off, missing or unreadable, a build offers no blocks, and the build's note says why.

To build without a block, turn the preference off. There is no per-turn control yet: the plan's selection decision (§13, decision 8) is open.

## Eligibility

A build is offered a block only when all of these hold:
- the project is a packaged Astryx reference project or an Example session, on its unedited design system, built in the browser;
- the block and its sidecar are approved, and the beta's switch lists the block;
- the goal matches the block's declared intent.

Never offered, and the build's note names the reason: imported and repository projects, local models, an edited contract or profile, a block an invariant failure disabled in this session, and shadcn/ui v3 projects, which the beta withholds (below).

Not in the beta (the plan's §5): positional encoding, local models, repository and imported projects, refinement seeded from stored provenance in a later session, and a manual block picker.

## Storage per origin

- **The beta shares the existing origin's browser storage.** It is the same origin as the public Composer was, so the projects, worked examples and preferences a tester saved there before are still there.
- **Start from a packaged reference project or a fresh Example session.** An imported project is never offered blocks, and a project edited before the beta may not be eligible.
- **Exports leave block provenance behind outside the beta.** A beta export imported into a default build, or read after a rollback to the block-free release candidate, loses its block provenance: a default build drops the field.
- **A rollback leaves beta-only data in the browser,** the experimental preference and the provenance records. The default build ignores both.
- A contract re-bind makes every existing provenance record for that reference inert, and its surfaces then render as ordinary surfaces (the plan's §8).
- Clearing the beta origin's site data deletes everything the beta stored in that browser.

## The runbook

For operators: [BETA-DEPLOY-PLAN.md](BETA-DEPLOY-PLAN.md) (the cutover order, the rollback and the canary) and [PHASE-2-DECISION-RECORD.md](PHASE-2-DECISION-RECORD.md) ("Step 2, authorized": the stop conditions, which still apply). In short:
- **Stop blocks, keep hosted builds:** set `"enabled": false` in `BLOCKS_BETA`. The next build offers none.
- **Stop hosted generation:** set `HOSTED_AI` to `off` on the Composer Worker.
- **Roll back:** to the recorded anchor, the block-free release candidate on the same hostname, then set the switches again. There is one Worker, so a rollback affects every user of Composer.

## The metrics

- **Decision-grade numbers come only from the owner-run canary,** which is blocked until the owner authorizes a temporary machine credential; it runs under ADR-B3's definitions, with counts beside every rate ([PHASE-2-RELEASE-PLAN.md](PHASE-2-RELEASE-PLAN.md), §9, "Metrics the beta reports"; [BETA-OPERATIONS.md](BETA-OPERATIONS.md), "The canary").
- **Receipts, the operator log and diagnostics files are field data.** They can raise an alarm ([BETA-OPERATIONS.md](BETA-OPERATIONS.md), "Alarms"). They never decide anything.

## Known gaps

### auth-form: the accessibility exception (WCAG 2.2 SC 1.3.5, input purpose)

The owner included auth-form in the beta under this explicit exception, with GA blocked on it ([PHASE-2-DECISION-RECORD.md](PHASE-2-DECISION-RECORD.md), decision 8; the plan's §10, and §13 decision 4). On 2026-10-17 the owner accepted it as a documented invite-only beta exception, with the host mitigation below; it remains a blocker for GA.

**What fails.** A form that asks for an email address, a password, a name or a username must say each field's purpose in code, with its `autocomplete` token, so that browsers, password managers and assistive technology can fill and label it. The governed surface cannot say it:
- Neither contract has an `autocomplete` vocabulary.
- Both profiles map `email` to A2UI `shortText`, so even `type="email"` is lost on emission, and Composer's preview renders the email field as a text field.
- Step 6 does not expand the upstream vocabulary. That is the work GA waits on.

**What holds.** Each field has a visible label and is marked required, and the password field is a password field. Labels and input types are template literals chosen by enum ([HOST-ACTIONS.md](HOST-ACTIONS.md), rule 7). The rest of the form meets the checks in [ACCESSIBILITY.md](ACCESSIBILITY.md).

**Host mitigation.** A host that renders an auth-form surface for real users restores each field's purpose in its own renderer. A field's id is the template's `auth-<field>-input`, built only from a literal and the `fields` enum, so it names the field and the model never writes it:

| Field id | `type` | `autocomplete` |
|---|---|---|
| `auth-email-input` | `email` | `email`, or `username` when the email is the sign-in identifier |
| `auth-password-input` | `password` | `current-password` on a sign-in form, `new-password` on a sign-up form |
| `auth-name-input` | `text` | `name` |
| `auth-username-input` | `text` | `username` |

The host also:
- allows paste and password managers (SC 3.3.8);
- owns error messages, `aria-invalid` and their announcement (SC 3.3.1, 3.3.3, 4.1.3), since the governed surface drops `form-message` as runtime data;
- submits credentials only from its own form state, to its own endpoint ([HOST-ACTIONS.md](HOST-ACTIONS.md), rule 7);
- checks its own rendering by hand, since axe cannot detect a missing `autocomplete`.

**In the beta itself.** Composer's preview is for reviewing a surface, not for signing in. The form's fields carry no data-model binding, so typed text stays in the page, and Composer executes no action ([HOST-ACTIONS.md](HOST-ACTIONS.md)). Never type a real password into a preview.

### Other accessibility limits

The owner decided step 6's proposed waivers on 2026-10-17 ([ACCESSIBILITY.md](ACCESSIBILITY.md), "Waivers"):
- **Astryx's resting field border, 1.5:1 (SC 1.4.11):** accepted temporarily for the invite-only beta. A 3:1 treatment is required before public expansion or GA.
- **"Start" and "Save guide" (SC 2.4.6):** accepted for the invite-only beta in their current context.

The checks that still need a person, every screen-reader pass among them, are in [MANUAL-A11Y-PACKET.md](MANUAL-A11Y-PACKET.md). The release is not called an official beta until its minimum checks pass.

### shadcn/ui v3 blocks are withheld

The beta offers Astryx blocks only. The shadcn/ui v3 evaluation remains inconclusive (pass, uncertain), and the owner deferred its Stage 4 ([PHASE-2-DECISION-RECORD.md](PHASE-2-DECISION-RECORD.md), decisions 2 to 4).
