/**
 * The action manifest's empty-context guard, alone (docs/blocks/HOST-ACTIONS.md).
 * dspack-emit 0.7.0 always emits `context: {}`, so the guard is unreachable
 * through the real emitter: messages carrying a context fail the manifest's
 * emission check first. Here the emitter itself is made to write a context,
 * so the exported messages ARE the expansion's own emission and only the
 * guard can refuse the binding. The control proves the setup binds without
 * the injected context.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ context: null as Record<string, unknown> | null }));

vi.mock("@aestheticfunction/dspack-emit", async (importOriginal) => {
  const real = await importOriginal<typeof import("@aestheticfunction/dspack-emit")>();
  const withContext = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(withContext);
    else if (value && typeof value === "object") {
      const event = (value as Record<string, unknown>).event;
      if (state.context && event && typeof event === "object") (event as Record<string, unknown>).context = structuredClone(state.context);
      Object.values(value).forEach(withContext);
    }
  };
  return {
    ...real,
    emitSurface: (...args: Parameters<typeof real.emitSurface>) => {
      const out = real.emitSurface(...args);
      withContext(out.messages);
      return out;
    },
  };
});

const { emitSurface, loadProfile } = await import("@aestheticfunction/dspack-emit");
const { actionManifest, expandBlock, expansionDigest, loadBlocks, parseBlocksSidecar } = await import("./index");

type Json = Record<string, any>;
const repo = (rel: string) => fileURLToPath(new URL(`../../../../${rel}`, import.meta.url));
const json = (rel: string) => JSON.parse(readFileSync(repo(rel), "utf8")) as Json;

async function exportOfAuthForm() {
  const raw = json("apps/composer/experimental/blocks/astryx.blocks.json");
  const contract = json("apps/composer/astryx-project/astryx.dspack.json");
  const profile = loadProfile(json("apps/composer/astryx-project/astryx.profile.json") as never);
  const parsed = parseBlocksSidecar(raw);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const block = parsed.sidecar.blocks.find((b) => b.id === "auth-form")!;
  const example = block.examples[0]!;
  const expanded = expandBlock(block, example.call, { reference: parsed.sidecar.reference, intent: example.intent });
  if (!expanded.ok) throw new Error(expanded.message);
  const messages = emitSurface(expanded.surface as never, contract as never, { profile }).messages as unknown[];
  const entry = {
    v: 1,
    reference: parsed.sidecar.reference,
    baseSha256: parsed.sidecar.baseSha256,
    block: "auth-form",
    version: 1,
    intent: example.intent,
    blockSchemaSha256: "a".repeat(64),
    encoding: "named",
    call: example.call,
    expansionDigest: await expansionDigest(expanded.surface),
  };
  const loaded = await loadBlocks(raw, { baseContract: contract, profile });
  return actionManifest({
    surfaces: [{ name: "ex.chat-1", messages }],
    examples: [{ id: "ex.chat-1", surface: expanded.surface }],
    provenance: { "ex.chat-1": entry },
    references: [{ loaded, contract, profile }],
  });
}

describe("a block action whose context is not empty binds nothing, even when it is the expansion's own emission", () => {
  it("control: with the emitter's own empty contexts, the surface binds", async () => {
    state.context = null;
    const manifest = await exportOfAuthForm();
    expect(manifest.surfaces[0]!.block).toMatchObject({ id: "auth-form" });
  });

  it("an entered value in the context: no binding, and no action declared", async () => {
    state.context = { password: { path: "/auth/password" } };
    const manifest = await exportOfAuthForm();
    state.context = null;
    expect(manifest.surfaces[0]!.block).toBeNull();
    expect(manifest.surfaces[0]!.actions.every((a) => a.declared === false)).toBe(true);
  });
});
