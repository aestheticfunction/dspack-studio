# Scripted example integrity

**Status:** M0 investigation, 2026-11-25. Nothing in any user's project was changed, removed or rewritten. The detector is code with tests; the remedy is a proposal.

## The defect

Before trust fix (a), a scripted ("demo replay") build played the last saved example of the inferred purpose, whatever was typed, and "Add to project" saved it with:

- `name`: the first 80 characters of the typed request;
- `prompt`: the typed request (plus any refinements);
- `surface`: the replayed example's surface, unchanged (or with "(refined)" appended to one text, for a scripted refinement).

dspack-gen uses same-purpose examples verbatim as few-shot context, with `prompt ?? description ?? id` as the example's user turn (`dspack-gen/src/core/compiler.ts:87`). So a mis-attributed example teaches later generations that the typed request is answered by an unrelated surface. On the live site the hotel request became a saved pricing card.

Fix (a) stops new cases (`claude/m0-replay-integrity`). This document covers existing ones.

## Where incorrectly attributed examples could exist

| Place | Can we see it? | Finding |
|---|---|---|
| Packaged contracts and sample projects in this repository (Astryx, shadcn/ui v3, shadcn/ui 2.3.0, the demo project, composer-core fixtures) | Yes | **Clean.** 24 example entries in five distinct contracts (20 distinct ids: the sample projects copy `packages/contracts`); every prompt describes its own surface; no two examples share a surface; no `ex.chat-*` (chat-accepted) examples ship |
| Replay fixtures (`packages/replay/fixtures`) | Yes | **Clean.** 14 live recordings with their real prompts; the two scripted fixtures (007, 008) are labelled `mode: "scripted"` with descriptive prompts |
| Browser projects (localStorage on each visitor's machine) | No | Unknown. Any project where someone accepted a scripted build carries the defect. Since 2026-10-18 production has offered only scripted in the browser, so an acceptance there used a replay unless the visitor ran the local bridge with their own model |
| Exported `.composerproject.json` files | Only if someone shares one | Same as above |
| Repository projects saved through the local agent | Only on the owner's disk | Same, for scripted acceptances |

No user data was accessed. The scale of the problem in the wild is unknown and cannot be measured from here.

## Detection

A deterministic rule, with no model and no heuristics about wording:

> An example authored in the project (not part of the packaged reference) is a **probable replay** when its surface, after removing scripted-refinement markers (` (refined)`, ` (refined N)`), is byte-identical in canonical JSON to the surface of an **earlier** example with the same purpose, and its prompt differs from that example's prompt.

- Examples saved after fix (a) carry `description: "Saved from a demo replay of <id>…"` and the source's prompt; they are **labelled replays**, reported separately and never flagged.
- A generated surface that happens to equal an existing example (a model can reproduce a few-shot example exactly) is also flagged. That is the right outcome: it is still a duplicate under a different request, and the person decides.
- False negatives: a replay whose source example was later deleted cannot be matched. Rare, and the remedy is the same as for any unflagged example.

Implemented as `findProbableReplays()` in `packages/composer-core/src/build.ts` on `claude/m0-replay-integrity`, with unit tests: it flags a constructed replay, flags a scripted-refined replay, does not flag the packaged examples, and does not flag a labelled replay. It is not yet wired into the product. After the independent review it was tightened: only the marker scripted mode appends is stripped, a marked top-level id is ignored, and an entry is flagged only if it carries Build's accept signature (an `ex.chat-N` id, or a prompt that begins with its name), so an author's deliberate paraphrase example is not flagged.

## Proposed remedy (not shipped in M0)

On opening a project, run the detector. If anything is flagged, show one notice:

> 2 saved surfaces look like demo replays saved under a different request. Review them.

For each flagged example, offer three choices, and change nothing until the person chooses:

| Choice | Effect |
|---|---|
| Keep as is | Records the decision (`x-composer-reviewed`) so the notice does not return |
| Restore its source | Sets `name` to "&lt;source&gt; (demo replay)", `prompt` to the source's prompt, and adds the origin description; the surface is untouched |
| Leave out of generation | Marks it `x-composer-exclude-from-context`; Composer removes marked examples from the contract it passes to generation. The surface stays in the project and in Preview |

Properties: nothing is deleted; nothing changes without a click; every change is a normal, undoable project save; packaged references are never touched (they are not authored examples). The `x-` keys are allowed by the dspack spec and ignored by other consumers.

For repository projects the same review runs in the browser and saves through the agent's existing guarded write.

Decision needed (M1 scope): whether to ship this review, and whether "Leave out of generation" should be the default suggestion.
