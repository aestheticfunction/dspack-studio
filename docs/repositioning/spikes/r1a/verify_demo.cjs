/**
 * R1a Part B, in a real browser: the standalone demonstration (r1a-host/dist/demo.html), driven as a person
 * would drive it, on upstream @a2ui/react 0.16.1 in one long-lived renderer session.
 *
 * It checks what the unit tests cannot see:
 *   - session ids: generated in the page from the browser's cryptographic source, different on every load,
 *     and part of every surface id;
 *   - replacement in one renderer session: after every replacement exactly one surface is in the page, the
 *     new one;
 *   - retained values are DISPLAYED: after a refused search, the next surface's fields show what was typed,
 *     and the sensitive field shows nothing;
 *   - focus is APPLIED: it stays on the same control across a replacement within a composition, and moves to
 *     the canvas when the composition changes;
 *   - the consequential lifecycle: after Reserve the surface is inert and a pressed control dispatches
 *     nothing; forced events are refused (locked, duplicate with the same key); navigation is refused while
 *     the outcome is pending or unknown; a failed outcome allows a new attempt under a new key; a succeeded
 *     one releases the page;
 *   - the sensitive value typed is in no recorded place: not in the page, the host log, the messages, the
 *     host's state or browser storage; a positive control shows the search can see it while it is typed.
 * And it reports instantiation times measured in the browser, separately from the Node figures.
 *
 *   node verify_demo.cjs > evidence/level-2-demo.json
 */
const { chromium } = require("playwright");
const { join } = require("node:path");

