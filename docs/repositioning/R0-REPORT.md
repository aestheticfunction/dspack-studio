# Review R0: Milestone 0 report

**Date:** 2026-11-25. **Scope:** M0 as authorized on 2026-11-24. **Work stops here until M1 is explicitly authorized.**

Every statement below is marked **verified** (checked by running something or reading the live system) or **assumed** (reasoning or documents, not checked). Nothing was merged or deployed; no production setting, credential, Access rule or gateway setting was changed; no sibling repository was touched; no paid inference was run.

## 1. Repository baseline and verification

**Verified.** Every CI step was run twice at `8053151`, and both runs were green:

| Suite | Result |
|---|---|
| Unit tests | 1,366 passed (1,368 in the second run, with the 2 new corpus-pin tests) |
| Type checks | pass |
| Exhibit end-to-end | 106 passed, 4 environment-gated skips |
| Composer smoke | 39 passed |
| Composer agent | 49 passed |
| Composer experimental | 57 passed |

No flakes occurred in either run. Details are in [BASELINE.md](BASELINE.md).

The twelve Gateway prompts and their paraphrases are now pinned by hash in a test. Existing evaluation evidence is untouched.

## 2. Updated decision register

Recorded in [DECISIONS.md](DECISIONS.md):
- D1 to D16 with the owner's conditions;
- the two execution choices made during M0;
- six decisions now needed (section 10 below).

ADR drafts R1 to R4 are in [adr/](adr/).

## 3. Hosted AI availability

**Verified** (read-only Cloudflare API and public probes; [HOSTED-AI-AVAILABILITY.md](HOSTED-AI-AVAILABILITY.md)):
- **The cause** is the `HOSTED_AI` kill switch, set to `off` in the Worker's dashboard variables at 2026-10-18 01:44 UTC. That was 36 minutes before #112 merged.
- **It persists** because `keep_vars` carries it into every later version.
- **Nothing else is broken.** The `AI` binding is present.
- **This matches the release plan,** which allows turning the switch off until hosted builds are allowed (beta plan step I).

Also verified:
- The experimental build was deployed on 2026-10-18 and rolled back the same day. Production serves the default build.
- The hostname answers anonymous requests, so Cloudflare Access is not in front of it today. Why Access is not in front was not checked: Access settings were outside the read permission.

**Recommendation:** decide who may use hosted generation before turning it on (N1). Turning it on now makes paid generation public, bounded only by the gateway's daily limit.

## 4. Scripted example integrity

**Verified:** all 21 packaged examples and all 14 replay fixtures in the repository are correctly attributed.

**Assumed, cannot be checked from here:**
- Visitors' browser projects and exported files may hold replays saved under the wrong request.
- Every acceptance on production since 2026-10-18 was a replay.

**Built:** a deterministic detector, `findProbableReplays()`, with tests, on #113. It is read-only.

**Proposed, not shipped:**
- a review on project open, offering keep, restore the source, or leave out of generation;
- nothing is removed or rewritten without a click.

Details are in [EXAMPLE-INTEGRITY.md](EXAMPLE-INTEGRITY.md).

## 5. UX/UI prototypes and recommendation

**Built:** clickable explorations of conversation-led, canvas-led and flow-led workspaces, for the hotel task, across first run, authoring, refinement, testing and publishing.
- Private link: https://claude.ai/artifact/TxXcGqEmgEV2CGPY4Yz2b1. Others need it shared from its Share menu.
- Source: [prototypes/](prototypes/).
- The Playground moment works: search, invalid dates, loading, no availability, choosing, going back with the query kept, a booking failure and retry, an agent price change, and an agent update the rules refuse.
- **Verified:** it loads with no errors and no sideways scroll at 1280 px and 390 px, in light and dark.

**Recommendation:** one workspace with three coordinated views (conversation, journey outline, canvas with inspector), not three modes. The entry point decides which view is prominent. See [UX-EXPLORATION.md](UX-EXPLORATION.md).

**Assumed:** this is one reviewer's walkthrough. No first-time user has tried it.

## 6. Trust-fix implementation and regression evidence

**Verified.** Four draft pull requests, each from its own branch off `main`:

