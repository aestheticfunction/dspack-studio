# Pre-launch checklist

Repository
- [ ] main green in CI (frozen install, units, typechecks, gates, drift, sync, export, Playwright)
- [ ] no uncommitted or unpushed work; IMPLEMENTATION_LOG current
- [ ] fixtures all `mode: "live"` recordings (provenance labels honest)

Licensing
- [ ] Apache-2.0 LICENSE present (root) — done
- [ ] dependency licenses reviewed (`pnpm licenses list`) — all permissive

Packages / dependencies
- [ ] `pnpm audit` reviewed; no high/critical without a written waiver
- [ ] exact pins verified for churn-risk deps (@astryxdesign/*, @a2ui/* pair, @ag-ui/*)

Accessibility
- [ ] axe smoke suite green (e2e/a11y.spec.ts)
- [ ] manual keyboard pass: tabs, scrubber (arrow/Home/End), dialogs, import
- [ ] screen-reader spot check on the live status region and gate ticker

Deployment (owner actions)
- [ ] choose static-only vs live topology (docs/deployment.md)
- [ ] static deploy of `apps/web/out`; verify replay + import with agent absent
- [ ] if live: agent deployed, `AGENT_ALLOWED_ORIGINS` restricted, health checks wired
- [ ] rollback verified once (redeploy previous artifact)

Environment / security
- [ ] no secrets, private hosts, or Ollama addresses in the client bundle (grep the export)
- [ ] `.env.example` matches reality; real env files untracked
- [ ] security posture reviewed: agent accepts no credentials from requests; import caps enforced

Analytics / privacy (owner decision)
- [ ] decide: none, or privacy-respecting (e.g. Plausible); document either way

Documentation
- [ ] README quickstart verified on a clean machine
- [ ] CONTRIBUTING covers setup, tests, fixtures, scenarios, renderer boundary
- [ ] open-source scope boundary stated (no proprietary reconciliation)

Smoke test (on the deployed artifact)
- [ ] replay all curated fixtures; scrub each backward/forward
- [ ] import a downloaded session; verify identical replay
- [ ] break-it: one governed-repair + the refusal condition
- [ ] inspectors: state/actions/gates sync while scrubbing
- [ ] narrow-viewport pass (≈375px)

Launch
- [ ] link from aesthetic-function.com (owner)
- [ ] announcement copy in brand voice (declarative, unhyped, no em-dashes)

Interface blocks beta (Phase 2; docs/blocks/PHASE-2-RELEASE-PLAN.md §12)
- [ ] the release review's matrix passes, apart from the items only the deployed beta can meet (docs/blocks/RELEASE-REVIEW.md)
- [ ] main is the frozen release candidate, or a documentation-only successor the owner approved
- [ ] Cloudflare Access protects composer.aesthetic-function.com and composer-beta.aesthetic-function.com with the one invite allowlist, and anonymous requests to both go to the Access login (docs/blocks/BETA-DEPLOY-PLAN.md)
- [ ] the beta is deployed with the block switch off; its rollback anchor and baseline are recorded
- [ ] rollback rehearsed once on the beta: anchor recorded, rolled back, smoke green
- [ ] the zero-cost smoke passes on both hostnames
- [ ] the Stage 1 canary, authorized by the owner, is clean: integrity holds, the served model is recorded, the preflight matches the baseline
- [ ] a metrics report in the form of the plan's §9 table, with counts
- [ ] the minimum manual accessibility checks are recorded: a keyboard pass in Safari and in Firefox, and a screen-reader pass on the three Astryx blocks (docs/blocks/MANUAL-A11Y-PACKET.md)
- [ ] the release is labelled an experimental beta wherever it appears; GA stays blocked on the vocabulary and host semantics (plan §10)
