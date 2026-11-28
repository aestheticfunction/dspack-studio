/**
 * Transition intent in the workspace (decision 81): drafts with `leadsTo`, titles and descriptions are stored
 * and reloaded through the same validated records; a draft keeps one identity (hash) in the session and after a
 * reload; approval waits until every intended next state is reached by an example; packaged versions are
 * unchanged.
 */
import { compositionPins, setLeadsTo, setStateTitle, type CompositionDefinition } from "@dspack-studio/composer-core/compositions";
import { describe, expect, it } from "vitest";
import { approveVersion, createDraft, editDraft } from "./authoring";
import { checkVersion, governorFor, loadLibrary } from "./runtime";
import type { KeyValueStore } from "./storage";

process.env.NEXT_PUBLIC_COMPOSER_TOOLCHAIN ??= JSON.stringify({ lint: "0.0.0-test", emit: "0.0.0-test", runtime: "test" });

function memory(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}
const sha = async (c: CompositionDefinition | undefined) => (await compositionPins(c!)).compositionSha256;

describe("transition intent on this device", () => {
  it("a draft with intent and a title is stored, reloads with the same identity, and leaves the packaged versions unchanged", async () => {
    const store = memory();
    let loaded = await loadLibrary(store);
    const edit = async (f: (d: CompositionDefinition) => void) => {
      const r = await editDraft(loaded, "hotel-results", 2, f, store);
      if (!r.ok) throw new Error(r.reason);
      loaded = r.loaded;
    };
    await edit((d) => void setLeadsTo(d, "choose", ["confirm"]));
    await edit((d) => void setStateTitle(d, "confirm", "Confirm the stay"));
    const inSession = loaded.library.get("hotel-results", 2)!;
    expect(inSession.actions.find((a) => a.name === "choose")!.leadsTo).toEqual(["confirm"]);
    const reloaded = await loadLibrary(store);
    expect(reloaded.issues).toEqual([]);
    const again = reloaded.library.get("hotel-results", 2)!;
    expect(again.states[0]!.title).toBe("Confirm the stay");
    // One identity: the edited draft hashes the same in the session and after a reload.
    expect(await sha(again)).toBe(await sha(inSession));
    // The packaged approved versions are byte-identical.
    expect(await sha(reloaded.library.get("hotel-search", 1))).toBe("856b491b237bb451b422ff33d04af2cdd04b71f9de08b4f16b27ecd3c130e4f8");
    expect(await sha(reloaded.library.get("hotel-results", 1))).toBe("232a1fe4fced886cf199eef6fca846cde693cda5071be0b8737e39dfbe0ed913");
  });

  it("approval waits until every intended next state is reached by an example, even when the checks pass", async () => {
    const store = memory();
    const governor = await governorFor();
    let loaded = await loadLibrary(store);
    const edit = async (f: (d: CompositionDefinition) => void) => {
      const r = await editDraft(loaded, "hotel-results", 2, f, store);
      if (!r.ok) throw new Error(r.reason);
      loaded = r.loaded;
    };
    await edit((d) => void setLeadsTo(d, "choose", ["confirm"]));
    // Remove the only example that reaches Confirm: every remaining example still behaves as declared.
    await edit((d) => void (d.scenarios = d.scenarios.filter((s) => s.id !== "confirm")));
    const draft = loaded.library.get("hotel-results", 2)!;
    const check = await checkVersion(governor, draft, store);
    expect(check.approval).not.toBeNull();
    const refused = await approveVersion(loaded, governor, "hotel-results", 2, check, store);
    expect(refused).toEqual({ ok: false, reason: expect.stringContaining("no example reaches that state") });
    // Nothing was approved or written.
    expect((await loadLibrary(store)).library.get("hotel-results", 2)!.status).toBe("draft");
  });

  it("hotel results: with its confirm example, Choose may lead to Confirm and the draft is approved", async () => {
    const store = memory();
    const governor = await governorFor();
    let loaded = await loadLibrary(store);
    const r = await editDraft(loaded, "hotel-results", 2, (d) => void setLeadsTo(d, "choose", ["confirm"]), store);
    if (!r.ok) throw new Error(r.reason);
    loaded = r.loaded;
    const draft = loaded.library.get("hotel-results", 2)!;
    const check = await checkVersion(governor, draft, store);
    expect(check.approval).not.toBeNull();
    const approved = await approveVersion(loaded, governor, "hotel-results", 2, check, store);
    expect(approved.ok ? approved.approved.actions.find((a) => a.name === "choose")!.leadsTo : approved.reason).toEqual(["confirm"]);
    // The approved 0.3 version reloads from the versions record with the same identity.
    const reloaded = await loadLibrary(store);
    expect(reloaded.issues).toEqual([]);
    expect(await sha(reloaded.library.get("hotel-results", 2))).toBe(approved.ok ? await sha(approved.approved) : "");
  });
});