| Fix | Pull request | Regression evidence |
|---|---|---|
| (a) A demo replay names its source and is saved under it, never under the typed request; plus the detector | [aestheticfunction/dspack-studio#113](https://github.com/aestheticfunction/dspack-studio/pull/113) | 9 new unit tests and 1 new smoke test; 2 old assertions changed deliberately because they encoded the defect |
| (b) Rule checks are not fulfilment; availability is stated before typing | [aestheticfunction/dspack-studio#114](https://github.com/aestheticfunction/dspack-studio/pull/114) | 2 new smoke tests |
| (c) One `h1` per view, `aria-current`, skip link | [aestheticfunction/dspack-studio#115](https://github.com/aestheticfunction/dspack-studio/pull/115) | 1 new smoke test across all views |
| (d) Checks reflows at 390 px | [aestheticfunction/dspack-studio#116](https://github.com/aestheticfunction/dspack-studio/pull/116) | 1 new smoke test (the parent overflowed by 25 px) |

For every fix:
- the new tests fail on the parent commit and pass with the fix;
- the full local CI sequence passed;
- the default catalog export test and the request goldens are unchanged.

**Deviation from the plan:** hash routing was deferred to M1. It is refactoring rather than a trust fix, and the new shell rebuilds it anyway. See [M0-TRUST-FIXES.md](M0-TRUST-FIXES.md).

## 7. Pull requests

- Trust fixes: #113 to #116 above.
- Documents, the baseline and the corpus pin: the draft PR from `claude/vibrant-shannon-v2fuf0`.
- All are drafts and unmerged.
- Possible side effect: opening a PR may trigger a Workers Builds branch build. `preview_urls` is off, so no preview should be reachable. **Assumed, not checked.**

## 8. Protocol compatibility

**Verified** with the A2UI project's own Python implementation, independent of Composer's renderer ([PROTOCOL.md](PROTOCOL.md)):
- **0.9.1 is sound:** both packaged references' catalogs load, and all 17 emitted surfaces pass strict processing.
- **The "1.0" output is not final 1.0.** It fails in three ways:
  - the catalog lacks the required `protocolVersion`, so a renderer reads it as 0.9;
  - it fails the official catalog schema, which requires `anyFunction`;
  - its bindings use `path`, which final 1.0 reads as a literal value, so a correctly written `@path` binding is rejected.
- No 1.0 surface messages exist at all.

**Consequences:**
- Composer's own A3 gate cannot detect any of this, because it checks against the catalog its own emitter wrote.
- Meeting D6 (verified final 1.0 before public release) needs dspack-emit work, which is Track 2.

## 9. Proposed live evaluation budget

**Assumed** (estimate, nothing run). A pilot on Astryx only, using the production model through the existing Worker:
- **Requests:** about 60.
- **Estimated cost:** about $1.
- **Ceiling:** $5, enforced per request.
- **Early termination:** at the ceiling, on any model or usage integrity failure, or on repeated provider failures.

A decision table turns the pilot's results into the next request. The full baseline would be $15 to $25, under a $40 ceiling, and only after the pilot. It needs hosted generation on (N1) and one small harness change. See [LIVE-EVALUATION-PROPOSAL.md](LIVE-EVALUATION-PROPOSAL.md).

## 10. Updated M1 scope and dependencies

See [M1-SCOPE.md](M1-SCOPE.md). Changes from the proposal:
- The interoperability spike (gate R1a) reuses the protocol check on every instance, uses 0.9.1 only, and renders in a standalone upstream React renderer.
- The default build must carry new project keys untouched, because it drops unknown keys today.
- The storage migration starts with a design for review (D14).
- Hash routing joins M1.
- The example-integrity review is included if N3 is accepted.
- M1 still needs nothing from a sibling repository.

**Purposes for the vertical** ([ASTRYX-D5B.md](ASTRYX-D5B.md)): Astryx needs two owner-authored purposes, `loading-state` and `status-feedback`, and a ruling on whether a booking is `destructive-action`. D5b (contract extension) is a milestone of its own across two repositories. The recommendation is to decide it after M2.

## 11. Outstanding risks, blockers and decisions

**Decisions needed:**

| # | Decision | Recommendation |
|---|---|---|
| N1 | Hosted generation: on or off, and for whom | Re-apply Access first, or accept public generation bounded by the daily limit |
| N2 | Authorize the live pilot | Yes, at $5, after N1 |
| N3 | Ship the example-integrity review in M1 | Yes |
| N4 | Author `loading-state` and `status-feedback`; rule on booking as destructive | Author both; booking is not destructive |
| N5 | Adopt "one workspace, three coordinated views" for M1 prototyping | Yes |
| N6 | Authorize M1 as scoped | Owner's call |
| Also | Merge order and timing for #113 to #116 under the release freeze | (a) and (b) touch the same files in different places, so the second to merge may need a rebase |

**Risks and blockers:**
- **Final A2UI 1.0** depends on upstream emitter work that has not started. D6 makes it release-critical.
- **Little is bindable** on today's Astryx mapping (ADR R4). Compositions will mostly re-instantiate rather than bind until dspack-emit makes more properties dynamic.
- **Sibling repositories** have had no commits since August. Every upstream item has an in-repository fallback, but final 1.0 does not.
- **Access state:** the hostname is public today. Turning hosted AI on without deciding the audience makes paid generation public.
- **Environment note:** Playwright needed a browser-path mapping in this container. CI is unaffected.
- **Not done:**
  - the manual screen-reader pass (backlog A4);
  - usability sessions with first-time users;
  - any measurement of model behaviour.
