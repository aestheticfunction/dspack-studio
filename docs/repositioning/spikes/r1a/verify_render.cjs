/**
 * R1a verification level 2: renderer fidelity, in a real browser.
 *
 * For every exported instance, on each stack (upstream @a2ui/react 0.16.1 through the spike's bridge, and
 * Composer's own canvas on the pinned 0.10 stack), it checks what is DRAWN and what it DOES:
 *   - every governed literal of every component is drawn inside that component's own element, as visible
 *     text, or only as an accessible name or placeholder, or not at all;
 *   - every input accepts typing and keeps the value;
 *   - pressing each bound action's control sends exactly the payload the host expects, the k-th drawn
 *     "choose" button sends item k's payload, and the search sends what was typed.
 * These are claims about one renderer drawing correct messages. Level 1 covers the messages themselves.
 *
 *   node verify_render.cjs > evidence/level-2.json
 */
const { chromium } = require("playwright");
const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");

const EV = join(__dirname, "evidence");
const DIST = join(__dirname, "..", "r1a-host", "dist");
const STACKS = { "upstream-0.16.1": "fidelity-016.html", "composer-canvas-0.10": "fidelity-010.html" };
const SKIP = new Set(["id", "component", "child", "children", "action", "variant", "size", "density", "type", "as", "value", "hasDividers", "isSelected", "isDisabled", "actionVariant", "columns", "orientation"]);

const cases = readdirSync(EV)
  .filter((f) => /^(search|results)-.*\.json$/.test(f))
  .map((f) => JSON.parse(readFileSync(join(EV, f), "utf8")))
  .filter((r) => r.outcome === "instance");

function literals(component) {
  const out = [];
  const walk = (key, v) => {
    if (typeof v === "string") out.push({ prop: key, value: v });
    else if (Array.isArray(v)) v.forEach((x) => walk(key, x));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(`${key}.${k}`, x);
  };
  for (const [k, v] of Object.entries(component)) if (!SKIP.has(k)) walk(k, v);
  return out;
}

(async () => {
  const browser = await chromium.launch();
  const report = { level: 2, stacks: {} };
  for (const [stack, file] of Object.entries(STACKS)) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message.slice(0, 300)));
    const results = [];
    for (const rec of cases) {
      await page.goto(`file://${join(DIST, file)}?case=${rec.id}`);
      await page.waitForSelector("[data-a2ui-id]");
      const comps = rec.messages.flatMap((m) => m.updateComponents?.components ?? []);
      const drawn = [];
      for (const c of comps) {
        for (const lit of literals(c)) {
          const where = await page.evaluate(({ id, value }) => {
            const el = document.querySelector(`[data-a2ui-id="${CSS.escape(id)}"]`);
            if (!el) return "no-element";
            // The component's OWN content: nested components (their own data-a2ui-id elements) are not its rendering.
            const own = (root) => {
              const out = [];
              const walk = (n) => {
                for (const c of n.childNodes) {
                  if (c.nodeType === 1 && c !== root && c.hasAttribute("data-a2ui-id")) continue;
                  if (c.nodeType === 3) out.push({ text: c.textContent, el: c.parentElement });
                  else if (c.nodeType === 1) { out.push({ node: c }); walk(c); }
                }
              };
              walk(root);
              return out;
            };
            const parts = own(el);
            const visibleText = parts.filter((p) => p.text !== undefined && p.el && p.el.checkVisibility && p.el.checkVisibility()).map((p) => p.text).join(" ");
            if (visibleText.includes(value)) return "visible";
            const nodes = parts.filter((p) => p.node).map((p) => p.node);
            const attrs = nodes.flatMap((n) => ["aria-label", "placeholder", "title", "aria-description"].map((a) => n.getAttribute(a) || ""));
            const labelled = nodes.filter((n) => n.hasAttribute("aria-labelledby")).map((n) => n.getAttribute("aria-labelledby").split(" ").map((i) => document.getElementById(i)?.textContent || "").join(" "));
            const hiddenText = parts.filter((p) => p.text !== undefined).map((p) => p.text).join(" ");
            if (hiddenText.includes(value)) return "in-dom-not-visible";
            if ([...attrs, ...labelled].some((a) => a.includes(value))) return "accessible-only";
            return "missing";
          }, { id: c.id, value: lit.value });
          drawn.push({ component: `${c.component}#${c.id}`, prop: lit.prop, value: lit.value, drawn: where });
        }
      }
      // Inputs: type and keep the value.
      const typed = {};
      const inputs = [];
      for (const inp of rec.inputs) {
        const box = page.locator(`[data-a2ui-id="${inp.componentId}"] input`).first();
        const value = { destination: "Porto", checkIn: "2026-04-01", checkOut: "2026-04-04", guests: "3" }[inp.name] ?? `typed ${inp.name}`;
        await box.fill("");
        await box.pressSequentially(value);
        const kept = await box.inputValue();
        typed[inp.name] = kept;
        inputs.push({ input: inp.name, typed: value, kept, pass: kept === value });
      }
      // Actions: press each and compare with what the host expects.
      const actions = [];
      const order = await page.evaluate(() => [...document.querySelectorAll("[data-a2ui-component=Button]")].map((n) => n.getAttribute("data-a2ui-id")));
      for (const a of rec.actions) {
        await page.evaluate(() => (window.__fidelity.actions = []));
        const host = page.locator(`[data-a2ui-id="${a.componentId}"]`);
        const control = a.name === "reserve" ? host.getByRole("button", { name: /^Reserve / }) : host.getByRole("button").first();
        await control.click();
        await page.waitForTimeout(50);
        const sent = await page.evaluate(() => window.__fidelity.actions);
        const expected = { ...a.payload, ...Object.fromEntries(a.carries.map((n) => [n, typed[n]])) };
        const got = sent[0] || null;
        const ok = sent.length === 1 && got.name === a.name && got.sourceComponentId === a.componentId && got.surfaceId === rec.surfaceId && JSON.stringify(got.context) === JSON.stringify(expected);
        actions.push({ action: a.name, component: a.componentId, item: a.item ? a.item.index + 1 : null, drawnPosition: order.indexOf(a.componentId) + 1, expected, sent: got && { name: got.name, sourceComponentId: got.sourceComponentId, context: got.context }, pass: ok });
      }
      const kth = rec.actions.filter((a) => a.item).every((a) => order.filter((id) => rec.actions.some((x) => x.item && x.componentId === id)).indexOf(a.componentId) === a.item.index);
      const missing = drawn.filter((d) => d.drawn === "missing" || d.drawn === "no-element");
      const accessibleOnly = drawn.filter((d) => d.drawn === "accessible-only" || d.drawn === "in-dom-not-visible");
      results.push({
        id: rec.id,
        literals: drawn.length,
        visible: drawn.filter((d) => d.drawn === "visible").length,
        accessibleOnly,
        missing,
        inputs,
        actions,
        kthButtonIsItemK: kth,
        pass: missing.length === 0 && inputs.every((i) => i.pass) && actions.every((a) => a.pass) && kth,
      });
    }
    const unrendered = await page.evaluate(() => window.__fidelity.unrendered || []);
    report.stacks[stack] = { page: file, unrendered, pageErrors: errors, pass: results.every((r) => r.pass) && errors.length === 0, cases: results };
    await page.close();
  }
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
})();
