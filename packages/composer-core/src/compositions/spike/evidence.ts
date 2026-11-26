/**
 * R1a evidence: every approved data set instantiated through the real
 * pipeline, written for the independent checks (levels 1a, 1b and 2) and the
 * report, plus the performance measurements against R0-REVIEW A12.
 *
 *   pnpm --filter @dspack-studio/composer-core r1a:evidence
 *
 * Writes docs/repositioning/spikes/r1a/evidence/. Deterministic apart from
 * the timing file.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { validateCatalog, emitSurface } from "@aestheticfunction/dspack-emit";
import { instantiate } from "../instantiate";
import { createHost, recheck } from "../host";
import { compositions, contract, datasets, governorFor, lint, profileJson, REPO } from "./fixtures";
import { createGovernor } from "../governance";

const OUT = `${REPO}docs/repositioning/spikes/r1a/evidence/`;
mkdirSync(OUT, { recursive: true });
const write = (name: string, value: unknown) => writeFileSync(`${OUT}${name}`, `${JSON.stringify(value, null, 2)}\n`);

const t0 = performance.now();
const g = await governorFor();
const governorMs = performance.now() - t0;
const cs = await compositions();
const ds = datasets();

write("catalog-0.9.1.json", g.catalog("0.9.1"));
write("catalog-1.0.json", g.catalog("1.0"));

// One instance per data set, plus the search composition's two states.
const cases: Array<{ id: string; composition: string; data: Record<string, unknown>; inputValues?: Record<string, string> }> = [
  { id: "search-ready", composition: "hotel-search", data: {}, inputValues: { destination: "Lisbon" } },
  { id: "search-invalid", composition: "hotel-search", data: { errors: ["Check-out must be after check-in."] }, inputValues: { destination: "Lisbon", checkIn: "2026-03-13", checkOut: "2026-03-10", guests: "2" } },
  ...Object.keys(ds).map((name) => ({ id: `results-${name}`, composition: "hotel-results", data: ds[name] })),
];
const index: unknown[] = [];
for (const [n, k] of cases.entries()) {
  const r = await instantiate(g, cs[k.composition]!, { surfaceId: `${k.composition}-evidence-${n + 1}`, data: k.data, inputValues: k.inputValues });
  const record = r.ok
    ? {
        id: k.id,
        outcome: "instance",
        composition: k.composition,
        state: r.instance.state,
        purpose: r.instance.purpose,
        surfaceId: r.instance.surfaceId,
        data: k.data,
        messages: r.instance.messages,
        actions: r.instance.actions,
        inputs: r.instance.inputs,
        inputValues: r.instance.inputValues,
        pins: r.instance.pins,
        expansionSha256: r.instance.expansionSha256,
        emittedSha256: r.instance.emittedSha256,
      }
    : { id: k.id, outcome: "refused", composition: k.composition, data: k.data, stage: r.stage, state: r.state, purpose: r.purpose, reason: r.reason, failures: r.failures ?? [] };
  write(`${k.id}.json`, record);
  index.push(r.ok ? { id: k.id, outcome: "instance", state: r.instance.state, purpose: r.instance.purpose, surfaceId: r.instance.surfaceId, buttons: r.instance.actions.length } : { id: k.id, outcome: "refused", stage: r.stage, reason: r.reason.slice(0, 200) });
}

// A recorded walk through the host, with its negative steps.
const approvals = Object.fromEntries(await Promise.all(Object.values(cs).map(async (c) => [c.id, (await recheck(g, c)).approval!] as const)));
const host = createHost({ session: "walk", governor: g, compositions: Object.values(cs) });
for (const [id, a] of Object.entries(approvals)) host.approve(id, a);
const walk: unknown[] = [];
const step = (label: string, value: any) => walk.push({ step: walk.length + 1, label, ...value });
const show = async (label: string, id: string, data: Record<string, unknown>, focused?: string) => {
  const r = await host.show(id, { data, focused });
  step(label, r.ok ? { show: r.instance.surfaceId, state: r.instance.state, carried: r.carried, focus: r.focus, batch: r.batch.map((m: any) => Object.keys(m).find((x) => x !== "version")) } : { refusedShow: r.refusal.stage, reason: r.refusal.reason, kept: r.kept?.surfaceId });
  return r;
};
const act = (label: string, event: any) => {
  const r = host.act(event);
  step(label, { action: event.name, surfaceId: event.surfaceId, context: event.context, ...(r.accepted ? { accepted: true } : { accepted: false, code: r.code, reason: r.reason }) });
  return r;
};
const s1 = await show("Search, empty", "hotel-search", {});
if (!s1.ok) throw new Error("walk");
act("Search with invalid dates and guests", { name: "search", surfaceId: s1.instance.surfaceId, sourceComponentId: "search", context: { destination: "Lisbon", checkIn: "2026-03-13", checkOut: "2026-02-30", guests: "12" } });
act("Search with check-out before check-in (field-valid; the tool rejects the pair)", { name: "search", surfaceId: s1.instance.surfaceId, sourceComponentId: "search", context: { destination: "Lisbon", checkIn: "2026-03-13", checkOut: "2026-03-10", guests: "2" } });
const s2 = await show("Search again, with the error, values and focus kept", "hotel-search", { errors: ["Check-out must be after check-in."] }, "check_out");
if (!s2.ok) throw new Error("walk");
act("A stale search from the first surface", { name: "search", surfaceId: s1.instance.surfaceId, sourceComponentId: "search", context: { destination: "Lisbon", checkIn: "2026-03-10", checkOut: "2026-03-13", guests: "2" } });
act("Search with valid values", { name: "search", surfaceId: s2.instance.surfaceId, sourceComponentId: "search", context: { destination: "Lisbon", checkIn: "2026-03-10", checkOut: "2026-03-13", guests: "2" } });
const r1 = await show("Three results", "hotel-results", ds.three);
if (!r1.ok) throw new Error("walk");
const r2 = await show("The same search returns them reordered", "hotel-results", ds.reordered, r1.instance.actions[1]!.componentId);
if (!r2.ok) throw new Error("walk");
act("The first drawn button of the replaced surface (stale)", { name: "choose", surfaceId: r1.instance.surfaceId, sourceComponentId: r1.instance.actions[0]!.componentId, context: r1.instance.actions[0]!.payload });
act("A tampered payload", { name: "choose", surfaceId: r2.instance.surfaceId, sourceComponentId: r2.instance.actions[0]!.componentId, context: { hotelId: "h-999" } });
act("A forged reservation from the results surface", { name: "reserve", surfaceId: r2.instance.surfaceId, sourceComponentId: "reserve", context: { hotelId: "h-102" } });
act("Choose the second hotel now drawn", { name: "choose", surfaceId: r2.instance.surfaceId, sourceComponentId: r2.instance.actions[1]!.componentId, context: r2.instance.actions[1]!.payload });
const c1 = await show("Confirm the reservation", "hotel-results", ds.confirm);
if (!c1.ok) throw new Error("walk");
act("Reserve", { name: "reserve", surfaceId: c1.instance.surfaceId, sourceComponentId: "reserve", context: { hotelId: "h-102" } });
act("Reserve again on the same surface", { name: "reserve", surfaceId: c1.instance.surfaceId, sourceComponentId: "reserve", context: { hotelId: "h-102" } });
await show("A result set of one", "hotel-results", ds.one);
const edited = contract();
edited.rules.find((r: any) => r.id === "rule.review-offers-alternatives").requiredSubComponents[0].min = 4;
host.setGovernor(await governorFor(edited));
await show("After an edit to a rule hotel-results depends on", "hotel-results", ds.three);
write("walk.json", { session: "walk", steps: walk, log: host.log() });

// Performance (R0-REVIEW A12): warm instantiate of a 20-item list, p95 <= 50 ms; cold <= 500 ms.
const samples = (n: number, f: () => Promise<number>) => (async () => { const out: number[] = []; for (let i = 0; i < n; i++) out.push(await f()); return out; })();
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)]!;
const time = async (f: () => Promise<unknown>) => { const s = performance.now(); await f(); return performance.now() - s; };
const coldGovernor = await createGovernor({ contract: contract(), profileJson: profileJson(), lintSurface: lint });
const coldFirst = await time(() => instantiate(coldGovernor, cs["hotel-results"]!, { surfaceId: "cold-1", data: ds.twenty }));
const warm20 = await samples(200, () => time(() => instantiate(g, cs["hotel-results"]!, { surfaceId: "warm", data: ds.twenty })));
const warm3 = await samples(200, () => time(() => instantiate(g, cs["hotel-results"]!, { surfaceId: "warm", data: ds.three })));
const stages = (await instantiate(g, cs["hotel-results"]!, { surfaceId: "stages", data: ds.twenty }));
// The uncached alternative, for comparison: dspack-emit's validateCatalog on every instance, both versions.
const uncached = await samples(30, () => time(async () => {
  const r = await instantiate(g, cs["hotel-results"]!, { surfaceId: "u", data: ds.twenty });
  if (r.ok) for (const v of g.versions) validateCatalog(g.catalog(v) as never, v, { messages: r.instance.messages });
}));
const perf = {
  machine: `node ${process.version} ${process.platform}/${process.arch}`,
  budget: { warmP95Ms: 50, coldMs: 500 },
  governorSetupMs: +governorMs.toFixed(1),
  coldFirstInstantiate20Ms: +coldFirst.toFixed(1),
  coldTotalIncludingSetupMs: +(governorMs + coldFirst).toFixed(1),
  warm20: { n: warm20.length, p50: +pct(warm20, 50).toFixed(2), p95: +pct(warm20, 95).toFixed(2), max: +Math.max(...warm20).toFixed(2) },
  warm3: { n: warm3.length, p50: +pct(warm3, 50).toFixed(2), p95: +pct(warm3, 95).toFixed(2), max: +Math.max(...warm3).toFixed(2) },
  stages20Ms: stages.ok ? Object.fromEntries(Object.entries(stages.instance.timings).map(([k, v]) => [k, +v.toFixed(2)])) : null,
  uncachedGatesWarm20: { n: uncached.length, p50: +pct(uncached, 50).toFixed(2), p95: +pct(uncached, 95).toFixed(2), note: "the same instantiation plus dspack-emit's validateCatalog for both versions, as an uncached pipeline would run" },
};
write("performance.json", perf);
write("index.json", { generated: "pnpm --filter @dspack-studio/composer-core r1a:evidence", cases: index, emitSurfaceIsTheEmitter: typeof emitSurface === "function" });
console.log(JSON.stringify({ index, perf }, null, 2));
