# RFC: a `blocks` section for dspack 0.5

**Status: draft RFC, not proposed upstream.**

This RFC moves to the dspack repository only if the Phase 1B decision rule passes (see [../BLOCKS.md](../BLOCKS.md), ADR-B3).

Phase 1B ended on 2026-10-16. Astryx passed clearly and shadcn/ui v3 passed, uncertain ([PHASE-1B-MILESTONE-REPORT.md](PHASE-1B-MILESTONE-REPORT.md)). The owner selected Phase 2 branch C, under which ratification waits until a second reference passes clearly ([PHASE-2-DECISION-RECORD.md](PHASE-2-DECISION-RECORD.md)). So the RFC stays here, not proposed upstream. Until then, blocks live in experimental sidecar files beside a packaged reference and never inside a synchronized contract. The reference implementation of everything structural below is `packages/composer-core/src/blocks/`; expansion semantics are implemented in Phase 1A against the goldens in `packages/block-bench/goldens/`.

## 1. Envelope

A sidecar binds one design system's blocks to one exact contract:

```json
{
  "blocksSidecar": "0.1",
  "status": "draft",
  "reference": { "name": "shadcn/ui", "dspack": "0.4", "version": "3.2.0" },
  "baseSha256": "992b51b8…",
  "blocks": [ … ]
}
```

- **`baseSha256`** is `sha256(JSON.stringify(parsed contract))`, the canonicalization dspack-gen's report digest uses. It is computed by one shared function: `contractDigest` in composer-core.
- **Base, not live.** It binds to the packaged base contract, not the live project contract, which adds accepted examples.
- **A contract edit fails CI loudly.** The draft-sidecar test asserts the pin, so a contract edit forces an explicit re-bind; blocks are never silently disabled.

A block definition:

| Field | Meaning |
|---|---|
| `id`, `version` | Kebab-case id; integer version. A breaking signature change needs a new version or id. |
| `status` | `draft` or `approved`. Only approved definitions count in evaluation. |
| `name`, `summary` | Display name; a short model-visible summary used for selection. |
| `relatedPattern` | The contract `patterns` entry this block refines, when one exists. |
| `intents` | The governed contexts the block may serve, and only those. |
| `keywords` | Evidence for deterministic selection. |
| `props` | The ordered signature (§2). |
| `constraints` | Closed cross-field checks (§4, B2). |
| `actions` | The emitted A2UI action names the template may dispatch. |
| `streaming` | `static-safe` or `disable-actions-until-complete`. |
| `notes` | Fidelity notes: what this design system cannot express for the block. |
| `template` | The closed expansion template (§5). |
| `examples` | Named calls with an intent and prompt. Each has a hand-expanded golden. |

## 2. The signature language

The signature is closed: six value types and nothing else.

| Type | Required keys | Optional keys |
|---|---|---|
| `string` | `maxLength` | `minLength` |
| `enum` | `values` | |
| `boolean` | | |
| `integer` | `minimum`, `maximum` | |
| `array` | `items`, `maxItems` | `minItems`, `uniqueItems` |
| `object` | `props` (ordered) | |

Rules, all fail-closed at load:
- Prop names are camelCase. `block`, `version`, `b`, `v` and `p` are reserved by the call envelope.
- Required props precede optional ones at every level.
- Every string and array is bounded.
- A key that does not apply to a type is an error.

There is deliberately no type that can carry an entered value, a default, a credential or runtime state. A block describes an interface, never its data in flight.

## 3. The call

**Named canonical form.** This is the contract, and every trace and record stores it:

```json
{ "block": "auth-form", "version": 1, "mode": "sign-in", "title": "Sign in to Acme", "fields": ["email", "password"] }
```

**Compact positional form.** This is a projection for the wire:

```json
{ "b": "auth-form", "v": 1, "p": ["sign-in", "Sign in to Acme", ["email", "password"]] }
```

Projection rules:
- Arguments follow the signature's order.
- Object values become arrays in their field order.
- Optional values are omitted from the end; a skipped middle optional is written `null`.
- Decoding a compact call yields the named call exactly. Round trip is tested for every example.

**The model's schema.** The model answers against `callJsonSchema(block, encoding)`: the selected block's schema only, never the full registry and never surface vocabulary.

## 4. Gates

