# Host actions: binding and authorizing interface-block actions

> **Status.** Experimental beta (Phase 2, step 3 of [PHASE-2-RELEASE-PLAN.md](PHASE-2-RELEASE-PLAN.md), §7). This guide is for a host that renders surfaces exported from the beta. The owner reviews it before the beta ships (§12). GA stays blocked on the vocabulary and host semantics in §10.

Composer composes and governs interface surfaces. It never executes an action ([../ARCHITECTURE.md](../ARCHITECTURE.md), §9). The Build canvas ignores actions. Preview records the name and may advance a flow walk. Neither sends anything anywhere. A **host** is the application that renders an exported surface and decides what each action does. Every action is the host's to bind and authorize, on its own server.

## 1. Who does what

| Party | Does |
|---|---|
| The sidecar owner | Declares each block's actions and streaming policy (`apps/composer/experimental/blocks/*.blocks.json`). |
| Composer, at load | **H1.** Proves that every node able to dispatch an action has an id built only from literals and enum props, and that the names the template can emit equal the declared actions, exactly. A block that fails is disabled. |
| Composer, per expansion | **B2.** Holds every expansion's emitted names to the declaration. An undeclared name is an invariant failure, never repaired by a model. |
| Composer, on export | **H2.** The beta's Catalog export carries a per-surface action manifest (§3). |
| The host | Binds each action to an effect and authorizes every effect on its server (§4). |

## 2. What a surface dispatches

The emitter (dspack-emit 0.7.0) gives a node an action only where the reference profile says so. On both packaged references, that is a `button` or an `alert-dialog`. The action is `{"event": {"name": <slug of the node id>, "context": {}}}`: the id lowercased, with every run of other characters turned into `_`. When a user activates it, the A2UI client reports `{name, surfaceId, sourceComponentId, timestamp, context}` to the host.

Without an id, the emitter would name the action from the node's text or component, and a model can write text. So H1 refuses any action node whose id is missing or depends on anything but literals and enum props: no string the model fills, no position (`$index`), no optional enum without a default. The model fills content; it never names an action.

| Block | Action names, the same on both references | Present when | Streaming policy |
|---|---|---|---|
| records-table | `records_create`, `records_export`, `records_refresh` | listed in `actions` | `disable-actions-until-complete` |
| auth-form | `auth_submit`; `auth_forgot`; `auth_provider_google`, `auth_provider_github`, `auth_provider_microsoft`, `auth_provider_apple` | always; when `recovery` is set; one per provider | `disable-actions-until-complete` |
| guide-steps | `guide_start`, `guide_save` | listed in `actions` | `static-safe` |

## 3. The action manifest

**Where.** In the beta's experimental build, Preview's "export catalog" downloads the catalog, every surface's messages and an `actionManifest`. The default build's export is unchanged, byte for byte, and carries no manifest.

**Shape (v1).** One entry per exported surface, in the export's order:

```json
{
  "a2uiCatalog": { "...": "..." },
  "surfaces": [{ "name": "ex.chat-1", "messages": ["..."] }],
  "actionManifest": {
    "v": 1,
    "surfaces": [
      {
        "surface": "ex.chat-1",
        "surfaceId": "data_collection",
        "actions": [
          { "name": "auth_provider_github", "declared": true },
          { "name": "auth_submit", "declared": true }
        ],
        "block": {
          "id": "auth-form",
          "version": 1,
          "reference": { "name": "Astryx", "dspack": "0.4", "version": "0.1.4" },
          "baseSha256": "<the sidecar's base binding>",
          "intent": "data-collection",
          "expansionDigest": "<sha256 of the surface>",
          "declaredActions": ["auth_submit", "auth_forgot", "auth_provider_google", "auth_provider_github", "auth_provider_microsoft", "auth_provider_apple"],
          "streaming": "disable-actions-until-complete"
        }
      }
    ]
  },
  "exportedAt": "2026-10-16T12:00:00.000Z"
}
```

| Field | Meaning |
|---|---|
| `surface` | The surface's name in this export: its `surfaces[].name`, the project's example id. |
| `surfaceId` | The A2UI surfaceId its messages create, or `null` when they do not name exactly one. |
| `actions` | Every action name its messages dispatch, sorted. `declared` is `true` only when this surface's verified block declares the name. |
| `block` | The block this surface verifiably is, or `null`. |
| `block.expansionDigest` | The expansion identity: sha256 of the surface's compact JSON, equal to the expansion of the stored call. |

**How a surface earns a block binding.** The manifest is recomputed from the surface's messages at every export, so an edited surface reports what it dispatches now. A surface binds a block only when all of these hold:
- Its provenance names an approved block of an approved sidecar that the build bundles, and B0 (with H1) accepted that block at load.
- The stored call passes B1 and the block's constraints.
- Re-expanded, the call gives exactly the stored surface.
- That expansion's emission is exactly the exported messages.
- Every action in those messages is declared by the block and carries an empty context.
- The export holds no other surface of the same name, and the messages name exactly one surfaceId.

**What gets no binding.** Anything else gets `block: null`, with every action `declared: false`. That covers a primitive surface whose node id happens to slug to a block's name, a surface edited after it was accepted, and forged, stale or misfiled provenance.

**What the manifest is not.** It is not a grant. It states what each exported surface dispatches and which block it verifiably is, as of the export. A host still authorizes every effect itself (§4). The manifest is not signed: treat an export as configuration you reviewed, never as input that arrives at runtime.

