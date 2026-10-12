# Phase 1B stage 3, Astryx only, on corpus v2: run evidence

This branch keeps the evidence of the Astryx-only stage-3 run on corpus v2. It is never merged: a commit to main redeploys the composer and changes the build id a run is held to.

**So far it holds only the zero-cost production baseline** of main `3aae0eac8495044e7a4de57b1c1bf3a3d59836fe` (aestheticfunction/dspack-studio#100, ADR-B3 amendment 2, adopted by the owner on 2026-10-12). It was captured after that commit's deployment went live. The stage-3 run has not been authorized or started. When it runs, its directory, invocation logs and checksums join this directory.

- `1b-stage3-astryx.baseline-3aae0ea.json`: the record `pnpm --filter @dspack-studio/block-bench baseline` wrote, unedited.
  - **Build id** `txDlHURTKv_S6yicLso97`, first served at 22:26:03Z, about two minutes after the merge. The build served before it was `pPKuI9dQZM9F3iAU_hdnn`.
  - **Worker:** `per-call-model`, refusing the empty probe with 400 and `calls: []`.
  - **Models:** `scripted` and `hosted-ai`.
  - **Sidecars:** both approved, and all three blocks usable on both references.
  - **No model call.** Its four requests are the Worker's refusal of an empty body, the page, that build's manifest and the model list.
- `1b-stage3-astryx.baseline-3aae0ea.capture.txt`: the command's console output, with its start, end and exit code.
- `SHA256SUMS`: run `sha256sum -c SHA256SUMS` from this directory.

Against the 03c9465 baseline (`claude/blocks-smoke-option-b-evidence`), only `at` and `buildId` differ.

**The run this baseline is for.** It is the owner's to authorize, and it has not been run.
- **Corpus:** `blocks-1b` v2, sha256 `0e4e4706e19ec92565fea2019258cd5d83f6bef0eca424a0634ccf4749b61ae9`, scoring binding.
- **Code identity:** `fe2b8e841d49778793efb9b640e2e2ae3a54048a5c4e540339aaa976ad2cc86d`.
- **Scope:** Astryx only, the 24 stage-3 prompts, 480 cells.
- **Caps:** `--max-total-usd 17 --max-total-requests 1150 --max-requests 825 --spacing-ms 12000`.

Corpus v1 (`180f4480…4231`) and both earlier smokes stay systems evidence only. They are preserved on `claude/blocks-smoke-c154548-evidence` and `claude/blocks-smoke-option-b-evidence`.
