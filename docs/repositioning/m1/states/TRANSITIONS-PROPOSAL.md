# Proposal: declaring intended next states (for approval; not implemented)

## The limitation

In the 0.2 composition schema an action declares four things:
- the states it is **sent from** (`actions[].states`);
- what it sends (`payload`, `carries`);
- whether it is **consequential** (confirmed once, from one state);
- for a repeat, its item.

Nothing declares **where it leads**. The next screen is chosen by the data the agent returns: the first state whose condition holds (`expand.ts selectState`). This is deliberate. The composition never moves itself, and the agent and host stay in charge of execution.

So a designer cannot currently write down "Choose leads to Confirm", and a check cannot verify it.

## The smallest compatible extension

One optional field on an action:

```jsonc
{ "name": "choose", "node": "choose", "states": ["ready"],
  "leadsTo": ["confirm"] }   // intended next states: designer intent, never executed
```

**Load-time checks:**
- every `leadsTo` names a state of the composition;
- a consequential action's `leadsTo` excludes its own confirmation state.

**Semantics, stated for the agent and host:**
- `leadsTo` is **intent, not control**.
- The host still chooses the next state from the data. It never moves to a `leadsTo` state, and never refuses data that leads elsewhere.

**Checks it enables, optional, at check time:** for each declared `leadsTo`, at least one example exists whose data makes that state the chosen one, so the intended screen is known to be reachable.

**In the workspace:**
- "What actions do" gains a **Leads to** row with checkboxes among the states.
- Structure's state selector can show "reached from Choose".

**State titles and descriptions:** an optional `title` (≤ 60 characters) and `description` (≤ 240 characters) on a state, as the schema already allows for examples, would let designers name states in words. Today the id is the name and the purpose the description.

## What it is not

- It is not a workflow engine or an execution path. It carries no conditions or code, and it is not used at runtime.
- It does not change any existing definition, golden or contract digest. Absent fields mean what they mean today.

## The decision needed

Approve or decline:
- `leadsTo` (intent only, as above);
- optional state `title` and `description`.

Until then, transitions are expressed as they are today: by conditions over data, the states an action is sent from, and confirmation states.
