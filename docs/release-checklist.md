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

Interface blocks beta (Phase 2; docs/blocks/PHASE-2-RELEASE-PLAN.md §12; single host, docs/blocks/BETA-DEPLOY-PLAN.md)
- [ ] the release review's matrix passes, apart from the items only the cutover, a person or the canary can meet, and each FAIL is accepted by the owner (decisions D2 and D6, docs/blocks/RELEASE-REVIEW.md)
- [ ] main is the frozen release candidate, or an owner-approved successor that changes no application, Worker or block code
- [ ] A, B: Cloudflare Access protects composer.aesthetic-function.com, allowing only the owner's exact email through one-time PIN; no new hostname or Worker exists
- [ ] C: anonymous GET and POST requests to composer.aesthetic-function.com, /api/propose included, go to the Access login before reaching the Worker
- [ ] D: workers.dev and Preview URLs are disabled for dspack-studio-composer, its only route is the custom domain, and that domain has no Preview URLs
- [ ] E: the owner signs in and runs a scripted build
- [ ] F: the cutover change merged; the experimental artifact deployed through the Access-gated workflow, with the block switch off; the rollback anchor recorded
- [ ] G: the baseline recorded; rollback rehearsed to the block-free release candidate and forward again
- [ ] H: the zero-cost scripted checks pass, and the minimum manual accessibility checks are recorded: a keyboard pass in Safari and in Firefox, and a screen-reader pass on the three Astryx blocks (docs/blocks/MANUAL-A11Y-PACKET.md)
- [ ] I: no hosted canary or paid call until the owner authorizes a temporary machine credential; then the Stage 1 canary is clean and the metrics report follows
- [ ] the release is labelled an experimental beta wherever it appears; no full WCAG 2.2 AA conformance is claimed; GA stays blocked on the vocabulary and host semantics (plan §10)
