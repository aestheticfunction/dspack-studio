# D0 usability script: five first-run tasks

**For:** three to five product designers who have not seen Composer. **Length:** about 20 minutes each. **Status:** ready to use; T1 and T5 updated for D0.1 (2026-11-27). **No participant has been recruited or contacted.** The product owner decides who takes part and when.

This script is for human sessions. Do not record an AI walkthrough as a session, and do not report one as a usability result. Write what you observe in [USABILITY-OBSERVATIONS.md](USABILITY-OBSERVATIONS.md), kept separate from the engineering verification in [README.md](README.md).

## Before the session

- Build and serve the experimental Library as described in [README.md](README.md#how-to-evaluate-it).
- Use a fresh browser profile, or clear the site's storage, so that the participant sees the first run.
- Desktop: a window of about 1280 × 800. Phone (task 5): a phone, or the browser's device toolbar at 390 × 844, with storage cleared again.
- Start the participant on the Projects page, not the Library. T1 tests whether the Library can be found from there, so do not point to it.
- Have the observations template open. Note times from the moment each task is read out.

## Introduction (read aloud)

> Thank you for helping. We're testing the software, not you, so there are no wrong answers. If something is confusing, that's what we need to know.
>
> Please think aloud as you go: what you're looking at, what you expect, what surprises you. I'll mostly stay quiet. If you're stuck, say so, and we'll move on; that's useful too.
>
> Everything you see uses made-up sample data. Nothing you do here sends anything anywhere.
>
> May I take notes? I won't record your name with them.

Do not explain Composer, compositions, governance or versions. If asked, answer: "What would you expect it to be?"

## Tasks (read each aloud, one at a time)

Read the task as written. Do not point at the screen. If they ask whether they're done, ask: "Are you?"

| # | Task, as read aloud | Passes when | Note especially |
|---|---|---|---|
| T1 | "Find the screen design called Hotel results, and tell me in your own words what it is for." | They reach the Hotel results composition within 30 seconds, starting from Projects, and describe its purpose: showing the hotels a search found so a person can choose one | How they get from Projects to it (the header's Library link, or the line on the Projects page); where they look first; whether they read the guide; the words they use for "composition" |
| T2 | "Show that design with only one hotel. Then tell me what happens, and why." | They choose the one-hotel example and say it is not shown because a choice of one is not a comparison (the design needs at least two options) | Whether they see the refusal as expected or as a fault; whether they find the reason without opening details |
| T3 | "Which version of this design is the approved one? And has it been published, so that an outside agent could use it?" | They name v1 as approved (v2 is a draft), and they say it has **not** been published: publishing is not available yet | Whether they confuse **passing checks**, **approved** and **published**; where they find the answer |
| T4 | "Find out what would happen if a person pressed the button to choose one of the hotels." | They press a choose button, find the preview note, and say what it would send and that nothing actually runs | Whether they notice the note; whether "preview only" is believed |
| T5 | (On a phone, storage cleared, starting on Projects.) "Do the first task again on this phone." | They reach Hotel results and describe it, and they see the design itself without opening a panel to find it | Whether "New here? Try the guide" is noticed; whether the sideways-scrolling examples are found |

## After the tasks (ask, in this order)

1. "In a sentence, what is this tool for?"
2. "What was the most confusing moment?"
3. "Was there anything you expected to be able to do, but couldn't?"
4. "When something wasn't shown, did it feel like an error, or like information?"
5. "If you came back tomorrow, what would you want to do first?"

## Close

> That's everything. Thank you. Is there anything you'd like to add?

Do not show or explain features they missed until the notes are complete.

## For the facilitator: what each task tests

| Task | The proposal's question |
|---|---|
| T1 | What am I designing? (first-run guidance, the list, the Design tab) |
| T2 | How does it behave with different data, and does it satisfy the design rules? (examples, expected refusals) |
| T3 | What is the state of this version? (checks pass, approved and published, kept distinct) |
| T4 | What can a person do with it? (action feedback, preview only) |
| T5 | Does all this hold on a phone? (layout targets, the guide strip) |