| Gate | Checks | Where |
|---|---|---|
| **B0** | The sidecar parses; the binding matches; every component, prop and enum value a template can emit exists in the generation view (the contract minus the emit profile's casualties); join ids are present. | At load |
| **B1** | The call's envelope, declared props only, types and bounds. | Every call |
| **B2** | Constraints (`equal-length`, `includes-when`, `excludes-when`), and the expansion's emitted action names are a subset of `actions`. | Every call |
| **S1, S2** | The expanded surface, checked before `runPipeline`. A failure here is a template defect and fails closed. | Every expansion |
| **S1-S3, A1-A3** | Unchanged, inside `runPipeline`. | As today |

## 5. Expansion semantics

Expansion is a pure function of `(block, named call, reference, intent)`, where the intent is the selected one among the block's `intents`. The same inputs produce byte-identical JSON. Every failure below is an `invariant-failure` with a pathed reason.

**Serialization.**
- Golden files are `JSON.stringify(surface, null, 2)` plus a trailing LF.
- `expansionDigest` is sha256 of `JSON.stringify(surface)` with no whitespace.
- Object keys inside `props` and inside value objects keep template order.

**Output wrapper.** `{ "dspackSurface": "0.1", "system": reference.name, "intent": <selected intent>, "root": <expanded template> }`.

**Template node.** `{ component, id?, props?, text?, children? }`.
- The component is always literal.
- The output keys follow this exact order: `component`, `id`, `props`, `text`, `children`.
- A key whose value evaluates to *absent* is omitted.
- `props` is omitted when all of its values are absent.
- `children` is omitted when it expands to an empty list.

**Children.** The template entries are expanded in order and concatenated:

| Entry | Expands to |
|---|---|
| a template node | itself, expanded |
| `{ "$each": path, "as": name, "children": [...] }` | the children once per item of the array at `path`, with `name` bound to the item. An absent array yields nothing; a present non-array fails. |
| `{ "$if": test, "children": [...], "else": [...] }` | `children` when the test is truthy, otherwise `else` (or nothing) |

**Truthiness.** Absent, `null`, `false`, `""` and `[]` are falsy. Everything else is truthy.

**Tests.** A test is either a path, judged by truthiness, or `{ "$eq": [a, b] }`, which compares two evaluated values by JSON equality. Either `$eq` operand may be absent: absent equals only absent and is unequal to every present value. `$eq` operands are not array elements, so the absent-element rule does not apply to them.

**Values.** A value is literal JSON, an object or array of values (evaluated key by key, with absent object keys omitted), or exactly one directive:

| Directive | Result |
|---|---|
| `{ "$prop": path, "default"?: scalar }` | The value at `path` (a prop, an enclosing loop variable, or `variable.field`); otherwise the default; otherwise absent. Absent inside `$concat` or as an array element fails. |
| `{ "$concat": [values...] }` | String concatenation. Numbers are stringified; anything else fails. |
| `{ "$case": path, "map": {...}, "default"?: scalar }` | `map[value]` (own keys only) for an enum (or `"true"`/`"false"` for a boolean); otherwise the default; otherwise it fails. Checked at load: map results and the default are literal scalars, every enum value is mapped or a default is given, and a source that may be absent for a B1-valid call needs a default. |
| `{ "$index": name }` | The 1-based position of the enclosing `$each` or `$map` variable `name`. |
| `{ "$map": path, "as": name, "value": value }` | An array with `value` evaluated once per item. An absent source is absent. |

There are no expressions, no string templating beyond `$concat`, no conditionals inside values, no recursion, and no access to anything but the call.

## 6. Trace and provenance

- **The trace.** Every block-mode run produces an immutable `BlockTrace` as a turn-level artifact (Phase 1A). It holds the selected block, the encoding, each call with its B1/B2 verdicts and usage, the fallback reason and classification, the expansion digest, the schema digests, and the model's literal call text.
- **Provenance.** An accepted block surface stores `{v, reference, baseSha256, block, version, intent, blockSchemaSha256, encoding: "named", call, expansionDigest}` as project data, capped at 16 KB. The intent is stored because expansion depends on it.
  - It is written only when the accepted surface equals the expansion.
  - On import it is validated against the matching bundled sidecar.
  - An unknown version keeps only `{block, version, status: "inert"}`, and the surface renders as an ordinary surface.

## 7. Refinement contract

Compact refinement is used only when three things hold:
- the prior turn's trace outcome is `block`;
- the prior run passed at the expansion attempt;
- the prior surface's digest equals the trace's `expansionDigest`.

When it applies, the model receives the selected block's schema, the prior goal, the prior call and the requested change. It answers with a revised call, or with `{ "unsupported": true, "reason": "..." }`. The sentinel, or any failed precondition, switches visibly to primitive refinement over the full prior surface, which is unchanged from today.

## 8. Relation to existing contract sections

- `patterns` stay guidance for primitive generation. A block's `relatedPattern` names the contract pattern the block partially realizes. Every deviation from that pattern's guidance is listed in the block's `notes`. For example, `records-table` relates to `data-table-with-row-actions` but has no row actions or sortable headers, and `auth-form` relates to `form-field-layout` but keeps its submit inside the form rather than in CardFooter.
- `intents`, `rules` and `examples` are unchanged. Blocks add no rule type, and an expansion is judged by the same rules as any surface.

## 9. Open questions for ratification

- Whether positional order becomes a compatibility commitment (1B evidence).
- Whether `blocks` lives inside the contract or stays a sidecar artifact that the contract references.
- A first-class audit-report field for block calls, replacing the Phase 1A turn-level trace.
