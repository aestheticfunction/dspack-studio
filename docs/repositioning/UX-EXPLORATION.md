# Workspace explorations: conversation-led, canvas-led, flow-led

**Status:** M0 design exploration, 2026-11-25. Accepted direction for prototyping (decision D10); not a final UI specification.

**The prototype:** a private artifact, https://claude.ai/artifact/TxXcGqEmgEV2CGPY4Yz2b1 (only the owner and people they share it with can open it). Source: `docs/repositioning/prototypes/composer-explorations.html`, one self-contained page outside the product build. Each approach and moment has its own address (`#a-onboard` … `#c-publish`).

## What was built

Three approaches, each walked through the same five moments for the hotel reservation request on Astryx:

| Moment | What it shows |
|---|---|
| 1. First run | The starting question, the design-system choice, suggested starts, and the "AI generation is not available here" notice (trust fix b) before anything is typed |
| 2. Author | The generated result: five stages, three reused from the library, two new |
| 3. Refine | One change ("limit guests to 1 to 8") and where it lands |
| 4. Test | A working Playground with a simulated agent: search, invalid dates, loading, no availability, choosing a hotel and room, back without losing the query, review, a booking failure and retry, an agent price change, and an agent update the rules refuse. Timeline, task state and message views |
| 5. Publish | The checks, what the package contains, and the honest warnings (A2UI 1.0 not yet supported; dates are text fields) |

The Playground and Publish moments are shared by all three approaches: they differ only in how you arrive. That is itself a finding: the interaction model below the authoring workspace does not depend on which approach is chosen.

All three keep Compose, Library, Playground and Publish as the top-level experiences, with Design system visible in the navigation and validation as a status chip.

## How each approach did against the criteria

Judged by walking the prototype. This is a design review by one person, not a usability study; M4 tests with first-time users.

| Criterion | A. Conversation-led | B. Canvas-led | C. Flow-led |
|---|---|---|---|
| A first-time user knows what to do next without protocol terms | **Strongest.** One question, then a plan in plain words | Weakest. "Add a composition or component" asks a newcomer to know the parts first | Good for a journey; odd for a single screen |
| Editing, previewing and simulating are clearly different | Clear: Compose and Playground are separate places | Clear | Clear |
| Data, actions and states are found where they apply | Weak. The inspector carries them, but attention is on the chat | **Strongest.** Select the Search button and see what it sends and where it leads | Good per stage (reads, sends); weak per element |
| A rule finding appears where it occurs, plainly | Reported in the conversation, away from the element | **On the element** (Rules tab) | On the stage node (✓ rules) |
| Keyboard, reading order, 320 px | All three reflow to one column at phone width with no sideways scroll; element selection on the canvas is keyboard-operable | | |
| Holds up for Convert Estimate to Project (corpus prompt 5) | Fine: the plan lists review, confirm, read-back | Scattered: four canvases with no view of what carries between them | **Strongest.** Inherited versus supplied data, the confirmation boundary and the read-back are visible as the journey |

What each approach is missing is exactly what another one has:

- A needs B's element-level view of data, actions and rules.
- B needs A's entry point and C's view of the journey.
- C needs A's entry point and B's element editing inside a stage.

## Recommendation

**One workspace with three coordinated views, not three modes.** A project is one document. The conversation, the journey outline and the canvas with its inspector are views of that document. The entry point decides which is prominent, and nothing is lost by moving between them.

| You start from | Prominent | Also present |
|---|---|---|
| A request (default for new projects) | Conversation, then the plan | Outline strip above the canvas; inspector on selection |
| A composition in the Library | Canvas and inspector | Conversation as a side panel ("Ask") |
| A multi-step request, or a flow in the Library | Journey outline | Canvas of the selected stage; conversation in a drawer |

Concretely, for M1 and M4:

1. Make the **conversation-led first run** the default (A's moment 1), with the availability notice.
2. Make the **outline strip** (A and B's row of stage buttons) always present when a composition belongs to a flow, and let it expand into C's journey map, with branches and task state, in place.
3. Make the **canvas inspector** (B) the one place where content, data, actions and rules are edited for a selected element, whichever view you came from.
4. Keep **Playground and Publish** as shared destinations, entered from any view.

## Still unresolved

- Whether a single composition should ever show the journey map, or only the strip.
- How a refinement made in the conversation is shown on the canvas (the prototype highlights the change; a real diff view is needed).
- How the inspector reads when a model proposes wiring (M1's wiring step): accept and reject per binding, or as a whole.
- None of this has been tried with first-time users. M4's sessions are the test; the criteria above are what they should measure.

## Limits of the prototype

Everything is mocked: no model, no data leaves the page, and the agent is simulated by a short script. Visual polish was deliberately limited to the product's existing identity so that the comparison is about the interaction model.