## 4. Authorizing an action

1. **Names are not capabilities.** A surface id plus an action name grants nothing. Another surface can dispatch the same name: a primitive surface whose button id is `auth-submit` also dispatches `auth_submit`.
2. **A block action needs both.** Authorize a block action only when:
   - the surface's block identity verifies: the surface still equals its block's expansion, under a sidecar you trust; and
   - the action is declared for that surface in the manifest you reviewed.

   Deny everything else. Bind actions by the surface you rendered, not by what the client reports. Every field of an action event (`name`, `surfaceId`, `sourceComponentId`, `context`) is client-supplied and untrusted.
3. **Authorize on the server, per effect.** An action event is a request, never a grant. For each effect, check the session, the user's permission for that effect and the resource it touches, on your own server. Never trust a client-side check, the manifest or the presence of a button.
4. **Make effects idempotent.** Replays and double submits happen: retries, double clicks, a client that resends. Give each effect an idempotency key and answer a repeat with the first result. The exhibit's agent shows the shape: it keeps the answer for each `actionId` and returns it again for a repeat (`answeredActions` in `apps/agent/src/server.ts`). Rate-limit what can be repeated.
5. **Honour the streaming policy.** For `disable-actions-until-complete`, keep the block's actions disabled in the client, and refuse them on the server, until the surface's message stream has completed. For `static-safe`, they may be enabled once rendered. A host that cannot tell when a stream completes treats every block as `disable-actions-until-complete`.
6. **Treat model content as untrusted data.** Titles, captions, cells, steps, summaries and intro text can be model-written.
   - Render them as text: never as HTML or markdown, never as a link or URL.
   - Never evaluate them, and never use them as identifiers or as input to an authorization decision.
   - Never pass them to a model as instructions.

   B1 bounds their length and S3 checks them, but a person should still review copy before it ships: misleading copy is possible within the bounds.
7. **auth-form: credentials and entered values never enter action context.**
   - The call has no slot for an entered value, a default, a credential or runtime state (B1). Labels and input types are template literals chosen by enum. Only `title` and `intro` are model text, capped at 80 and 200 characters.
   - Every action it emits carries `context: {}`. Tests pin this for every example and for the largest call on both references. The manifest refuses to bind a block action whose context is not empty.
   - Its fields carry no data-model binding, so the A2UI client has nothing to sync when an action fires. Typed text stays in the page.
   - Submit credentials from your own form state straight to your own auth endpoint, in your own request. Never put them in an action context, in a data model relayed to an agent or a model, in a log or in a URL, and never add a binding that would sync them.
   - Provider buttons start your own OAuth flow. Composer holds no client ids or secrets.
8. **Provenance is a claim.** An import keeps only the provenance the bundled sidecars can vouch for, and the manifest still re-expands it. A forged entry binds nothing, and so grants nothing. Imported projects are never offered blocks.

## 5. Threat cases

| Threat | Control |
|---|---|
| The model coins an action | No action slot in any call; H1 at load requires action ids built only from literals and enum props, equal to the declaration; B2 makes an undeclared emitted name an invariant failure. |
| Another surface emits a block's name | Names are not capabilities: the manifest marks it `declared: false` with no block, and the host grants nothing without verified block identity and the manifest. |
| An accepted surface is edited to add a button | The manifest is recomputed from the messages at export: the edited surface has no block binding and its new action is listed undeclared. Provenance for it is pruned on save. |
| Forged `blockProvenance` in an imported file | Import keeps only what the bundled sidecars vouch for; the manifest re-expands the call, so a forged entry binds nothing. |
| A host relays entered values to an agent or a model | Actions carry an empty context (tested), fields carry no binding, and the manifest refuses a non-empty context; host rule 7. |
| Misleading copy in `title` or `intro` | B1 length bounds, S3 rules and a person accepting the surface; host rule 6. |
| Actions enabled while the surface streams | The manifest exports each block's policy; host rule 5. |
| Replay or double submit | Host rule 4: idempotency keys and rate limits. |

## 6. Where these properties are tested

| Property | Tests |
|---|---|
| H1: bounded action ids, names equal to the declaration, failures disable the block at load | `packages/composer-core/src/blocks/actions.test.ts`; `apps/composer/lib/blocks-ratchet.test.mjs` |
| Emitted names within the declaration, every context empty, auth-form included | `actions.test.ts`; the ratchet, over every example and boundary call on both references |
| The manifest: binding by surface and name, forged provenance, edited surfaces, undeclared actions and contexts failing closed | `packages/composer-core/src/blocks/manifest.test.ts`; `apps/composer/experimental/blocks-runtime.test.ts` |
| The default Catalog export is byte-identical | `apps/composer/app/catalog-export.test.ts`; `e2e/composer-prod-smoke.spec.ts` |
| The beta's export carries the manifest, end to end | `e2e/composer-blocks.spec.ts` |

## 7. Limits

- **One emitter path.** H1's proof covers the emitter's one source of action events in dspack-emit 0.7.0, the synthesized action. An emitter upgrade re-runs these tests before it lands, and B2 still checks every expansion.
- **Composer's side only.** The manifest says what a surface dispatches. Whether an effect is allowed is decided by the host, on its server.
- **Later Phase 2 steps.** Composer has no host handlers. The Blocks catalog and provenance UI, and the Preview label "host-owned, not executed here", are step 4 (H3).
