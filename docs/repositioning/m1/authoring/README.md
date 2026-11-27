# M1 authoring, first increment: draft, edit, check, approve on this device (A1 to A4)

**Status:** implemented for the product owner's evaluation, 2026-11-27. **Not merged or deployed.** Experimental build only; the default application and artifact are unchanged.

A designer can now:
- take an approved composition;
- make a draft;
- change its details, parameters and examples;
- run its checks and see which examples fail and why;
- approve that exact version on this device.

It extends the existing Library workspace. There is no second editor, schema, validator, governance pipeline or shell.

## What a designer can do

| Step | In the interface | Underneath |
|---|---|---|
| **A1 Create a draft** | **Create draft** (the toolbar's primary action on an approved version with no draft). The draft opens in the inspector. An approved version that already has a draft offers **Open draft vN** instead, and the version control beside the title selects it | `editComposition` forks the newest approved version as vN+1. The approved version is not touched |
| **A1 Discard a draft** | **Discard draft…** at the foot of the inspector, with a confirmation that says what is removed and that approved versions are unaffected | `discardDraft`. A packaged sample draft is withdrawn on this device only, as a retired key in the `versions` record |
| **A2 Edit details** | Inspector, **Details**: name, summary | One `editDraft` per change, validated by the same loader as a packaged composition; refused with the reason, in place, if invalid |
| **A2 Edit parameters** | **Details**, Parameters: description, required, and bounds for the type (length, range, choices) | The declared `PropSpec`s, nothing else. A composition with no parameters says so |
| **A2 Edit examples** | Inspector, **Examples**: choose, add, duplicate, remove; name; what should happen (shown, or refused by a rule chosen from the contract); state; data as a form (lists of hotels with add and remove), with **Edit the data as JSON** in a closed disclosure | The form is generated from the declared data fields. Data problems are said before the checks ("Nights: must be at least 1"), from `validateInstanceInput` |
| **A2 See it** | The canvas previews every change through the pipeline (`instantiate`), labelled **Preview of this draft: not checked yet**. If an edit cannot be shown, the refusal says why and the last valid preview stays, marked **not interactive** | No host authorizes an unchecked draft. Actions in a preview still only show what they would send, with sensitive values redacted |
| **A3 Run checks** | **Run checks** (primary) at the foot of the inspector. Each state is visible: **Not checked**, **Checking…**, **Checks fail**, **Checks pass**. Failing examples say what to do and offer **Edit this example**. Any edit makes a passing check stale | `recheck` over every example. A check counts only for the exact definition it checked |
| **A4 Approve** | **Approve version…** (primary), offered only when the current draft's checks pass under the packaged rules. A confirmation says, before anything happens: it becomes immutable; earlier versions stay; this device only; not published | `approveDraft`, then a re-check of the approved definition (whose hash differs), then **one** write of the `versions` record. Only after that write is the version shown as approved |

After approval the version reads **Approved on this device** in the inspector, distinct from the packaged **Approved** versions. A reload keeps it, and it is re-checked on load like every version. The next draft is numbered above it. With three or more versions, the version control becomes a menu.

## Guarantees and how they are held

| Guarantee | How |
|---|---|
| Approved versions never change | Forks and edits go through `editComposition`; approval creates a new approved version and leaves every other version byte-identical (core unit test). The packaged definitions file is unchanged; the D0 test holds v1 to R1a |
| Edits are valid compositions | `definitionIssues` runs the packaged loader (`loadCompositions`) on the edited definition; invalid edits are not applied |
| No stale approval | Approval requires a passing check whose pins match the current draft under the packaged rules (`checkIsCurrent`); an edit invalidates it in the interface and in the guard |
| All-or-nothing approval | Re-check first, then a single write; a failed re-check or write approves nothing (unit tests inject a failing store; a browser test blocks the write) |
| Stored records are evidence | The `versions` record holds definitions, validated by the 0.2 parser and the loader on read; every version is re-checked on load before a host may use it |
| Storage stays in its boundary | New record kind `versions` in the experimental namespace; drafts use the existing `drafts` record; the default artifact check refuses the authoring markers |
| Sensitive values stay safe | A preview redacts with `redactEvent` from the draft's own declarations; the browser test types a loyalty number and finds it nowhere |

## Evidence

- **Unit tests.**
  - `versions.test.ts` (5 new): approve and discard keep other versions byte-identical; the approved hash differs and needs a re-check; refusals.
  - `authoring.test.ts` (11): create, edit, discard, check invalidation, approval, failed writes, and leftover-draft recovery.
  - `storage.test.ts`: the `versions` record shape.
- **Browser** (`e2e/composer-authoring.spec.ts`, 17 tests): every step above, the full walkthrough, keyboard use, the phone sheet, and axe at 1280 and 390 across details, an example with an issue, failing checks and the discard confirmation, with **no exception**.
- **Screenshots** of the whole journey are in [screenshots/](screenshots/), made with [walk.cjs](walk.cjs): steps 01 to 11 at 1280 × 800, 12 to 14 on a phone.
- **Final-tree results** are in the PR.

## How to evaluate it

From the repository root, on the authoring branch:

```bash
pnpm install
```

```bash
pnpm --filter composer build:experimental
```

```bash
COMPOSER_OUT_DIR=out-experimental PORT=3315 node e2e/serve-composer.mjs
```

Open `http://localhost:3315/` and choose **Library**. The short walkthrough is in [AUTHORING-WALKTHROUGH.md](AUTHORING-WALKTHROUGH.md). To start again, clear the site's storage.

## Limitations

- **Structure is not editable**: templates, states, inputs and actions, by decision. The inspector says so.
- **Constraints are not editable**: cross-field constraints are not authorable in a 0.2 document yet.
- **Approval is on this device only.** No sharing, no publication, no history beyond the versions present.
- **On a phone, the inspector sheet covers the canvas while editing.** Close it to see the preview.
- **A changed parameter declaration is checked against the examples only**: the Library never supplies parameter values when it shows a composition.
- **Draft changes are listed per field, not shown side by side** with the approved version.
- **No human has used it.** The walkthrough is ready; no one has been recruited or contacted.

## Decisions for the owner

1. **Merge** this increment after your evaluation.
2. **Whether "Approved on this device" may be withdrawn on the device** (today it can only be superseded by a newer version).
3. **The next increment:** see the recommendation in the PR description.
