/**
 * M1 Slice A: experimental workspace storage. Isolation from the default application, schema versioning,
 * deterministic recovery, preservation of what cannot be read, and the exclusion of sensitive values and
 * runtime state. With Slice B's approval records: evidence that never replaces itself on a failed re-check.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { approvalRecord, redactEvent, recheck } from "@dspack-studio/composer-core/compositions";
import { installedToolchain } from "../../lib/toolchain.mjs";
import { checkVersion, governorFor, hostFor, loadLibrary } from "./runtime";
import { DEFAULT_PREFS, KEYS, NAMESPACE, readRecord, VERSIONS, withApproval, writeRecord, type KeyValueStore } from "./storage";

const APP = fileURLToPath(new URL("../../", import.meta.url));
const SECRET = "SYN-LOYAL-0042";

beforeAll(() => {
  vi.stubEnv("NEXT_PUBLIC_COMPOSER_TOOLCHAIN", JSON.stringify(installedToolchain()));
});

/** A localStorage stand-in that records every key it is asked for. */
function memoryStore(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  const touched: string[] = [];
  const store: KeyValueStore & { data: Map<string, string>; touched: string[]; failWrites?: boolean; failReads?: boolean } = {
    data,
    touched,
    getItem(key) {
      touched.push(key);
      if (store.failReads) throw new Error("SecurityError");
      return data.has(key) ? data.get(key)! : null;
    },
    setItem(key, value) {
      touched.push(key);
      if (store.failWrites) {
        const e = new Error("quota");
        e.name = "QuotaExceededError";
        throw e;
      }
      data.set(key, String(value));
    },
  };
  return store;
}

const PRODUCTION = {
  "composer.projects.v1": JSON.stringify([{ id: "p1", name: "My project", source: { kind: "reference", referenceId: "astryx" } }]),
  "composer.lastProject.v1": "p1",
  "composer.experimental.v1": JSON.stringify({ blocks: true }),
};

describe("isolation from the default application", () => {
  it("no source outside the experimental directory names the workspace namespace", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (["node_modules", ".next", "out", "out-experimental", "experimental"].includes(name)) continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(m?[jt]sx?)$/.test(name) && !name.endsWith(".test.mjs") && !path.endsWith("check-default-artifact.mjs")) {
          if (readFileSync(path, "utf8").includes(NAMESPACE)) offenders.push(path.slice(APP.length));
        }
      }
    };
    walk(APP);
    expect(offenders).toEqual([]);
  });

  it("the default artifact check refuses the namespace, so a default build that carried it would fail", () => {
    expect(readFileSync(join(APP, "scripts/check-default-artifact.mjs"), "utf8")).toContain(`"${NAMESPACE}"`);
  });

  it("reads and writes only its own keys, and leaves production project data byte for byte", () => {
    const store = memoryStore(PRODUCTION);
    writeRecord("library", { ...DEFAULT_PREFS, composition: "hotel-results", version: 1 }, store);
    writeRecord("approvals", { records: [] }, store);
    writeRecord("drafts", { drafts: [] }, store);
    for (const kind of ["library", "approvals", "drafts"] as const) readRecord(kind, store);
    expect(store.touched.every((k) => k.startsWith(NAMESPACE))).toBe(true);
    for (const [k, v] of Object.entries(PRODUCTION)) expect(store.data.get(k)).toBe(v);
  });

  it("the default application's own storage code never touches the namespace", async () => {
    vi.stubEnv("NEXT_PUBLIC_COMPOSER_EXPERIMENTAL", "0");
    const store = memoryStore({ ...PRODUCTION, [KEYS.library]: "{}" });
    vi.stubGlobal("window", { localStorage: store });
    try {
      const projects = await import("../../app/projects");
      const experimental = await import("../../app/experimental");
      projects.getLastOpened();
      projects.setLastOpened("p1");
      experimental.loadExperimental();
      experimental.saveExperimental({ blocks: true });
      expect(store.touched.length).toBeGreaterThan(0);
      expect(store.touched.filter((k) => k.startsWith(NAMESPACE))).toEqual([]);
      expect(store.data.get(KEYS.library)).toBe("{}");
    } finally {
      vi.unstubAllGlobals();
      vi.stubEnv("NEXT_PUBLIC_COMPOSER_EXPERIMENTAL", "");
    }
  });
});

