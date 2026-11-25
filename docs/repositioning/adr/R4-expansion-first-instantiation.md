# R4. Every instance is a governed expansion; bindings only where the rules cannot see

**Status:** draft for review. Accepted by the owner as D4 (2026-11-24), with the condition that later data updates cannot get around governance.

## Context

The obvious design (a fixed component tree plus a data model the agent fills) fails two ways in this codebase:

1. dspack-emit types every mapped design-system property as a static value; only a mapping's structural slots are dynamic. On Astryx that leaves `Text.text`, `TextField.value`, `Dialog.title`, child lists and actions bindable. Labels, badges, metadata and table data are not.
2. Design-system rules are judged on literal surfaces. A data-bound list could pass with two literal children and render one at run time; a loading state cannot pass under its ready state's purpose. Binding first would move correctness outside governance.

PROTOCOL.md adds a third: bindings are written differently in final A2UI 1.0 (`@path`), so bound values are verified for 0.9.1 only until upstream emits 1.0.

## Decision

- **An instance is an expansion.** `expand(template, parameters, state, data)` gives a `dspackSurface` 0.1; S1 to S3 run on it under the purpose its state names; dspack-emit emits it; A1 to A3 run. Data that breaks a rule is refused with the rule's rationale.
- **Bind only where it is safe.** Entered values, payload references and text marked volatile become bindings, found by tracing markers through the real emitter. A binding is allowed only on a property the catalog types as dynamic and that no applicable rule reads. Check I0: the bound messages, resolved against the data, equal the plain expansion.
- **After the first render** (the owner's condition), the runtime accepts two kinds of change only: a typed, in-bounds write to a bound path, or a re-instantiation that passes S1 to S3. Anything else is refused, the previous surface stays, and the refusal is shown with its reason.

## Required negative tests (M1 and M2)

Each must be refused, with the previous surface kept and the reason shown:

- binding a property a rule reads (an alert-dialog action label; text under a required-text rule);
- a write to a path outside the bound set;
- a write of the wrong type, or outside declared bounds;
- data that takes a list below a rule's minimum;
- a state change whose instance fails under its purpose;
- a bound list resized outside its bounds;
- a data value shaped like an action event;
- a sensitive field in a payload;
- at every step of every recorded Playground walk, the rendered surface equals a governed expansion of the data at that moment.

## Consequences

- "Different data, same composition, no hardcoded content" is met by one definition and many governed instances, not by one frozen tree.
- An agent re-instantiates on each data change (a pure function, no model call) and needs the expander at run time, through ds-mcp or a library.
- How much can be bound grows only when dspack-emit makes more properties dynamic (a Track 2 item), with no change to compositions.
- Limit: Composer cannot stop a third-party agent sending arbitrary messages to its own host. The package gives that agent the same instantiate and validate functions and says which paths may be written directly.
