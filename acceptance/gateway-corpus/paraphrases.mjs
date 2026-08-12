// Paraphrase-generalization corpus — REWORDED versions of representative prompts
// (owner requirement: prove improvements generalize beyond the exact corpus strings).
// Same functional demands, deliberately different vocabulary, structure, and phrasing.
// Mapping: P1↔corpus#1 (dependent selection), P2↔corpus#6 (multi-step create),
// P3↔corpus#7 (detail workspace + disclosure), P4↔corpus#9 (operation progress).

export const CORPUS = [
  {
    n: 1,
    title: "Offering picker (paraphrase of #1)",
    tool: "get_service_catalog",
    body: `Build a screen where a client assembles an intellectual-property service request.
The top control picks the offering (shown with friendly names, not codes). Once an offering is chosen, a second control lists only the process variants that belong to it.
Underneath, lay out the rest of the request options — country coverage, original language, target market, and quality tier — as a tidy form. Options that can't be used right now should stay on screen but read as inactive, and any explanatory notes should appear as inline help.
Keep a small running recap of everything picked so far, so the person always knows the current shape of their request.
It should read like step one of ordering professional services, not like an app's preferences page.`,
  },
  {
    n: 2,
    title: "Engagement setup (paraphrase of #6)",
    tool: "create_project",
    body: `A start-to-finish screen for opening a new services engagement without a prior quote.
Lead with choosing the offering and its process variant, then collect the engagement's own details.
Split the inputs into digestible groups — offering setup, engagement basics, who it's for, countries and languages, and dates or delivery expectations, whenever those apply.
Before anything is sent, present a short recap of exactly what will be opened.
Ask for a deliberate go-ahead, explaining a sandbox engagement will be opened and that re-submitting on uncertainty is unsafe.
When it succeeds, land the person on the engagement's own page with its number and state shown large.
One unbroken thread: choose → fill in → recap → approve → open → inspect what was opened.`,
  },
  {
    n: 3,
    title: "Matter overview page (paraphrase of #7)",
    tool: "get_project",
    body: `The main page someone keeps open to track a professional-services matter.
A strong top band: the matter's number, where it stands, which offering and process it uses, and the client facts that matter most.
Then well-labeled regions: a summary, the offering and country specifics, key dates, the billable line entries, any files, and a catch-all for everything else.
The line entries deserve the most room — a clean grid listing each entry's service, output language, country, state, and count.
Keep machine-ish extension payloads out of the main page; if some of it helps, tuck it behind an expandable "More details" area.
Cautions should be easy to spot but never louder than the matter itself.
When there's an obvious next move, offer it right on the page.`,
  },
  {
    n: 4,
    title: "Long job tracker (paraphrase of #9)",
    tool: null,
    body: `A tracker for a slow back-office job.
Name the thing being worked on, the job's present phase, and how long it has been since the job was accepted.
If the service suggests when to check again, say when that next check happens. Mention any expected callback events quietly, as side information.
Never fabricate a percent-done figure when none was provided — show an open-ended in-progress treatment instead.
Give each phase its own unmistakable look: working, working through files, waiting, ran out of time, went wrong, finished.
Running out of time must not look like the job failing on its merits.
If the service recommends what to do next, make that recommendation prominent under the phase display.
It should feel like following a genuine piece of work, not staring at a spinner.`,
  },
];