describe("schema versioning and recovery", () => {
  it("round-trips every record kind inside a versioned envelope", () => {
    const store = memoryStore();
    const prefs = { composition: "hotel-results", version: 2, scenario: "three", state: "ready", panel: "inspector" as const };
    expect(writeRecord("library", prefs, store)).toEqual({ ok: true });
    expect(JSON.parse(store.data.get(KEYS.library)!)).toEqual({ schema: "composer.experimental.workspace/library", version: VERSIONS.library, data: prefs });
    expect(readRecord("library", store)).toEqual({ status: "ok", value: prefs });
  });

  it("the first-run record holds one flag and nothing else (D0)", () => {
    const store = memoryStore();
    expect(readRecord("onboarding", store)).toEqual({ status: "missing", value: { dismissed: false } });
    expect(writeRecord("onboarding", { dismissed: true }, store)).toEqual({ ok: true });
    expect(readRecord("onboarding", store)).toEqual({ status: "ok", value: { dismissed: true } });
    expect(writeRecord("onboarding", { dismissed: true, seen: ["x"] } as never, store)).toMatchObject({ ok: false });
    expect(store.touched.every((k) => k.startsWith(NAMESPACE))).toBe(true);
  });

  it("the view record holds whether the Library was on screen, and nothing else (D0.1)", () => {
    const store = memoryStore();
    expect(readRecord("view", store)).toEqual({ status: "missing", value: { library: false } });
    expect(writeRecord("view", { library: true }, store)).toEqual({ ok: true });
    expect(readRecord("view", store)).toEqual({ status: "ok", value: { library: true } });
    expect(writeRecord("view", { library: true, project: "p1" } as never, store)).toMatchObject({ ok: false });
    expect(writeRecord("view", { library: "yes" } as never, store)).toMatchObject({ ok: false });
    expect(store.touched.every((k) => k.startsWith(NAMESPACE))).toBe(true);
  });

  it("missing, unavailable and malformed records give the defaults, the same way every time", () => {
    expect(readRecord("library", memoryStore())).toEqual({ status: "missing", value: DEFAULT_PREFS });
    const blocked = memoryStore();
    blocked.failReads = true;
    expect(readRecord("library", blocked)).toEqual({ status: "unavailable", value: DEFAULT_PREFS });
    expect(readRecord("library", null)).toEqual({ status: "unavailable", value: DEFAULT_PREFS });
    for (const raw of ["{not json", "[]", JSON.stringify({ schema: "something-else", version: 1, data: {} }), JSON.stringify({ schema: "composer.experimental.workspace/library", version: 1, data: { composition: 7 } })]) {
      const store = memoryStore({ [KEYS.library]: raw });
      const a = readRecord("library", store);
      expect(a).toMatchObject({ status: "malformed", value: DEFAULT_PREFS });
      expect(readRecord("library", store)).toEqual(a);
      expect(store.data.get(KEYS.library)).toBe(raw);
    }
  });

  it("a malformed record is preserved once before it is overwritten", () => {
    const store = memoryStore({ [KEYS.library]: "{broken" });
    expect(writeRecord("library", DEFAULT_PREFS, store)).toEqual({ ok: true });
    expect(store.data.get(`${KEYS.library}.preserved`)).toBe("{broken");
    store.data.set(KEYS.library, "{broken again");
    writeRecord("library", DEFAULT_PREFS, store);
    expect(store.data.get(`${KEYS.library}.preserved`)).toBe("{broken");
  });

  it("a record from another schema version is read as the defaults and never overwritten", () => {
    const newer = JSON.stringify({ schema: "composer.experimental.workspace/library", version: 2, data: { layout: "future" } });
    const store = memoryStore({ [KEYS.library]: newer });
    expect(readRecord("library", store)).toMatchObject({ status: "incompatible", found: 2, value: DEFAULT_PREFS });
    expect(writeRecord("library", DEFAULT_PREFS, store)).toMatchObject({ ok: false });
    expect(store.data.get(KEYS.library)).toBe(newer);
  });

  it("a failed write reports it and leaves what was stored", () => {
    const store = memoryStore();
    writeRecord("library", { ...DEFAULT_PREFS, composition: "hotel-search", version: 1 }, store);
    const before = store.data.get(KEYS.library);
    store.failWrites = true;
    expect(writeRecord("library", { ...DEFAULT_PREFS, composition: "hotel-results", version: 1 }, store)).toMatchObject({ ok: false });
    expect(store.data.get(KEYS.library)).toBe(before);
  });

  it("a draft is checked by the composition parser; an approved version is never stored", async () => {
    const { library } = await loadLibrary();
    const draft = library.entry("hotel-results")!.draft!;
    const store = memoryStore();
    expect(writeRecord("drafts", { drafts: [structuredClone(draft) as never] }, store)).toEqual({ ok: true });
    expect(readRecord("drafts", store)).toMatchObject({ status: "ok", value: { drafts: [{ id: "hotel-results", version: 2, status: "draft" }] } });
    expect(writeRecord("drafts", { drafts: [structuredClone(library.entry("hotel-results")!.approved) as never] }, store)).toMatchObject({ ok: false });
    expect(writeRecord("drafts", { drafts: [{ id: "x" } as never] }, store)).toMatchObject({ ok: false });
  });
});

