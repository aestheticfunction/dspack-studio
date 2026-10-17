# Manual accessibility test packet: the Astryx beta

**Phase 2, step 7.** One packet for every accessibility check the automated suite cannot do ([ACCESSIBILITY.md](ACCESSIBILITY.md), "Still needs a person"). **None of these checks has been done.** No screen-reader pass has been run with NVDA, VoiceOver, TalkBack or any other screen reader, and no keyboard pass has been run in Firefox or Safari. The automated suite runs in Chromium only, with scripted key events. Record results only for checks a person actually ran, with the device, browser, assistive technology and versions.

The target is WCAG 2.2 AA. The beta does not claim full conformance: two exceptions are accepted for the invite-only beta only (below).

## The minimum before the release is called an official beta

The owner's rule (2026-10-17): at minimum, a real keyboard pass in Safari and Firefox, and a real screen-reader pass, on the three Astryx blocks. As checks:

| # | Check | Who or what device | Blocks | Pass when |
|---|---|---|---|---|
| M1 | Keyboard pass in **Safari** | A sighted keyboard user on a Mac, current macOS and Safari. Turn on Safari → Settings → Advanced → "Press Tab to highlight each item" (otherwise Tab skips buttons). Leave "Reduce motion" off. | records-table, auth-form, guide-steps, in Build and in Preview | Script A passes for each block |
| M2 | Keyboard pass in **Firefox** | A sighted keyboard user on Windows or macOS, current Firefox. On macOS, turn on System Settings → Keyboard → "Keyboard navigation". | the same | Script A passes for each block |
| M3 | Screen-reader pass with **VoiceOver and Safari** on macOS | A person who uses VoiceOver, or who has practised its basic commands (VO keys, rotor, table navigation), on a Mac | the same | Script B passes for each block |
| M4 | Screen-reader pass with **NVDA** and Firefox (or Chrome) on Windows | A person who uses NVDA, or who has practised its browse and focus modes and table commands, on a Windows PC. NVDA is free. | the same | Script B passes for each block |

The plan names VoiceOver and NVDA for the screen-reader check (the release plan, §10), so the minimum is both desktop pairings. If only one tester and one machine are available, the owner decides whether one pairing is enough to start; that is a remaining decision (below).

**Recommended in the same sittings,** because they cost minutes with the same people and machines:
- R1. Browser zoom to 200% (Cmd or Ctrl and +) in Safari and Firefox, with the window at a normal desktop height, during M1 and M2: nothing is cut off, overlaps or scrolls sideways, apart from a table scrolling inside its own region.
- R2. guide-steps by eye, in Build and Preview: its two tables sit apart, and no row hides behind the next table's header (ACCESSIBILITY.md, item 9).
- R3. On the Windows machine for M4: Settings → Accessibility → Contrast themes, one dark and one light theme. Focus stays visible on every control, and every field's boundary is visible (item 4).

## May be deferred until the audience expands

None of these blocks the invite-only beta. Each must be done before public opt-in or GA, unless the owner waives it then.

| # | Check (ACCESSIBILITY.md item) | Who or what device |
|---|---|---|
| D1 | VoiceOver with Safari on iOS, and TalkBack with Chrome on Android (item 1) | An iPhone and an Android phone, with users of each screen reader |
| D2 | Touch: target size, and scrolling a wide table's region, in portrait and landscape (item 6; SC 1.3.4) | A phone and a tablet |
| D3 | Real 400% zoom, text-only zoom to 200% (Firefox "Zoom text only"), and text spacing with a bookmarklet, in more than one browser (item 3) | Any desktop browser |
| D4 | Speech input: each control operated by saying its visible label (item 7; SC 2.5.3) | Voice Control on macOS or iOS, or Dragon on Windows |
| D5 | The composer shell on a tablet in portrait, and in windows 721 to 1000 px wide (item 11) | A tablet, or a desktop window |
| D6 | Astryx surfaces that are not blocks: model-generated and imported (item 10) | Any tester, during the beta |
| D7 | The Studio exhibit's heading outline, now h1 and h2 (item 12). The exhibit deploys on its own cadence; check it when it next deploys. | A screen-reader user, with heading navigation |
| D8 | Focus indicators with motion on, beyond M1 and M2 (item 5) | Covered by M1 and M2 with "Reduce motion" off; repeat on other platforms later |
| D9 | Input purpose in a host (item 8; SC 1.3.5): a host restores `autocomplete` and `type` as [BETA.md](BETA.md) tells it to | The host's own team, in the host |

## Where and how to test

**Where.** `https://composer.aesthetic-function.com` after the cutover: the existing Composer, signed in through Cloudflare Access with a one-time code, with the block switch turned on for the test window ([BETA-DEPLOY-PLAN.md](BETA-DEPLOY-PLAN.md), steps F to H). There is no separate beta hostname. The Access policy holds only the owner's address at first; the owner adds each tester's exact address for the window. Use **scripted** mode: it builds each block's approved example with no model call and no cost.

**Getting each block.**
1. Open `https://composer.aesthetic-function.com` in a fresh browser profile, and sign in with the one-time code. The origin's storage is shared with the Composer testers may have used before, so start fresh: a new profile, then a packaged reference project or a fresh Example session.
2. Settings → Experimental: turn on interface blocks.
3. Open the Astryx reference project (or an Astryx Example session), and choose the scripted model.
4. In Build, enter the goal below. The build's note says which block it used. If it used none, check the note's reason; if it names the intent, choose the intent shown and build again.