const PAGE = `file://${join(__dirname, "..", "r1a-host", "dist", "demo.html")}`;
const SECRET = "LOYAL-BROWSER-5521";

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 300)));
  const checks = [];
  const check = (name, pass, detail = {}) => checks.push({ check: name, pass: !!pass, ...detail });

  const field = (id) => page.locator(`[data-a2ui-id="${id}"] input`).first();
  const button = (id) => page.locator(`[data-a2ui-id="${id}"] button, button[data-a2ui-id="${id}"]`).first();
  const surfaces = () => page.evaluate(() => [...document.querySelectorAll("[data-a2ui-surface]")].map((e) => e.getAttribute("data-a2ui-surface")));
  const current = () => page.evaluate(() => window.__playground.host.current()?.surfaceId ?? null);
  const logLength = () => page.evaluate(() => window.__playground.host.log().length);
  const panel = (label) => page.getByRole("button", { name: label, exact: true });
  const waitSurface = async (previous) => {
    await page.waitForFunction((prev) => {
      const id = window.__playground.host.current()?.surfaceId;
      return id && id !== prev && document.querySelector(`[data-a2ui-surface="${id}"]`);
    }, previous);
    await page.waitForTimeout(150);
  };
  const lastLog = () => page.evaluate(() => window.__playground.host.log().at(-1));

  // Session ids.
  await page.goto(PAGE);
  await field("destination").waitFor();
  const s1 = await page.evaluate(() => window.__playground.host.session);
  await page.reload();
  await field("destination").waitFor();
  const s2 = await page.evaluate(() => window.__playground.host.session);
  const first = await current();
  check("session ids are generated, 26 base32 characters, different on every load, and in every surface id", /^[a-z2-7]{26}$/.test(s1) && /^[a-z2-7]{26}$/.test(s2) && s1 !== s2 && first === `hotel-search-${s2}-1`, { sessions: [s1, s2], surface: first });

  // A refused pair of dates, then the invalid state with the values displayed.
  await field("destination").fill("Lisbon");
  await field("check_in").fill("2026-03-13");
  await field("check_out").fill("2026-03-10");
  await field("guests").fill("2");
  await field("member_number").fill(SECRET);
  const typedControl = await page.evaluate((secret) => [...document.querySelectorAll("input")].some((i) => i.value === secret), SECRET);
  check("positive control: while typed, the sensitive value is in the page, where this check can see it", typedControl);
  await button("search").click();
  await waitSurface(first);
  const invalidId = await current();
  const shownValues = {};
  for (const id of ["destination", "check_in", "check_out", "guests", "member_number"]) shownValues[id] = await field(id).inputValue();
  check("after the replacement, the fields DISPLAY the values typed, and the sensitive one displays nothing", JSON.stringify(shownValues) === JSON.stringify({ destination: "Lisbon", check_in: "2026-03-13", check_out: "2026-03-10", guests: "2", member_number: "" }), { surface: invalidId, shown: shownValues });
  check("one renderer session: exactly one surface in the page after the replacement, the new one", JSON.stringify(await surfaces()) === JSON.stringify([invalidId]), { live: await surfaces() });
  const focus1 = await page.evaluate(() => ({ component: document.activeElement?.closest("[data-a2ui-id]")?.getAttribute("data-a2ui-id") ?? null, surface: document.activeElement?.closest("[data-a2ui-surface]")?.getAttribute("data-a2ui-surface") ?? null }));
  check("focus stays on the control pressed, now on the new surface", focus1.component === "search" && focus1.surface === invalidId, focus1);

  // A valid search; results; choose; confirm.
  await field("check_out").fill("2026-03-16");
  await field("member_number").fill(SECRET);
  await button("search").click();
  await waitSurface(invalidId);
  const resultsId = await current();
  const focus2 = await page.evaluate(() => (document.activeElement?.hasAttribute("data-canvas-region") ? "canvas" : document.activeElement?.closest("[data-a2ui-id]")?.getAttribute("data-a2ui-id") ?? null));
  check("moving to another composition moves focus to the canvas region", focus2 === "canvas", { focused: focus2 });
  const choose = page.locator("[data-a2ui-component=SelectableCard]").nth(1).locator("button").first();
  await choose.click();
  await waitSurface(resultsId);
  const confirmId = await current();
  const reserve = page.locator("[data-a2ui-id=reserve] button").filter({ hasText: /^Reserve / }).first();
  await reserve.click();
  await page.waitForSelector("[data-outcome=pending]");
  const key1 = await page.getAttribute("[data-key]", "data-key");
  check("Reserve is accepted once, with an idempotency key and a pending outcome", key1 === `${confirmId}/reserve/reserve`, { key: key1 });
  check("the surface is inert and marked busy while the reservation is open", await page.evaluate(() => { const s = document.querySelector(".surface"); return s.inert === true && s.getAttribute("aria-busy") === "true"; }));

  // Pressing the surface does nothing; forced events are refused; navigation is refused.
  const before = await logLength();
  await page.locator("[data-a2ui-id=back] button").first().click({ force: true, timeout: 3000 }).catch(() => {});
  await reserve.click({ force: true, timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(200);
  check("a press on the locked surface dispatches nothing at all", (await logLength()) === before && (await current()) === confirmId, { logEntriesAdded: (await logLength()) - before });
  await panel("Send Back from this surface").click();
  const back = await lastLog();
  await panel("Send a reservation from this surface").click();
  const dup = await lastLog();
  check("forced events from the locked surface are refused: Back as locked, Reserve as a duplicate under the same key", back.code === "locked" && dup.code === "duplicate" && dup.key === key1, { back: back.code, duplicate: dup.code, key: dup.key });
  await panel("Navigate to a new search").click();
  await page.waitForTimeout(150);
  const nav = await lastLog();
  check("navigation is refused while the outcome is pending, and the surface stays", nav.code === "outcome-pending" && (await current()) === confirmId, { code: nav.code });

  // Unknown: still locked; reconcile as failed; a new attempt under a new key.
  await panel("No answer (unknown)").click();
  await page.waitForSelector("[data-outcome=unknown]");
  await panel("Navigate to a new search").click();
  await page.waitForTimeout(150);
  const nav2 = await lastLog();
  check("while the outcome is unknown, the surface stays inert and navigation is still refused", nav2.code === "outcome-pending" && (await current()) === confirmId && (await page.evaluate(() => document.querySelector(".surface").inert === true)), { code: nav2.code });
  await panel("Reconcile: it did not").click();
  await waitSurface(confirmId);
  const retryId = await current();
  check("a known failure releases the page; the new confirmation is a new surface, not locked", retryId !== confirmId && (await page.evaluate(() => document.querySelector(".surface").inert === false)) && JSON.stringify(await surfaces()) === JSON.stringify([retryId]), { surface: retryId });
  await page.locator("[data-a2ui-id=reserve] button").filter({ hasText: /^Reserve / }).first().click();
  await page.waitForSelector("[data-outcome=pending]");
  const key2 = await page.getAttribute("[data-key]", "data-key");
  check("the new attempt has its own key", key2 && key2 !== key1 && key2 === `${retryId}/reserve/reserve`, { key: key2 });
  await panel("It succeeded").click();
  await waitSurface(retryId);
  const after = await current();
  check("a succeeded outcome lets the next surface replace the locked one; the page is no longer locked", after.startsWith("hotel-search-") && (await page.evaluate(() => !document.querySelector(".surface").inert && !document.querySelector("[data-outcome]"))), { surface: after });
  const outcomes = await page.evaluate(() => window.__playground.host.commitments().map((c) => ({ key: c.key, history: c.history.map((h) => h.status) })));
  check("the host's record of both attempts", outcomes.length === 2 && JSON.stringify(outcomes[0].history) === JSON.stringify(["pending", "unknown", "failed"]) && JSON.stringify(outcomes[1].history) === JSON.stringify(["pending", "succeeded"]), { outcomes });

  // The sensitive value is recorded nowhere.
  for (const tab of ["Messages", "Host log"]) await page.getByRole("tab", { name: tab }).click();
  await page.getByRole("tab", { name: "Messages" }).click();
  const messagesText = await page.locator("[data-messages]").innerText();
  await page.getByRole("tab", { name: "Host log" }).click();
  const where = await page.evaluate((secret) => {
    const h = window.__playground.host;
    const storage = [];
    for (const s of [localStorage, sessionStorage]) for (let i = 0; i < s.length; i++) storage.push(s.key(i), s.getItem(s.key(i)));
    return {
      pageHtml: document.documentElement.outerHTML.includes(secret),
      pageText: document.body.innerText.includes(secret),
      inputValues: [...document.querySelectorAll("input")].some((i) => i.value.includes(secret)),
      hostLog: JSON.stringify(h.log()).includes(secret),
      hostState: JSON.stringify({ current: h.current(), commitments: h.commitments() }).includes(secret),
      storage: storage.join("\n").includes(secret),
    };
  }, SECRET);
  where.messagesTab = messagesText.includes(SECRET);
  const logText = await page.locator("[data-log]").innerText();
  where.logTab = logText.includes(SECRET);
  check("the sensitive value typed twice is in no recorded place: page, inputs, messages, host log, host state, storage", Object.values(where).every((v) => v === false) && logText.includes("[sensitive]"), { found: where, redactedInLog: logText.includes("[sensitive]") });

  // Browser timings, reported separately from Node.
  const timings = await page.evaluate(() => window.__playground.timings);
  const ua = await page.evaluate(() => navigator.userAgent);
  const by = {};
  for (const t of timings) (by[`${t.composition}/${t.state}`] ??= []).push(t.totalMs);
  const stats = Object.fromEntries(Object.entries(by).map(([k, xs]) => [k, { n: xs.length, maxMs: +Math.max(...xs).toFixed(2), medianMs: +[...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)].toFixed(2) }]));
  check("no page errors", errors.length === 0, { errors });

  await browser.close();
  const report = {
    level: "2, the demonstration in a browser",
    page: "r1a-host/dist/demo.html",
    browser: ua.replace(/HeadlessChrome/, "Headless Chromium"),
    checks,
    browserPerformance: { about: "Instantiation inside the page (expand, lint, emit, attach, gates), as instance.timings reports it, in this headless browser. The Node figures are in performance.json.", firstInstantiationMs: timings[0] ? +timings[0].totalMs.toFixed(2) : null, byState: stats },
    pass: checks.every((c) => c.pass),
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
})();