describe("what is never stored", () => {
  it("fields outside the closed shapes are refused before writing: no session, surface, event, value or commitment", () => {
    const store = memoryStore();
    const attempts = [
      ["library", { ...DEFAULT_PREFS, sessionId: "abc" }],
      ["library", { ...DEFAULT_PREFS, scenario: SECRET }],
      ["library", { ...DEFAULT_PREFS, inputValues: { memberNumber: SECRET } }],
      ["approvals", { records: [], commitments: [] }],
      ["approvals", { records: [{ composition: "hotel-results", version: 1, surfaceId: "x" }] }],
      ["drafts", { drafts: [], lastEvent: { context: { memberNumber: SECRET } } }],
    ] as const;
    for (const [kind, value] of attempts) expect(writeRecord(kind, value as never, store), JSON.stringify(value)).toMatchObject({ ok: false });
    expect(store.data.size).toBe(0);
  });

  it("after a real Library session with a synthetic sensitive value typed, storage holds no value, id, event or commitment", async () => {
    const store = memoryStore();
    const governor = await governorFor();
    const { library } = await loadLibrary();
    const search = await checkVersion(governor, library.get("hotel-search", 1)!, store);
    const host = await hostFor(governor, search);
    const shown = await host.show("hotel-search", { data: {} });
    if (!shown.ok) throw new Error("show");
    const event = { name: "search", surfaceId: shown.instance.surfaceId, sourceComponentId: "search", context: { destination: "Lisbon", checkIn: "2026-03-10", checkOut: "2026-03-13", guests: "2", memberNumber: SECRET } };
    expect(host.act(event)).toMatchObject({ accepted: true });
    // What the Library may record of the action is its redacted form only.
    expect(JSON.stringify(redactEvent(event, shown.instance))).not.toContain(SECRET);
    const results = await checkVersion(governor, library.get("hotel-results", 1)!, store);
    const resultsHost = await hostFor(governor, results);
    const confirm = await resultsHost.show("hotel-results", { data: { destination: "Lisbon", nights: 3, hotels: [], selection: { id: "h-102", name: "Hotel Miradouro", total: 564 } } });
    if (!confirm.ok) throw new Error("confirm");
    const reserve = resultsHost.act({ name: "reserve", surfaceId: confirm.instance.surfaceId, sourceComponentId: "reserve", context: { hotelId: "h-102" } });
    if (!reserve.accepted) throw new Error("reserve");
    writeRecord("library", { composition: "hotel-results", version: 1, scenario: "confirm", state: "confirm", panel: "inspector" }, store);
    const everything = [...store.data.values()].join("\n");
    for (const forbidden of [SECRET, host.session, resultsHost.session, shown.instance.surfaceId, confirm.instance.surfaceId, reserve.commitment!.key, "pending", "memberNumber\":\"L"]) {
      expect(everything.includes(forbidden), forbidden).toBe(false);
    }
    expect(readRecord("approvals", store).value.records.map((r) => `${r.composition}@${r.version}`)).toEqual(["hotel-results@1", "hotel-search@1"]);
  });
});

describe("approval records across sessions (Slice B)", () => {
  it("a failed re-check leaves the last valid record; a passing one replaces only its own version", async () => {
    const store = memoryStore();
    const { library } = await loadLibrary();
    const v1 = library.get("hotel-results", 1)!;
    const governor = await governorFor();
    const first = await checkVersion(governor, v1, store);
    expect(first.previous).toEqual({ status: "none" });
    const recorded = store.data.get(KEYS.approvals);
    const stricter = await governorFor("four-options");
    const failed = await checkVersion(stricter, v1, store);
    expect(failed.approval).toBeNull();
    expect(failed.previous).toEqual({ status: "needs-recheck", changed: ["contract"] });
    expect(store.data.get(KEYS.approvals)).toBe(recorded);
    const again = await checkVersion(governor, v1, store);
    expect(again.previous).toEqual({ status: "current" });
    const v2 = await checkVersion(governor, library.get("hotel-results", 2)!, store);
    expect(v2.approval).not.toBeNull();
    expect(readRecord("approvals", store).value.records.map((r) => r.version)).toEqual([1, 2]);
  });

  it("withApproval keeps one record per version", async () => {
    const { library } = await loadLibrary();
    const governor = await governorFor();
    const r1 = approvalRecord((await recheck(governor, library.get("hotel-results", 1)!)).approval!);
    const r2 = approvalRecord((await recheck(governor, library.get("hotel-results", 2)!)).approval!);
    const once = withApproval(withApproval({ records: [] }, r1), r2);
    expect(withApproval(once, r1).records).toHaveLength(2);
  });
});
