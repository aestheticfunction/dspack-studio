# Offline protocol check: Composer's A2UI output against the upstream validator

**Status:** M0, 2026-11-25. Offline and deterministic: no model was called. Nothing in the product was changed to make a check pass. Findings are recorded here for M1 and Track 2.

## What was checked

| Input | Source |
|---|---|
| Catalogs for A2UI 0.9.1 and "1.0", for both packaged references (Astryx 0.1.4, shadcn/ui v3) | Derived by `@aestheticfunction/dspack-emit` 0.7.0, the version Composer pins, from `apps/composer/{astryx,shadcn-v3}-project` |
| Surface messages for every worked example of both references (20 examples; 3 shadcn examples are refused by the emitter, as documented in the product) | `emitSurface` from the same build |

| Validator | Version |
|---|---|
| `a2ui-core`, the A2UI project's own Python implementation (a separate code base from the TypeScript renderer Composer uses) | 0.7.1.dev1, built from `a2ui-project/a2ui` at `1dbe86a` (2026-11-24) |
| The official A2UI 1.0 `catalog_definition.json` schema | Same commit, `specification/v1_0/json/` |

The processor ran with `STRICT_VALIDATION`: unknown properties, dangling references, orphans and a missing root are all errors.

## Results

| Check | Astryx | shadcn/ui v3 |
|---|---|---|
| 0.9.1 catalog loads in a2ui-core | Pass | Pass |
| 0.9.1 surfaces processed under strict validation | **6 of 6 pass** | **11 of 11 pass** (3 refused earlier by the emitter, so not sent) |
| "1.0" catalog against the official 1.0 catalog schema | Fails: `$defs.anyFunction` is required and absent | Same |
| "1.0" catalog declares `protocolVersion: "1.0"` | **No.** The 1.0 evolution guide says catalogs targeting 1.0 "MUST specify" it; without it a renderer treats the catalog as 0.9 | Same |
| Data-binding spelling in the "1.0" catalog | `{"path": …}` | Same |
| A 1.0 message binding `TextField.value` as final 1.0 writes it, `{"@path": "/form/name"}` | **Rejected** by the derived catalog ("unevaluated properties") | Same |
| The same message with the 0.9 spelling `{"path": …}` | Accepted by the catalog, but final 1.0 treats a plain `{"path"}` object as a literal value, not a binding (evolution guide, reserved `@` keys) | Same |
| Surface messages for 1.0 | **None exist.** Every emitted surface is a `version: "v0.9"` stream naming the 0.9.1 catalog id | Same |

## What this means

1. **0.9.1 is sound.** Everything Composer renders today is accepted by an independent implementation under strict validation. This is the first evidence of that outside Composer's own TypeScript stack (C7, level 1 for today's output).
2. **The "1.0" output is a pre-release shape, not final 1.0.** It would fail three ways on a final 1.0 runtime: the catalog is read as 0.9 (no `protocolVersion`), it fails the official schema (`anyFunction`), and any binding in it would be read as a literal value. Today's surfaces carry no bindings, which is why A3 reports green; the moment a composition binds a value, the 1.0 path breaks.
3. **D6 is therefore real work, owned upstream.** Verified final 1.0 support (the owner's condition for public release) needs dspack-emit to: write `protocolVersion: "1.0"`, include `anyFunction`, use the 1.0 common types (`@path`, `@call`, `@checks`), and emit 1.0 surface messages. That is a Track 2 item (`C8` in the proposal). Composer's own A3 gate cannot detect any of this, because it validates against the catalog dspack-emit itself wrote.
4. **For M1:** compositions may bind values only on the 0.9.1 path, and the compatibility report must say "bindings verified for 0.9.1 only" until the upstream change lands. The M1 interoperability spike should run this check on every composition instance.

## Reproduce

From the repository root, with dependencies installed:

```bash
node docs/repositioning/protocol-check/emit-all.mjs "$PWD" /path/to/workdir
```

In a separate virtual environment with `a2ui-core` installed from the A2UI repository (`python/a2ui_core`) plus `pyyaml`:

```bash
python -I docs/repositioning/protocol-check/check.py /path/to/workdir astryx shadcn-v3
```

```bash
python -I docs/repositioning/protocol-check/check10.py /path/to/a2ui/specification/v1_0/json /path/to/workdir astryx shadcn-v3
```

## Not checked

- Rendering in an upstream renderer (C7 level 2). That is the M1 interoperability spike.
- The A2UI YAML conformance suites themselves. They test renderer and processor implementations, not producer output; the processor that passes them was used here instead.
- shadcn/ui 2.3.0 (the exhibit's pinned contract), which Composer does not use.
