# Authoring walkthrough: draft to approved version

**For:** product designers, after (or alongside) the first-run sessions in [../d0/USABILITY-SCRIPT.md](../d0/USABILITY-SCRIPT.md). **Length:** about 15 minutes. **Status:** ready to use. **No session has taken place, and no participant has been recruited or contacted.** The product owner decides who takes part and when.

This walkthrough is for human sessions. Results go in the observations table below, kept apart from the automated browser tests (`e2e/composer-authoring.spec.ts`) and from any AI assessment. Neither of those is a usability result.

## Before the session

- Build and serve the experimental Library ([README.md](README.md#how-to-evaluate-it)). Use a fresh browser profile, so no drafts exist yet.
- Use a window of about 1280 × 800, starting in the Library on **Hotel search**.
- Do not explain drafts, checks or approval. If asked, answer: "What would you expect?"

## Tasks (read each aloud)

| # | Task, as read aloud | Passes when | Note especially |
|---|---|---|---|
| W1 | "Hotel search is approved. Make a version you can change, without changing the approved one." | They choose **Create draft** and say the approved version is unchanged | Whether "draft" is understood; whether they find the editors in the inspector |
| W2 | "Change the example called 'A search with an error' so that its error message is empty." | They open **Examples**, choose the example, and clear the message | Whether the form is understood without JSON; what they make of the warning before the checks |
| W3 | "Find out whether this version still behaves as it should, and if not, what is wrong." | They run the checks and explain, in their words, that the error message is empty | Whether **Run checks** is found; whether the failure explanation is enough |
| W4 | "Put it right, and check again." | They restore a message (any text) and the checks pass | Whether **Edit this example** is used; whether the "not checked" state is noticed |
| W5 | "Approve this version. Before you do, tell me what approving it will mean." | They read the confirmation and approve. They mention that it can no longer change, that v1 stays, that it is this device only, and that it is not published | Whether they confuse approval with publication; whether they read the confirmation |
| W6 | (Reload the page.) "Show me that the version you approved is still here." | They find **v2 Approved** and the inspector's "Approved on this device" | Whether "on this device" is noticed or questioned |

## After the tasks

1. "What is the difference between passing the checks and approving a version?"
2. "What would you expect to be able to change that you could not?"
3. "Was anything you did irreversible? How did you know?"

## Observations (to be filled in by the facilitator)

| Code | Task | Outcome (pass, pass with help, not completed) | What happened | Quote |
|---|---|---|---|---|
| | | | | |
