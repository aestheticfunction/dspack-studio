# M0 trust fixes

> **Revised after the independent review.** Each fix was revised on its branch ([R0-REVIEW.md](R0-REVIEW.md) §2.3 and §9 Part A), and the four ship as one combined pull request. In short: (a) a model's refinement of a replay keeps the replay's ancestry and is saved under the sample's prompt plus the applied instructions, and a replay of a sample the project already has is not saved again; (b) availability says nothing until it is known, and the smoke test no longer depends on production's hosted-AI setting; (c) every reachable view has one h1; (d) the two findings regions have distinct names, are tab stops only while they scroll, and Checks passes axe.

Four changes to the default build, each on its own branch and draft pull request, each with a regression test that fails on the parent commit (`8053151`) and passes with the fix. None is merged: a merge to `main` deploys production.

Scope note: revision 1 of the proposal said four fixes and listed five. Hash routing (the fifth) is deferred to M1, because it changes how projects open and hold view state, and the new shell rebuilds it anyway.

| | Fix | Branch | Regression evidence |
|---|---|---|---|
| (a) | **Demo replay integrity.** A scripted build names the example it replays and says it was not generated from the request; saving it records the replayed example's own prompt, named "&lt;example&gt; (demo replay)", with a description of its origin. The same selection rule is shared by the browser, the local agent and the experimental runtime. Also adds `findProbableReplays()` for existing projects (EXAMPLE-INTEGRITY.md) | `claude/m0-replay-integrity`, [aestheticfunction/dspack-studio#113](https://github.com/aestheticfunction/dspack-studio/pull/113) | New: 4 unit tests for the helpers, 5 for the detector, 1 smoke test with the hotel request. Changed deliberately (they encoded the old behaviour): the first-impression title assertion in `composer-prod-smoke.spec.ts`, and the saved-prompt assertion in `composer-build.spec.ts`. On the parent: unit tests fail (functions absent), the smoke test fails on the missing notice |
| (b) | **Rule checks are not fulfilment; availability before typing.** Every passing result says the checks confirm design-system rules, not that it does what was asked (a replay says it was replayed). When only replay is possible, the hub and Build say so before anyone types | `claude/m0-checks-not-fulfilment`, [aestheticfunction/dspack-studio#114](https://github.com/aestheticfunction/dspack-studio/pull/114) | 2 new smoke tests: a scripted-only page, and a stubbed passing hosted build with no warning. Both fail on the parent |
| (c) | **Structure.** One `h1` per working view (no visual change), `aria-current="page"` on navigation, a skip link to the content | `claude/m0-structure-a11y`, [aestheticfunction/dspack-studio#115](https://github.com/aestheticfunction/dspack-studio/pull/115) | 1 new smoke test across all eight views and the skip link. Fails on the parent ("view build": no h1) |
| (d) | **Checks at 390 px.** The findings table scrolls inside its own focusable region | `claude/m0-checks-reflow`, [aestheticfunction/dspack-studio#116](https://github.com/aestheticfunction/dspack-studio/pull/116) | 1 new smoke test. Fails on the parent: the page scrolls sideways by 25 px |

Every branch passed, locally, the full CI sequence: unit tests, type checks, the exhibit suite (106 passed, 4 environment-gated skips), and the Composer smoke, agent and experimental suites. The default catalog export test and the request goldens were not changed.

## What each fix does not do

- (a) does not touch examples already saved in anyone's project. The detector finds them; the remedy is proposed for M1.
- (b) does not turn hosted AI on (an owner decision, HOSTED-AI-AVAILABILITY.md) and does not check task fit; it says plainly that nothing does yet.
- (c) adds no new accessibility test tooling; the existing axe suites are unchanged. The manual screen-reader pass (backlog A4) is still outstanding.
- (d) fixes the one overflow found in the live audit; it is not a general responsive pass.

## Merge order

Verified in combination: see [INTEGRATION.md](INTEGRATION.md). The four fixes have no functional dependencies. Every pair conflicts only in `e2e/composer-prod-smoke.spec.ts` (adjacent new tests), and the resolution needs care. INTEGRATION.md gives the correct resolution, the combined results (all green) and a recommended order.
