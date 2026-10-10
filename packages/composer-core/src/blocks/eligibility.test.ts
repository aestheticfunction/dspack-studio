/**
 * Eligibility (Phase 1A): which blocks a build may be offered. Composer never
 * infers support: only a packaged reference project or an Example session,
 * whose vocabulary is still exactly the base the sidecar was bound to, built
 * in the browser, gets blocks. Everything else gets none, with a reason.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadProfile } from "@aestheticfunction/dspack-emit";
import { eligibleBlocks, liveBaseDigest, loadBlocks, type LoadedBlocks } from "./index";

type Json = Record<string, any>;
const repo = (rel: string) => fileURLToPath(new URL(`../../../../${rel}`, import.meta.url));
const json = (rel: string) => JSON.parse(readFileSync(repo(rel), "utf8")) as Json;

const base = json("apps/composer/astryx-project/astryx.dspack.json");
const profile = loadProfile(json("apps/composer/astryx-project/astryx.profile.json") as never);
const loaded = async (): Promise<LoadedBlocks> => loadBlocks(json("apps/composer/experimental/blocks/astryx.blocks.json"), { baseContract: base, profile });

const reference = { kind: "reference" as const, referenceId: "astryx" };

describe("liveBaseDigest", () => {
  it("is the base digest while the live contract only adds accepted examples", async () => {
    const live = { ...structuredClone(base), examples: [...base.examples, { id: "ex.chat-1", intent: "data-collection", surface: {} }] };
    expect(await liveBaseDigest(live, base)).toBe((await loaded()).sidecar!.baseSha256);
  });

  it("moves when the vocabulary or governance was edited in session", async () => {
    const live = structuredClone(base);
    live.intents = [...live.intents, { id: "onboarding", description: "Welcome a new operator." }];
    expect(await liveBaseDigest(live, base)).not.toBe((await loaded()).sidecar!.baseSha256);
  });
});

describe("eligibleBlocks", () => {
  const ok = async (overrides: Partial<Parameters<typeof eligibleBlocks>[0]> = {}) =>
    eligibleBlocks({
      mode: "demo",
      source: reference,
      inBrowser: true,
      liveDigest: (await loaded()).sidecar!.baseSha256,
      profileMatchesBase: true,
      loaded: await loaded(),
      disabled: new Set(),
      ...overrides,
    });

  it("a reference project (or Example session) on its unedited base, built in the browser, gets every usable block", async () => {
    const result = await ok();
    expect(result.reason).toBeNull();
    expect(result.blocks.map((b) => b.id)).toEqual(["records-table", "auth-form", "guide-steps"]);
  });

  it.each([
    ["an imported project", { source: { kind: "imported" as const } }, "imported-project"],
    ["a repository (agent) project", { source: { kind: "agent" as const, path: "/repo" } }, "repository-project"],
    ["agent mode", { mode: "agent" }, "repository-project"],
    ["no project", { source: null }, "no-project"],
    ["a local model (routes through the agent)", { inBrowser: false }, "local-model"],
    ["an edited vocabulary", { liveDigest: "0".repeat(64) }, "contract-edited"],
    ["an edited profile", { profileMatchesBase: false }, "profile-edited"],
  ])("%s gets none", async (_name, overrides, reason) => {
    const result = await ok(overrides as never);
    expect(result.blocks).toEqual([]);
    expect(result.reason).toBe(reason);
  });

  it("a sidecar that did not bind gets none", async () => {
    const result = await ok({ loaded: { binding: "mismatch", usable: [], disabled: [], issues: ["moved"] } });
    expect(result).toEqual({ blocks: [], reason: "binding-mismatch" });
  });

  it("a block disabled for this session is withheld; the rest stay", async () => {
    const result = await ok({ disabled: new Set(["auth-form"]) });
    expect(result.blocks.map((b) => b.id)).toEqual(["records-table", "guide-steps"]);
    expect((await ok({ disabled: new Set(["records-table", "auth-form", "guide-steps"]) })).reason).toBe("all-disabled");
  });
});
