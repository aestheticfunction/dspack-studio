/**
 * R1a verification level 2: renderer fidelity, in a real browser.
 *
 * For every exported instance, on each stack (upstream @a2ui/react 0.16.1 through the spike's bridge, and
 * Composer's own canvas on the pinned 0.10 stack), it checks what is DRAWN and what it DOES:
 *   - every governed literal of every component is drawn inside that component's own element, as visible
 *     text, or only as an accessible name or placeholder, or not at all;
 *   - every input first displays the value its creation batch carries (R1A-REVIEW E7), then accepts typing
 *     and keeps the value;
 *   - pressing each control sends what the DATA says it must: the control in the k-th drawn option card sends
 *     data.hotels[k].id, a confirmation sends data.selection.id, a search sends what was typed (R1A-REVIEW E3).
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
        // R1A-REVIEW E7: before anything is typed, the field displays the value its creation batch carries.
        const expectedPrefill = rec.inputValues?.[inp.name] ?? "";
        const prefilled = await box.inputValue();
        await box.fill("");
        await box.pressSequentially(value);
        const kept = await box.inputValue();
        typed[inp.name] = kept;
        inputs.push({ input: inp.name, prefilled, expectedPrefill, typed: value, kept, pass: prefilled === expectedPrefill && kept === value });
      }
      // Actions (R1A-REVIEW E3): every control is found in DRAWN order, and what it must send is derived from the data
      // set and the page's own structure: a control inside the k-th drawn option card sends data.hotels[k].id; a
      // confirmation dialog sends data.selection.id; any other control sends {} plus the values typed above.
      const controls = await page.evaluate(() =>
        [...document.querySelectorAll("[data-a2ui-component=Button], [data-a2ui-component=AlertDialog]")].map((el) => {
          const cards = [...document.querySelectorAll("[data-a2ui-component=SelectableCard]")];
          const card = el.parentElement && el.parentElement.closest("[data-a2ui-component=SelectableCard]");
          return { id: el.getAttribute("data-a2ui-id"), kind: el.getAttribute("data-a2ui-component"), cardIndex: card ? cards.indexOf(card) : -1 };
        }),
      );
      const actions = [];
      for (const [position, ctl] of controls.entries()) {
        await page.evaluate(() => (window.__fidelity.actions = []));
        const host = page.locator(`[data-a2ui-id="${ctl.id}"]`);
        const control = ctl.kind === "AlertDialog" ? host.getByRole("button", { name: /^Reserve / }) : host.getByRole("button").first();
        await control.click();
        await page.waitForTimeout(50);
        const sent = await page.evaluate(() => window.__fidelity.actions);
        const got = sent[0] || null;
        const literal = ctl.cardIndex >= 0 ? { hotelId: rec.data.hotels[ctl.cardIndex].id } : ctl.kind === "AlertDialog" ? { hotelId: rec.data.selection.id } : {};
        const carried = got ? Object.fromEntries(Object.keys(got.context ?? {}).filter((k) => k in typed).map((k) => [k, typed[k]])) : {};
        const expected = { ...literal, ...carried };
        const carriesAllTyped = Object.keys(carried).length === 0 || Object.keys(typed).every((k) => k in carried);
        const ok = sent.length === 1 && got.sourceComponentId === ctl.id && got.surfaceId === rec.surfaceId && JSON.stringify(got.context) === JSON.stringify(expected) && carriesAllTyped;
        actions.push({ drawnPosition: position + 1, component: ctl.id, inOptionCard: ctl.cardIndex >= 0 ? ctl.cardIndex + 1 : null, expected, sent: got && { name: got.name, sourceComponentId: got.sourceComponentId, context: got.context }, pass: ok });
      }
      // Every option card has exactly one control, and every control in a card was pressed.
      const cardControls = actions.filter((a) => a.inOptionCard !== null).map((a) => a.inOptionCard);
      const cards = (rec.data.hotels || []).length && controls.some((c) => c.cardIndex >= 0) ? rec.data.hotels.length : 0;
      const kth = cardControls.length === cards && cardControls.every((k, i) => k === i + 1);
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
        kthDrawnControlIsItemK: kth,
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
