# Authorization and sensitive-data requirements before agent-facing discovery

**Status:** record and recommendation, 2026-11-28. Nothing here is implemented in this increment. The owner asked for the exact enforcement requirements and a narrow implementation, to be settled before agent-facing composition discovery begins.

These follow decision 56 (withdrawal on this device), decisions 52 and 53 (sensitive data), and decision 70 (carried forward). Each section gives what holds today, then the gap. **Requirements** are what must be enforced. **Narrow implementation** is the smallest change that enforces them on the existing host, storage and loader, with no new schema, service or dependency.

## 1. Cross-tab withdrawal and restoration

**Holds today**
- A withdrawal in one tab refuses the version in every other open tab at once: a `storage` event triggers `applyWithdrawals`.
- A restoration in another tab is not applied. The open tab keeps refusing until it reloads, and a reload re-checks. That is the safe direction.

**Gap, found by reading the code for this record**

`withdrawApproval` and `restoreApproval` write the `authorization` record from the tab's in-memory copy, not from what is stored. An open tab updates its copy only when a withdrawal applies to a host it holds, so in one case a withdrawal can be lost on reload:
1. Tab A is open.
2. Tab B approves a draft on this device. Tab A has never loaded that draft.
3. Tab B withdraws the approval.
4. Tab A then withdraws, or restores, any other version.

Tab A's write drops tab B's entry. Tab B's host still refuses for now, but after a reload the version is authorized again with no one restoring it. The rollback written after a refused restoration has the same problem. The `drafts`, `versions` and `promotions` records are also last-writer-wins across tabs, but only `authorization` can widen what is authorized.

**Requirements**
- **R1.1** A write to `authorization` never removes an entry this tab did not mean to remove. Withdraw adds exactly one entry. Restore removes exactly the entry for its definition's sha256.
- **R1.2** A tab never authorizes a version because another tab restored it. It needs its own check, issued after the withdrawal, under its own rules.
- **R1.3** A tab that sees a restoration made elsewhere says so, and offers to run the checks here. It never restores silently.

**Narrow implementation**
- In `withdrawal.ts`, read the stored record (`readRecord("authorization", store)`) immediately before each write. Apply the single addition or removal to that record, not to the in-memory copy. Use the same re-read for the rollback.
- In the `storage` listener, also update the tab's copy when no host applied the change.
- When a stored withdrawal disappears for a version this tab holds withdrawn, show "Restored in another tab. Run the checks here to use it." The control runs the existing restore path: recheck, then `host.restore`.
- Tests:
  - two stores sharing one map: interleaved withdrawals are both kept;
  - a restoration elsewhere authorizes nothing here until this tab restores.

## 2. Stale authorization after withdrawal

**Holds today**
- Every approval carries the order in which it was issued. A withdrawal records the latest issue at that moment, so an approval issued before it can never restore it (`host.ts`).
- Stored check evidence (`approvals`) is never accepted as authorization.

**Gap**

That ordering lives in one host's memory. After a reload, a new host starts counting again. Today this is safe: nothing outside the page holds an approval, and the stored withdrawal is applied before anything is shown. It stops being safe once an approval leaves the page, through discovery, publication or an agent holding a reference.

**Requirements**
- **R2.1** Any authorization that leaves the host carries an identity that a withdrawal can invalidate after a reload: composition, version, definition sha256 and an issue time.
- **R2.2** Restoration accepts only a check issued after the recorded withdrawal time, across reloads.
- **R2.3** Discovery lists only versions that are approved and not withdrawn, evaluated when asked, never cached past a withdrawal.

**Narrow implementation**
- Add `withdrawnAt` (an ISO time) to each `authorization` entry, as a record version 2. Version 1 records read as withdrawn with an unknown time, which refuses every earlier approval.
- `restoreApproval` compares the fresh check's issue time with `withdrawnAt`.
- Discovery, when built, calls the same `isWithdrawn` test at request time.

## 3. Commitments initiated before withdrawal

**Holds today**
- A consequential action accepted before a withdrawal keeps its idempotency key, and its outcome can still be settled.
- Withdrawal stops new acceptances, not the reporting of one already made. Retries of the same key are refused as duplicates.

**Gap**
- Commitments live in the host's memory only. A reload loses an outcome that was still pending.
- Nothing records which approval a commitment was accepted under, so a person cannot tell that a pending outcome predates a withdrawal.

**Requirements**
- **R3.1** A commitment names the approval it was accepted under (definition sha256 and issue).
- **R3.2** After a withdrawal, a pending commitment can still be settled and queried by its key. It can never be re-dispatched, and no new commitment can open from the withdrawn version.
- **R3.3** Before external consumption, pending commitments survive a reload. Each is stored with its key, composition, version, sha256, approval issue and outcome, and never with any value typed into a private field.
- **R3.4** The surface that shows a pending outcome says when it was accepted before a withdrawal.

**Narrow implementation**
- Add `approvedUnder` to `Commitment` in `host.ts`.
- Add a `commitments` workspace record (version 1, validated like the others) that holds pending keys only, with no payload.
- On load, re-attach pending keys to the host, in settle-only mode.
- Tests: withdraw with a pending commitment, reload, settle; a re-dispatch is refused.

## 4. Sensitive data in historically approved versions

**Holds today**
- A draft with an unmasked private field cannot be approved (decision 52).
- Sensitive values are redacted in anything recorded (`redactEvent`). They are never stored, never carried into a replacement, and never put into diagnostics.
- The packaged **Hotel search v1** is approved with a private field (loyalty number) that is not masked on screen. It stays immutable, with its historical evidence, as decision 52 requires.

**Gap**

Decision 53 requires every approved version to meet the current sensitive-data rules before external agent consumption. Nothing yet enforces that for a version that is already approved. A historical approval must not exempt a version, and immutability does not mean exemption.

**Requirements**
- **R4.1** A version is eligible for discovery or consumption only if it passes the current sensitive-data checks (`interactionIssues`: every private field masked). That is in addition to being approved and not withdrawn.
- **R4.2** An ineligible approved version stays immutable and usable in the Library preview. It is labelled "Needs a safety update before agents can use it", and creating a draft is the way forward.
- **R4.3** The rule is evaluated, never stored as an exemption. A future rule change makes earlier approvals ineligible until they comply.
- **R4.4** A text field drawn as a password (the contract's `type: "password"`) but not declared private is flagged before approval.
  - This matters for promotion. A block's password field becomes a text field of the designer's own, and that field should not silently lose its privacy.
- **R4.5** Synthetic data only, unchanged. No sensitive value is persisted, put in diagnostics or carried into a replacement, for drafts, promoted compositions and approved versions alike.

**Narrow implementation**
- Add one function in the workspace, `eligibleForAgents(definition, host)`: approved, not withdrawn, and `interactionIssues(definition).length === 0`.
- Show its answer in the inspector's Versions section. Use it as the only gate the future discovery list may read.
- Add a warning to `interactionIssues` for a password-drawn field that is not private. It blocks approval only if the owner chooses that.
- Tests:
  - Hotel search v1 is approved but not eligible, and its definition is byte-identical;
  - a masked draft of it, once approved, is eligible.

## Order of work

These are recommended as one small increment before discovery, in this order:
1. R1 (record race), because it can widen authorization today.
2. R4 (eligibility gate), because discovery needs it as its only input.
3. R2.
4. R3.

None needs a new dependency, a schema change to compositions, or any Cloudflare or sibling-repository change.
