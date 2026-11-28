# Proposal: the server-side authorization boundary for external agent consumption

**Status:** proposal for approval, 2026-11-28. Nothing here is implemented, provisioned or deployed. It names no infrastructure provider. It is the boundary an external agent would need, informed by the local discovery (decisions 88 to 90), and it does not block the Interactive Playground, which stays local.

## Principles

1. **The server is the only authority** for anything an external agent receives.
   - Browser-local approvals, withdrawals and eligibility are never accepted as server authorization.
   - A client can submit a definition and ask; it never asserts.
2. **Approval, eligibility and publication are three separate things:**
   - approval is a person's decision on an exact version;
   - eligibility is computed when asked;
   - publication is a further, explicit decision to let named agents discover it.
3. **Exact versions only:**
   - an agent holds `{ project, composition, version, definitionSha256 }`;
   - the server never substitutes another version or a newer definition.
4. **Fail closed** wherever the authoritative state cannot be read.

## Pieces

| Piece | What it holds | Rules |
|---|---|---|
| **Identity** | Authenticated user, project and tenant on every request | Every record below is scoped to a project in a tenant. An agent credential is issued per project, for discovery and resolution only |
| **Composition versions** | Immutable, server-owned definitions keyed by `(project, composition, version)`, with the definition hash computed by the server from the normalized definition | A version, once stored, never changes. A different definition under the same key is refused |
| **Approvals** | `(version key, definition hash, approver, checks evidence, generation)` | Created only by a server-run check under the server's contract, profile and toolchain pins. Client check results are evidence for people, never authorization |
| **Withdrawals** | Current withdrawals, and a kept history of restored ones, each bound to the exact definition hash and a generation | Updated in one transaction: read, apply one change, write. Restore is compare-and-set on the withdrawals it saw. A per-project counter orders every change. Nothing uses the wall clock |
| **Eligibility** | Computed at request time, never stored | Requires all of: an approved exact version; not withdrawn; an approval at least as recent as the latest withdrawal; checks current under current pins; sensitive-data rules met; nothing unresolved from a promotion; intended states reached. This is the same rule set as `agentEligibility`, evaluated server-side |
| **Publication** | Which eligible versions which agent credentials may discover | Explicit per version. Revoked by withdrawal, which is checked at request time |
| **Commitments** | Idempotency key, version key, definition hash, approval generation, outcome, history | Written before an action is accepted. A key is accepted once. Terminal outcomes are final. Concurrent acceptance of the same consequential action for the same subject is refused in one transaction |

## Requests

- **Discover:** returns the published, eligible exact versions for this agent credential, in the minimum form that `composer.local-discovery/1` already defines. It is evaluated against the authority at the request.
- **Resolve:** given an exact reference and data:
  - re-check eligibility and publication;
  - refuse unknown, altered, withdrawn or stale references;
  - instantiate through the same governed pipeline (composer-core `instantiate`) on the server;
  - return the surface.
- **Act:** accepted only against a surface the server issued:
  - consequential actions go through the commitment record first;
  - withdrawal refuses new actions, and settling existing keys still works.

## Cross-device withdrawal

A withdrawal is a server write. Every discovery, resolution and action reads it at request time, so a withdrawal on one device applies to every agent at its next request. The Library would read the server's record for approved versions, keeping the local record only for local experimentation.

## Migrating locally authored compositions

- **Local approvals never carry over.** A locally approved version is uploaded as a candidate definition. The server normalizes and hashes it itself, runs the checks under its own pins, and a person approves it there. Only then does it exist server-side.
- **Local withdrawal history is not trusted either.** It is shown to the person deciding, as information.
- **Packaged sample versions** are seeded server-side by the same process, not by copying.

## What this requires before external consumption

- A durable transactional store and authenticated identity (provider to be chosen).
- A server runtime for checks and instantiation, using the existing composer-core pipeline.
- Credentials for agents.
- None of this is needed for the Interactive Playground, which remains local and synthetic.

## Decisions needed

1. Approve this boundary as the target for external consumption.
2. Choose when, and on which provider, to build it. That is a separate authorization covering infrastructure, credentials and data.
