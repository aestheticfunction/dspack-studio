/**
 * R1a, R1A-REVIEW E4: the recorded walk replayed through ONE long-lived processor of upstream
 * @a2ui/web_core 0.16.1 (the processor the standalone host renders with), headless.
 *
 * For every step: the batch (deleteSurface for the surface before, then the new creation batch) is accepted;
 * exactly one surface is live afterwards, the new one; and the first option card's control, dispatched through
 * upstream's own ComponentContext, sends data.hotels[0].id from that step's data.
 *
 *   node verify-walk.mjs ../r1a/evidence > ../r1a/evidence/level-1-web-core-walk.json
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Catalog, ComponentContext, MessageProcessor } from "@a2ui/web_core/v0_9";

const dir = process.argv[2];
const catalog = Catalog.fromJson(JSON.parse(readFileSync(join(dir, "catalog-0.9.1.json"), "utf8")), "0.9");
const walk = JSON.parse(readFileSync(join(dir, "replacement-walk.json"), "utf8"));
const sent = [];
const processor = new MessageProcessor([catalog], async (action) => sent.push(structuredClone(action)));

const descendants = (comps, root) => {
  const out = [];
  const visit = (id) => {
    if (out.includes(id)) return;
    out.push(id);
    const c = comps.get(id);
    if (!c) return;
    if (typeof c.child === "string") visit(c.child);
    if (Array.isArray(c.children)) c.children.filter((x) => typeof x === "string").forEach(visit);
  };
  visit(root);
  return out;
};

const steps = [];
for (const step of walk.steps) {
  const entry = { label: step.label, surfaceId: step.surfaceId };
  try {
    processor.processMessages(structuredClone(step.batch));
  } catch (error) {
    steps.push({ ...entry, pass: false, error: String(error?.message ?? error).slice(0, 300) });
    break;
  }
  const live = [...processor.model.surfacesMap.keys()].sort();
  entry.live = live;
  let ok = live.length === 1 && live[0] === step.surfaceId;
  const comps = new Map();
  for (const m of step.batch) for (const c of m.updateComponents?.components ?? []) comps.set(c.id, c);
  const list = [...comps.values()].find((c) => c.component === "List" && Array.isArray(c.children));
  if (list && step.data.hotels?.length) {
    const button = descendants(comps, list.children[0]).find((id) => comps.get(id)?.action);
    const surface = processor.model.getSurface(step.surfaceId);
    sent.length = 0;
    await new ComponentContext(surface, button).dispatchAction(surface.componentsModel.get(button).properties.action);
    await new Promise((r) => setTimeout(r, 10));
    entry.pressed = button;
    entry.sent = sent[0]?.action?.context ?? sent[0]?.context ?? null;
    entry.expected = { hotelId: step.data.hotels[0].id };
    ok = ok && JSON.stringify(entry.sent) === JSON.stringify(entry.expected);
  }
  entry.pass = ok;
  steps.push(entry);
}
const report = { implementation: "@a2ui/web_core 0.16.1, one MessageProcessor for the whole walk", steps, pass: steps.length === walk.steps.length && steps.every((s) => s.pass) };
console.log(JSON.stringify(report, null, 2));
process.exit(report.pass ? 0 : 1);
