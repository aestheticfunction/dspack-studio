/**
 * The per-project provenance store (Phase 1A, commit 4): the flows.ts idiom,
 * holding opaque data. It carries no block code, so it may live in the
 * default bundle; what it stores is validated only by experimental builds.
 * Projects copy it on duplicate only in experimental builds, and always
 * remove it on delete.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blockProvenanceKey, loadBlockProvenance, removeBlockProvenance, saveBlockProvenance } from "./block-provenance";
import { createProject, duplicateProject, removeProject } from "./projects";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
}

let store: MemoryStorage;
beforeEach(() => {
  store = new MemoryStorage();
  (globalThis as { window?: unknown }).window = { localStorage: store };
});
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.unstubAllEnvs();
});

const ENTRY = { v: 1, block: "auth-form", version: 1, call: { block: "auth-form", version: 1, mode: "sign-in" } };

describe("block-provenance store", () => {
  it("round-trips a map under its own per-project key; an empty map removes the key", () => {
    expect(saveBlockProvenance("p1", { "ex.chat-1": ENTRY })).toBe(true);
    expect(store.getItem(blockProvenanceKey("p1"))).toBe(JSON.stringify({ "ex.chat-1": ENTRY }));
    expect(loadBlockProvenance("p1")).toEqual({ "ex.chat-1": ENTRY });
    expect(saveBlockProvenance("p1", {})).toBe(true);
    expect(store.getItem(blockProvenanceKey("p1"))).toBeNull();
  });

  it("absent or corrupt data reads as an empty map", () => {
    expect(loadBlockProvenance("none")).toEqual({});
    store.setItem(blockProvenanceKey("bad"), "{not json");
    expect(loadBlockProvenance("bad")).toEqual({});
    store.setItem(blockProvenanceKey("list"), "[1,2]");
    expect(loadBlockProvenance("list")).toEqual({});
  });

  it("a full quota is reported, never thrown", () => {
    store.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    expect(saveBlockProvenance("p1", { "ex.chat-1": ENTRY })).toBe(false);
  });

  it("removeBlockProvenance clears the key", () => {
    saveBlockProvenance("p1", { "ex.chat-1": ENTRY });
    removeBlockProvenance("p1");
    expect(loadBlockProvenance("p1")).toEqual({});
  });
});

describe("projects: duplicate and remove", () => {
  it("an experimental build copies provenance to the duplicate; removing a project removes it", () => {
    vi.stubEnv("NEXT_PUBLIC_COMPOSER_EXPERIMENTAL", "1");
    const original = createProject({ name: "A", source: { kind: "reference", referenceId: "astryx" } });
    saveBlockProvenance(original.id, { "ex.chat-1": ENTRY });
    const copy = duplicateProject(original.id)!;
    expect(loadBlockProvenance(copy.id)).toEqual({ "ex.chat-1": ENTRY });
    removeProject(original.id);
    expect(loadBlockProvenance(original.id)).toEqual({});
    expect(loadBlockProvenance(copy.id)).toEqual({ "ex.chat-1": ENTRY });
  });

  it("a default build never reads provenance on duplicate, and still removes it on delete", () => {
    vi.stubEnv("NEXT_PUBLIC_COMPOSER_EXPERIMENTAL", "0");
    const original = createProject({ name: "A", source: { kind: "reference", referenceId: "astryx" } });
    saveBlockProvenance(original.id, { "ex.chat-1": ENTRY });
    const copy = duplicateProject(original.id)!;
    expect(loadBlockProvenance(copy.id)).toEqual({});
    removeProject(original.id);
    expect(store.getItem(blockProvenanceKey(original.id))).toBeNull();
  });
});
