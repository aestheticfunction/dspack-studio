# Combined verification of #113 to #117

**Status:** R0 close-out, 2026-11-25. All five pull requests were merged together on a **local, temporary** branch (`m0-integration`, not pushed) and the full CI sequence was run on the result. Nothing was merged to `main`, pushed or deployed.

## What was combined

| PR | Branch | Head verified | Base |
|---|---|---|---|
| [#117](https://github.com/aestheticfunction/dspack-studio/pull/117) Documents, baseline, corpus pin | `claude/vibrant-shannon-v2fuf0` | `135ba2e` | `main` `8053151` |
| [#116](https://github.com/aestheticfunction/dspack-studio/pull/116) Checks at 390 px | `claude/m0-checks-reflow` | `942e7c2` | `8053151` |
| [#115](https://github.com/aestheticfunction/dspack-studio/pull/115) Headings, current page, skip link | `claude/m0-structure-a11y` | `1620c35` | `8053151` |
| [#113](https://github.com/aestheticfunction/dspack-studio/pull/113) Demo replay integrity, detector | `claude/m0-replay-integrity` | `5aa3280` | `8053151` |
| [#114](https://github.com/aestheticfunction/dspack-studio/pull/114) Checks are not fulfilment; availability | `claude/m0-checks-not-fulfilment` | `d38c174` | `8053151` |

Integration head: `8ae3689` (local). This document was added to #117 afterwards. It changes no code, so the results below still hold for #117 with it.

## Dependencies

**None functional.** Each PR builds and passes on its own against `main`, and none uses code from another:

- #114's `generationAvailability` does not depend on #113's `replayOf`.
- #115's heading change and #114's availability notice sit next to each other in Build, and merge cleanly.
- #117 adds documents and one test, and touches no file the others touch.

## Conflicts

Every pair was tested with `git merge-tree`:

| | #113 | #114 | #115 | #116 | #117 |
|---|---|---|---|---|---|
| **#113** | | smoke spec | smoke spec | smoke spec | clean |
| **#114** | | | smoke spec | smoke spec | clean |
| **#115** | | | | smoke spec | clean |
| **#116** | | | | | clean |

**The only conflict is in `e2e/composer-prod-smoke.spec.ts`, and it happens between every pair of fix PRs.**

- Each fix added its new test immediately before the same existing test ("Examples are teaching material…").
- Application code never conflicts. `build-view.tsx` and `state.tsx`, shared by #113, #114 and #115, merge automatically.

**How to resolve it correctly** (learned the hard way during this verification): keep both added tests, and give each its own closing `});`.

- Git treats the final `});` of the two added tests as common to both sides and leaves it once, after the conflict markers.
- Resolving by simply keeping both sides therefore leaves the first test unclosed. The file stops parsing, and Playwright fails before running any test.
- My first combined run hit exactly this. It was caught because the smoke suite failed to start, and the branch was rebuilt with the corrected resolution.

**Check after resolving:** the file should have 27 tests (22 on `main` plus 5 new), and the smoke suite should report 44 passed.

## Combined regression results

Full CI sequence at `8ae3689`, same environment as BASELINE.md:

| Step | `main` (BASELINE.md) | Combined |
|---|---|---|
| Catalog gates, contract sync, drift check | pass | pass |
| Unit tests | 1,366 | **1,377** (+11: 9 from #113, 2 from #117) |
| Type checks | pass | pass |
| Exhibit e2e | 106 passed, 4 skipped | **106 passed, 4 skipped** |
| Composer smoke e2e | 39 | **44** (+5 new tests) |
| Composer agent e2e | 49 | **49** |
| Composer experimental e2e | 57 | **57** |

- No failures and no flaky tests.
- The default catalog export test, the request goldens and the corpus pin all pass.

The smoke count is 39 + 5 = 44: #113 adds 1, #114 adds 2, #115 adds 1, #116 adds 1. #113 also changes two existing assertions deliberately (see the PR).

## Observations from the combined result

1. **Redundant copy for a scripted result.** With #113 and #114 together, a demo replay says "not generated from your request" twice: in #113's notice above the checks, and in #114's line below them. Both are accurate. Suggested follow-up, after both merge: when a turn has `replayOf`, #114's line keeps only its first sentence ("These checks confirm a saved surface follows your design system."). This is not changed now, because R0 is verification only.
2. **No other interaction found.** #115's `h1` and #114's availability notice render in the right order in Build. #116's scroll region does not affect #115's heading checks.

## Recommended merge order

1. **#117 first.** Documents and a test only. It conflicts with nothing, and it puts the corpus pin in place before any other change lands.
2. **The fixes as one combined change, if a single production deploy is preferred.** Every merge to `main` redeploys production through Workers Builds. Merging #113 to #116 separately means four deploys and three conflict resolutions in the same file. The alternative is one integration pull request with exactly the content verified here: one deploy and one CI run. The individual PRs stay open for review and are closed as superseded.
3. **If merged separately: #113, #114, #115, #116.** Trust impact comes first: #113 stops new mis-attributed examples, and #114 states what the checks mean. #115 and #116 are structural and independent. Each PR after the first needs the smoke-spec resolution above, which can be done by rebasing the PR branch onto `main` after each merge.

Either way, re-run the smoke suite after each resolution and expect the count to rise by exactly the number of tests the PR adds.

## Reproduce

```bash
git checkout -B m0-integration origin/main
```

```bash
for b in claude/vibrant-shannon-v2fuf0 claude/m0-checks-reflow claude/m0-structure-a11y claude/m0-replay-integrity claude/m0-checks-not-fulfilment; do git merge --no-ff --no-edit "origin/$b" || break; done
```

At each conflict, resolve as described above, `git add e2e/composer-prod-smoke.spec.ts`, commit, and continue the loop from the next branch. Then run the CI steps listed in BASELINE.md.
