# The Gateway acceptance corpus

Twelve prompts describing a real enterprise workflow product — an IP-services Gateway: service configuration, entity directories, estimates, estimate→project conversion, project workspaces, confirmation boundaries, operation progress, artifact cards, error recovery, and one end-to-end lifecycle.

**This is the honest measuring stick for "can Composer build real enterprise software?"** It is not a demo script and not a unit-test fixture. It was written by the product owner as an acceptance suite before the product could satisfy any of it, and it has driven four milestones of measured improvement since.

## Rules

1. **The prompts are immutable.** Do not rewrite, simplify, shorten, or "fix" them. Their awkward parts are the point — real requests are not tidy. If a prompt cannot be satisfied, that is a finding about the product, never a reason to edit the corpus.
2. **The goal text is exactly the body of each prompt.** Titles, tool names, and the author's side-notes are metadata and are never pasted into the product.
3. **New prompts are additions, never replacements.** Preserve the original twelve and their numbering.
4. **Do not use the corpus to justify new vocabulary on its own.** A gap it reveals is evidence for a decision, not the decision.

## What is here

| File | What it is |
|---|---|
| `corpus.mjs` | The twelve prompts verbatim, with their metadata |
| `EXPECTED.md` | The current per-prompt classification, with the first blocker and which layer owns it |
| `harness.mjs` | A reproducible runner: drives the real pipeline per prompt × design system and writes one evidence file per cell |
| `paraphrases.mjs` | Reworded versions of four prompts, used to prove an improvement generalized beyond the exact strings |

## Running it

The harness makes **live model calls** through the hosted gateway (or a local model). It is therefore **not part of CI** and never should be: it costs real inference, it is nondeterministic, and a red result usually means "the model had a bad day," which is not a signal CI can act on.

```bash
node acceptance/gateway-corpus/harness.mjs all
```

Evidence lands in `acceptance/gateway-corpus/evidence/` (git-ignored), one JSON file per prompt × design system, containing the plan, every generation attempt with its gate results, the emitted output, raw validator findings, and renderer coverage.

Practical notes learned the hard way:

- **Run it sequentially and paced.** After a few hundred calls in a day the shared provider begins refusing build-paced traffic while still answering slow probes; bursts make cells fail with adapter errors that say nothing about the product. The harness paces itself and retries, and it is resumable — existing evidence files are skipped.
- **Generation is stochastic.** One sample per cell is what a user experiences; two or three samples are what a *conclusion* needs. Composition-heavy prompts flip between runs.
- **An adapter failure is not a product result.** Discard and re-measure those cells rather than reporting them.

## Provenance

Delivered by the product owner on 2026-08-10 with the instruction: *"Treat these prompts as immutable acceptance tests. Do not rewrite them. Do not simplify them. Investigate why they succeed or fail."* The corpus has since been the acceptance basis for the pipeline-trust, generation-quality, and flow-composition milestones.
