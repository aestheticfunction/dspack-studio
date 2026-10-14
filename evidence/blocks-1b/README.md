# Zero-cost production baseline after aestheticfunction/dspack-studio#102

This branch holds the zero-cost production baseline of main `7e260c38029ab0a1df1fc499733ed037c06d60db`. It was captured after the deployment of aestheticfunction/dspack-studio#102, the measurement-readiness change:
- parity reads strings in arrays;
- amendment 2 is recorded as adopted;
- the busy-refusal documentation is precise.

The baseline's status:
- **It is never merged.** A commit to main redeploys the composer and changes the build id a run is held to.
- **No documentation-only deployment follows it.**
- **No run is authorized by it.** A shadcn/ui v3 run, or any other paid or local run, needs the owner's authorization.

## Files

- `1b.baseline-7e260c3.json`: the record `pnpm --filter @dspack-studio/block-bench baseline` wrote, unedited.
  - **Build id** `Dyml8RSqfWynKU1KbVuZI`, first seen at 2026-10-14 03:14:13Z, about 6 minutes after the merge at 03:08:28Z. The build served at 03:08:21Z, just before the merge, was `w6ajVrX5g8V0WhqowIBGN`. No other commit reached main in between.
  - **Main's CI on `7e260c3` passed:** run 38504702977, finished at 03:16:53Z. The baseline was taken after it, at 03:17:05Z.
  - **Worker:** `per-call-model`, refusing the empty probe with 400 and `calls: []`.
  - **Models:** `scripted` and `hosted-ai`.
  - **Sidecars:** both approved, and all three blocks usable on both references.
  - **No model call.** Its four requests are the Worker's refusal of an empty body, the page, that build's manifest and the model list.
- `1b.baseline-7e260c3.capture.txt`: the command's console output, with its start, end and exit code.
- `SHA256SUMS`: run `sha256sum -c SHA256SUMS` from this directory.

Against the `eaf6ae3` baseline (`claude/blocks-baseline-eaf6ae3-evidence`), only `at` and `buildId` differ.

## What a shadcn/ui v3 run would record

- **Code identity:** `51c80cec7a652216c3b9b28b1467e8c45eb0ecebe170969854bb1d49d3c8a229`, with dspack-gen 0.5.0 and dspack-emit 0.7.0.
  - `live/parity.ts` changed in this pull request, so the identity is not the Astryx run's `fe2b8e84…cc86d`.
  - It is the only file in the identity's roots that changed.
- **Corpus:** `blocks-1b` v2, `0e4e4706e19ec92565fea2019258cd5d83f6bef0eca424a0634ccf4749b61ae9`, unchanged.
- **Request bytes:** unchanged. The squash's tree equals the reviewed head `51cf86e`, where:
  - block-bench's 268 tests pass, its pinned request hashes among them;
  - composer's 280 pass, the Worker's pinned sha256 of `env.AI.run`'s arguments among them.

**Unchanged since the previous baseline:** the Worker, the app, the sidecars, composer-core and the bench's `src`.
