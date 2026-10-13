# Zero-cost production baseline after aestheticfunction/dspack-studio#101

This branch holds the zero-cost production baseline of main `eaf6ae359d8bda171daae6e072042ba24e514c7b`. It was captured after the deployment of aestheticfunction/dspack-studio#101, in which the Worker reads a gateway 429 from the HTTP status the AI binding records.
- **It is never merged.** A commit to main redeploys the composer and changes the build id a run is held to.
- **No run is authorized by it.** Astryx stage 3 is closed. A shadcn/ui v3 run, or any other paid or local run, needs the owner's authorization.

- `1b.baseline-eaf6ae3.json`: the record `pnpm --filter @dspack-studio/block-bench baseline` wrote, unedited.
  - **Build id** `w6ajVrX5g8V0WhqowIBGN`, first served at 2026-10-13 12:41:41Z (polled every 30 s), about 3 minutes after the merge at 12:38:23Z. The build served before it was `txDlHURTKv_S6yicLso97`.
  - **Worker:** `per-call-model`, refusing the empty probe with 400 and `calls: []`.
  - **Models:** `scripted` and `hosted-ai`.
  - **Sidecars:** both approved, and all three blocks usable on both references.
  - **No model call.** Its four requests are the Worker's refusal of an empty body, the page, that build's manifest and the model list.
- `1b.baseline-eaf6ae3.capture.txt`: the command's console output, with its start, end and exit code.
- `SHA256SUMS`: run `sha256sum -c SHA256SUMS` from this directory.

Against the 3aae0ea baseline (`claude/blocks-stage3-astryx-evidence`), only `at` and `buildId` differ.

**Unchanged since the Astryx run:**
- the harness's code identity, `fe2b8e841d49778793efb9b640e2e2ae3a54048a5c4e540339aaa976ad2cc86d`, with dspack-gen 0.5.0 and dspack-emit 0.7.0;
- corpus `blocks-1b` v2, `0e4e4706e19ec92565fea2019258cd5d83f6bef0eca424a0634ccf4749b61ae9`;
- the request bytes: the pinned request hashes pass at this commit (the squash's tree equals the reviewed head `a862f5c`).

The pull request changed the Worker (`apps/composer/worker/propose.mjs`), its tests, one harness test file and a paragraph of `docs/deployment.md`. The harness's identity covers none of them.