| Block | Goal | The block's intent on Astryx |
|---|---|---|
| records-table | a queue of open support tickets with status and priority | record-collection |
| auth-form | a sign-in form with email and password | data-collection |
| guide-steps | a step by step recipe for weeknight pasta | structured-editing |

5. Accept the surface, and repeat the checks in Preview.

Never type a real password into the auth-form preview. It is for review, not for signing in.

## Script A: keyboard (M1, M2)

Start with focus in the page's address bar or at the top, and use only the keyboard.
1. Tab forward through the whole surface, then Shift+Tab back. Every control is reached, in a sensible order, and focus never gets stuck.
2. Every focused control shows a visible focus indicator you can see clearly. Nothing focused is hidden behind the page header.
3. Each button works with Enter and with Space. Each field takes typed text. The auth-form's password field hides what is typed.
4. A table too wide for its space: Tab reaches its scrolling region (it shows a blue ring), and the arrow keys scroll it.
5. The beta's own controls, which the automated suite checks only lightly (axe with the WCAG 2.0 tags, in shadcn/ui projects, with no keyboard or reflow pass): in Settings → Experimental, "Use interface blocks when a goal matches one" and Diagnostics → "Download build diagnostics"; in Build, the build's note, the pipeline detail with its Block row, and the receipt; in Catalog, the Blocks section. Each can be reached and used with the keyboard.
6. With R1: repeat steps 1 and 2 at 200% zoom.

Fail: any control unreachable or unusable by keyboard, a focus trap, a focused control with no visible indicator, or focus hidden behind something.

## Script B: screen reader (M3, M4)

For each block, in Build and in Preview:
1. **Heading.** Navigate by headings (VoiceOver rotor, Headings; NVDA, H). The surface's title is announced as a heading, level 2, and there is no empty heading.
2. **Tables.** Navigate to each table (NVDA, T; VoiceOver, rotor or VO+Cmd+T). The table's scrolling region is announced with a name made of its column names, for example "Table: Ticket, Subject, Status, Priority". Move through cells with the table commands: each cell's column header is announced. Judge by ear whether a long region name (the maximum call names about 330 characters), and two tables that share a name, are acceptable.
3. **Fields** (auth-form). Each field is announced with its label and as required. The password field is announced as a password field. Expect no autocomplete purpose: that is the known SC 1.3.5 exception, not a new failure.
4. **Buttons.** Each button is announced by its visible label. Provider buttons have distinct names ("Continue with GitHub", and so on).
5. **Status text** (records-table). Status is read as text, not conveyed by color alone.
6. **guide-steps.** "Start" and "Save guide" are generic; judge whether they make sense in context (an accepted waiver for the invite-only beta).
7. **Nothing extra.** No unlabelled control, and nothing announced that is not on screen.
8. **The beta's own controls.** Settings → Experimental (the opt-in checkbox is announced with its label and state), the build's note, the Block row and the receipt, and Catalog → Blocks: each is reachable and makes sense read aloud.

Fail: a title not announced as a heading, a table or region without a meaningful name, a field without its label or required state, a button without a name, or anything that stops the tester completing the review.

## Accepted for the invite-only beta (2026-10-17)

The owner's decisions, recorded in [PHASE-2-DECISION-RECORD.md](PHASE-2-DECISION-RECORD.md):
1. **auth-form, SC 1.3.5 (input purpose).** A documented invite-only beta exception, with the host mitigation in [BETA.md](BETA.md). It remains a blocker for GA.
2. **Astryx's resting field border, 1.5:1 (SC 1.4.11).** Accepted temporarily for the invite-only beta. The beta does not claim full WCAG 2.2 AA conformance, and a 3:1 treatment is required before public expansion or GA.
3. **"Start" and "Save guide" (SC 2.4.6).** Accepted for the invite-only beta in their current context.
4. **shadcn/ui v3 findings.** Deferred: shadcn/ui v3 is withheld and not part of this beta.

## Remaining decisions for the owner

1. **One screen-reader pairing or two.** The plan's §10 names VoiceOver and NVDA, so M3 and M4 are both in the minimum. If only one can be done before the official beta, the owner decides whether one is enough and which.
2. **The plan-comparison reference's axe violation** (`aria-required-children`, critical, on `ex.plan-comparison`). It is not a block and predates the beta, but beta users can open it in Preview. Recommended: record it in the post-beta backlog; screen-reader testers note what they hear if they open it.
3. **Who tests.** The testers' exact email addresses, which the owner adds to the Access policy for the test window.

## Results

Fill in one row per check actually run. Leave a row blank rather than estimate.

| # | Date | Tester | Device and OS (version) | Browser (version) | Assistive technology (version) | Blocks covered | Result | Findings (with block, Build or Preview, and steps) |
|---|---|---|---|---|---|---|---|---|
| M1 | | | | Safari | none | | | |
| M2 | | | | Firefox | none | | | |
| M3 | | | macOS | Safari | VoiceOver | | | |
| M4 | | | Windows | Firefox or Chrome | NVDA | | | |
| R1 | | | | | none | | | |
| R2 | | | | | none | | | |
| R3 | | | Windows | | Contrast themes | | | |

A finding blocks the beta only if it stops someone completing a core task with the keyboard or a screen reader, or falls in another of the owner's blocking classes ([RELEASE-REVIEW.md](RELEASE-REVIEW.md), "The freeze"). Everything else goes to [POST-BETA-BACKLOG.md](POST-BETA-BACKLOG.md).
