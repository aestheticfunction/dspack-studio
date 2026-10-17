# The interface blocks beta

**An experimental beta: invite-only, on Astryx only, and not generally available.**

This page begins with the beta's known gaps, from Phase 2 step 6. The rest of what the release plan gives it ([PHASE-2-RELEASE-PLAN.md](PHASE-2-RELEASE-PLAN.md), §11: opting in, eligibility, storage per origin, the runbook and the metrics) comes with the plan's documentation step. Until then, see [../BLOCKS.md](../BLOCKS.md) ("The beta (Phase 2)"), [../deployment.md](../deployment.md) ("The beta composer") and [BETA-OPERATIONS.md](BETA-OPERATIONS.md).

## Known gaps

### auth-form: the accessibility exception (WCAG 2.2 SC 1.3.5, input purpose)

The owner included auth-form in the beta under this explicit exception, with GA blocked on it ([PHASE-2-DECISION-RECORD.md](PHASE-2-DECISION-RECORD.md), decision 8; the plan's §10, and §13 decision 4).

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

[ACCESSIBILITY.md](ACCESSIBILITY.md) records the waivers proposed to the owner (Astryx's resting field border at 1.5:1, and the template's generic "Start" and "Save guide") and the checks that still need a person, including every screen-reader pass.

### shadcn/ui v3 blocks are withheld

The beta offers Astryx blocks only. The shadcn/ui v3 evaluation remains inconclusive (pass, uncertain), and the owner deferred its Stage 4 ([PHASE-2-DECISION-RECORD.md](PHASE-2-DECISION-RECORD.md), decisions 2 to 4).
