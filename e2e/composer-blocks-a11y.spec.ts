/**
 * Accessibility of the rendered interface blocks on the Astryx beta path
 * (Phase 2 step 6; docs/blocks/PHASE-2-RELEASE-PLAN.md, §10). The target is
 * WCAG 2.2 AA; docs/blocks/ACCESSIBILITY.md records what these specs prove and
 * what still needs a person.
 *
 * Each spec builds one block through the hosted path with a stubbed gateway
 * (no model is called) and checks the native Astryx surface: axe (WCAG 2.0,
 * 2.1 and 2.2, A and AA), headings, table names, keyboard order, focus
 * indicators (in forced colors too), focus kept clear of the sticky header,
 * target size, content that overlaps other content, and, at 640 x 512 and
 * 320 x 256 (200% and 400% zoom of a 1280 x 1024 window) and 320 x 720,
 * reflow and text spacing. A data table may scroll inside its own focusable
 * region, the SC 1.4.10 exception for content that needs two-dimensional
 * layout; nothing else may.
 *
 * The calls are each block's approved example and three boundary calls: the
 * smallest valid call, every optional prop at its maximum length and count,
 * and the same with every string one unbroken token (a URL, an id). Preview,
 * which the canvas rules reach too, gets a subset: an accepted block's
 * heading, axe, focus ring, layout and keyboard pass, and every Astryx
 * reference surface's axe and layout at every size, as do two model-shaped
 * surfaces the blocks never produce (dialogs, a children-mode table).
 *
 * The shadcn/ui v3 scans at the end only report and never fail: shadcn/ui v3
 * blocks are withheld from the beta.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

type Json = Record<string, any>;
type Variant = "example" | "min" | "max" | "long-token";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const CANVAS = '[data-testid="build-canvas-1"]';
const SWITCH_ON = { enabled: true, references: ["shadcn", "astryx"], blocks: ["records-table", "auth-form", "guide-steps"] };
const sidecar = (file: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../apps/composer/experimental/blocks/${file}`, import.meta.url)), "utf8")) as Json;
const ASTRYX = sidecar("astryx.blocks.json");
const SHADCN = sidecar("shadcn-v3.blocks.json");
const blockOf = (s: Json, id: string) => (s.blocks as Json[]).find((b) => b.id === id)!;

// ---- Calls -----------------------------------------------------------------

const LOREM = "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore ";
/** Words filling exactly `n` characters. */
const words = (n: number) => {
  let s = "";
  while (s.length < n) s += LOREM;
  return s.slice(0, n).replace(/\s$/, "x");
};
/** One unbroken token of exactly `n` characters. */
const token = (n: number) => "averyveryverylongunbrokentoken".repeat(Math.ceil(n / 30)).slice(0, n);

const propOf = (b: Json, name: string) => (b.props as Json[]).find((p) => p.name === name)!;
const itemOf = (b: Json, name: string, inner: string) => (propOf(b, name).items.props as Json[]).find((p) => p.name === inner)!;

/** A valid call for `b`: its approved example, or a boundary call built from its own prop limits. */
function callFor(b: Json, variant: Variant): Json {
  if (variant === "example") return b.examples[0].call;
  const head = { block: b.id, version: b.version };
  const text = (spec: Json) => (variant === "long-token" ? token : words)(spec.maxLength);
  const all = (name: string) => propOf(b, name).items.values as string[];
  if (b.id === "records-table") {
    if (variant === "min") return { ...head, title: "T", caption: "C", columns: ["c"], rows: [{ cells: ["x"] }] };
    const n = propOf(b, "columns").maxItems as number;
    const column = propOf(b, "columns").items;
    const cell = itemOf(b, "rows", "cells").items;
    const tones = itemOf(b, "rows", "tone").values as string[];
    return {
      ...head,
      title: text(propOf(b, "title")),
      caption: text(propOf(b, "caption")),
      columns: Array.from({ length: n }, (_, i) => `${i + 1} ${text(column)}`.slice(0, column.maxLength)),
      rows: Array.from({ length: propOf(b, "rows").maxItems }, (_, r) => ({
        cells: Array.from({ length: n }, (_, c) => `${r + 1}.${c + 1} ${text(cell)}`.slice(0, cell.maxLength)),
        tone: tones[r % tones.length],
      })),
      statusColumn: Math.min(propOf(b, "statusColumn").maximum, n),
      description: text(propOf(b, "description")),
      actions: all("actions"),
    };
  }
  if (b.id === "auth-form") {
    if (variant === "min") return { ...head, mode: "reset", title: "T", fields: ["email"] };
    return { ...head, mode: "sign-up", title: text(propOf(b, "title")), fields: all("fields"), intro: text(propOf(b, "intro")), providers: all("providers"), recovery: true };
  }
  if (variant === "min") return { ...head, title: "T", steps: ["x"] };
  return {
    ...head,
    title: text(propOf(b, "title")),
    steps: Array.from({ length: propOf(b, "steps").maxItems }, () => text(propOf(b, "steps").items)),
    summary: text(propOf(b, "summary")),
    items: Array.from({ length: propOf(b, "items").maxItems }, () => text(propOf(b, "items").items)),
    itemsHeading: text(propOf(b, "itemsHeading")),
    meta: Array.from({ length: propOf(b, "meta").maxItems }, () => ({ label: text(itemOf(b, "meta", "label")), detail: text(itemOf(b, "meta", "detail")) })),
    actions: all("actions"),
  };
}

/** A table's scroll region is named by its columns. */
const tableName = (columns: string[]) => `Table: ${columns.join(", ")}`;

/** The approved templates' fixed labels (docs/blocks/HOST-ACTIONS.md). */
const LABELS: Record<string, Record<string, string>> = {
  records: { create: "New record", export: "Export", refresh: "Refresh" },
  field: { email: "Email address", password: "Password", name: "Full name", username: "Username" },
  submit: { "sign-in": "Sign in", "sign-up": "Create account", reset: "Send reset link" },
  provider: { google: "Continue with Google", github: "Continue with GitHub", microsoft: "Continue with Microsoft", apple: "Continue with Apple" },
  guide: { start: "Start", save: "Save guide" },
};
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every keyboard stop the call's surface should have, in order, by accessible name. */
function tabStops(blockId: string, call: Json): Array<string | RegExp> {
  if (blockId === "records-table") return [tableName(call.columns), ...(call.actions ?? []).map((a: string) => LABELS.records![a]!)];
  if (blockId === "auth-form")
    return [
      // A field's name is its label, then Astryx's visible "Required".
      ...(call.fields as string[]).map((f) => new RegExp(`^${escape(LABELS.field![f]!)}( Required)?$`)),
      LABELS.submit![call.mode]!,
      ...(call.recovery ? ["Forgot password?"] : []),
      ...(call.providers ?? []).map((p: string) => LABELS.provider![p]!),
    ];
  return [
    ...(call.items?.length ? [tableName([call.itemsHeading ?? "What you need"])] : []),
    tableName(["Step", "Instruction"]),
    ...(call.actions ?? []).map((a: string) => LABELS.guide![a]!),
  ];
}

// ---- Building a block --------------------------------------------------------

const MODEL = "claude-haiku-4-5-20251001";
const ok = (json: unknown) => ({ status: 200, body: { json, raw: JSON.stringify(json), model: MODEL, usage: { inputTokens: 1000, outputTokens: 50 }, calls: [{ inputTokens: 1000, outputTokens: 50, outcome: "ok", durationMs: 400, model: MODEL }] } });

/** A new project on `reference`, opened on Build. */
async function openProject(page: Page, reference: "astryx" | "shadcn", name: string) {
  await page.addInitScript(INSTALL_HELPERS);
  await page.goto("/");
  await page.getByTestId("nav-projects").click();
  await page.getByTestId("new-project-name").fill(name);
  await page.getByTestId(`new-source-${reference}`).click();
  await page.getByTestId("new-project-create").click();
  await expect(page.getByTestId("build-prompt")).toBeVisible();
}

/** A new project on `reference`, and one hosted build whose planner picks `block` and whose block call is `call`. */
async function buildBlock(page: Page, reference: "astryx" | "shadcn", block: Json, call: Json) {
  await page.addInitScript(() => localStorage.setItem("composer.experimental.v1", JSON.stringify({ blocks: true })));
  await page.route("**/api/models", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ models: ["scripted", "hosted-ai"], blocks: SWITCH_ON }) }));
  await page.route("**/api/propose", (route) => {
    const schema = ((JSON.parse(route.request().postData() ?? "{}") as Json).jsonSchema ?? {}) as Json;
    const kind = "$defs" in schema ? "generation" : schema.properties?.block?.const || schema.anyOf ? "block" : "plan";
    // A generation request would mean the block did not expand: fail it loudly.
    const reply =
      kind === "plan"
        ? ok({ intent: block.intents[0], feasible: true, restated: "A surface.", reason: "it fits", block: block.id, blockReason: "it fits" })
        : kind === "block"
          ? ok(call)
          : { status: 502, body: { error: "provider-unavailable", cause: "provider", message: "not expected", usage: null, calls: [] } };
    return route.fulfill({ status: reply.status, contentType: "application/json", body: JSON.stringify(reply.body) });
  });
  await openProject(page, reference, `${reference} ${block.id}`);
  await page.getByTestId("build-model").selectOption("hosted-ai");
  await page.getByTestId("build-prompt").fill(`a ${block.id} surface`);
  await page.getByTestId("build-run").click();
  await expect(page.getByTestId("build-block-1")).toContainText(`block ${block.id} v${block.version}`, { timeout: 30_000 });
  await expect(page.getByTestId("build-block-1")).toContainText("expanded");
  await expect(page.locator(CANVAS)).toBeVisible();
}

// ---- Checks ------------------------------------------------------------------

/**
 * Color arithmetic for the in-page checks, installed before the app loads:
 * WCAG relative luminance, with a translucent color composited over what lies
 * beneath it (an element's background over its ancestors', then white).
 */
const INSTALL_HELPERS = () => {
  type RGBA = [number, number, number, number];
  const parse = (c: string): RGBA | null => {
    const m = c.match(/^rgba?\(([^)]+)\)$/);
    if (!m) return null;
    const [r, g, b, a] = m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
    return [r!, g!, b!, a ?? 1];
  };
  const over = (top: RGBA, base: RGBA): RGBA => {
    const a = top[3];
    return [top[0] * a + base[0] * (1 - a), top[1] * a + base[1] * (1 - a), top[2] * a + base[2] * (1 - a), 1];
  };
  const background = (node: Element | null): RGBA => {
    const layers: RGBA[] = [];
    for (let n = node; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor) ?? [0, 0, 0, 0];
      if (c[3] > 0) layers.push(c);
      if (c[3] >= 1) break;
    }
    return layers.reverse().reduce<RGBA>((base, top) => over(top, base), [255, 255, 255, 1]);
  };
  const lum = ([r, g, b]: RGBA) =>
    [r, g, b].map((v) => v / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
  /** Contrast of a (possibly translucent) color drawn over `node`'s background; null when the color cannot be read. */
  const contrastOver = (color: string, node: Element | null): number | null => {
    const c = parse(color);
    if (!c) return null;
    const bg = background(node);
    const [x, y] = [lum(over(c, bg)), lum(bg)];
    return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100;
  };
  /**
   * Every line of text in a canvas, sampled across its width and height:
   * text that another element in the canvas draws over, or that a box which
   * does not scroll cuts off. Text in a scroll container (a table's region)
   * may be scrolled out of view; text a screen-reader-only style hides is
   * skipped. Each line is scrolled into view before it is sampled, and every
   * element in the canvas is hit-tested, even one that ignores the pointer
   * (a cover that lets clicks through still hides what is under it).
   */
  const coveredText = (sel: string): string[] => {
    const canvas = document.querySelector(sel)!;
    const hitTestAll = document.createElement("style");
    hitTestAll.textContent = `${sel} * { pointer-events: auto !important; }`;
    document.head.append(hitTestAll);
    const describe = (el: Element) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} "${(el.textContent ?? "").trim().slice(0, 20)}"`;
    const visuallyHidden = (el: Element) => {
      for (let a: Element | null = el; a && a !== canvas; a = a.parentElement) {
        if (getComputedStyle(a).display === "contents") continue;
        const r = a.getBoundingClientRect();
        if (r.width <= 1 || r.height <= 1) return true;
      }
      return false;
    };
    const out = new Set<string>();
    const walker = document.createTreeWalker(canvas, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent ?? "").trim().slice(0, 30);
      const p = n.parentElement;
      if (!text || !p || visuallyHidden(p)) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const lines = () => Array.from(range.getClientRects()).filter((r) => r.width > 2 && r.height > 2);
      const first = lines()[0];
      if (!first) continue;
      if (first.top < 0 || first.bottom > innerHeight || first.left < 0 || first.right > innerWidth) p.scrollIntoView({ block: "center", inline: "nearest" });
      for (let i = 0; lines()[i]; i++) {
        let r = lines()[i]!;
        // A text taller than the window runs past it: bring each of its lines to the middle.
        if (r.top < 0 || r.bottom > innerHeight) {
          window.scrollBy(0, r.top + r.height / 2 - innerHeight / 2);
          r = lines()[i]!;
        }
        for (const fx of [0.1, 0.5, 0.9])
          for (const fy of [0.25, 0.5, 0.75]) {
            const [x, y] = [r.left + r.width * fx, r.top + r.height * fy];
            if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
            const hit = document.elementFromPoint(x, y);
            if (!hit || hit === p || p.contains(hit)) continue;
            if (hit.contains(p)) {
              // The point shows an ancestor: the text is cut off there, by the nearest box that clips it.
              for (let a: Element | null = p; a && a !== hit; a = a.parentElement) {
                const cs = getComputedStyle(a);
                const box = a.getBoundingClientRect();
                if ((cs.overflowX === "visible" && cs.overflowY === "visible") || (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom)) continue;
                if (!/auto|scroll/.test(cs.overflowX + cs.overflowY)) out.add(`"${text}" is cut off by ${describe(a)}`);
                break;
              }
              continue;
            }
            if (canvas.contains(hit)) out.add(`"${text}" is drawn over by ${describe(hit)}`);
          }
      }
    }
    hitTestAll.remove();
    return [...out].slice(0, 12);
  };
  (window as any).__a11y = { contrastOver, coveredText };
};

/** axe over one canvas, with violations made readable. */
async function axeOn(page: Page, include = CANVAS) {
  const result = await new AxeBuilder({ page }).withTags(TAGS).include(include).analyze();
  return {
    violations: result.violations.map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 3).map((n) => `${n.target.join(" ")}: ${n.failureSummary}`) })),
    incomplete: result.incomplete,
  };
}

/**
 * The color-contrast nodes axe could not decide. Text that another element in
 * the canvas covers is a failure: its contrast cannot be met, and what it says
 * is lost. Any other undecided text (a decorative separator, a scrolled cell)
 * is decided here from computed colors, by the same thresholds.
 */
async function undecidedContrast(page: Page, incomplete: Array<{ id: string; nodes: Array<{ target: unknown[]; any: Array<{ data?: { messageKey?: string } }> }> }>, sel = CANVAS) {
  const nodes = incomplete
    .filter((r) => r.id === "color-contrast")
    .flatMap((r) => r.nodes.map((n) => ({ target: String(n.target[0]), overlap: n.any.some((a) => a.data?.messageKey === "bgOverlap") })));
  return page.evaluate(
    ({ nodes, sel }) => {
      const canvas = document.querySelector(sel)!;
      const describe = (el: Element) => `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 30)}"`;
      return nodes.map(({ target, overlap }) => {
        const el = document.querySelector(target);
        if (!el) return { sel: `${target} (not found)`, ratio: 0, needed: 4.5 };
        if (overlap) {
          el.scrollIntoView({ block: "center" });
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (hit && !el.contains(hit) && canvas.contains(hit)) return { sel: `${target} is covered by ${describe(hit)}`, ratio: 0, needed: 4.5 };
        }
        const cs = getComputedStyle(el);
        const size = parseFloat(cs.fontSize);
        const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
        return { sel: target, ratio: (window as any).__a11y.contrastOver(cs.color, el) ?? 0, needed: large ? 3 : 4.5 };
      });
    },
    { nodes, sel },
  );
}

/**
 * The focused element's indicator, and whether any of it is visible: an
 * outline on the element or on the Astryx field around it, else the field's
 * border. Contrast is against what the indicator touches (SC 1.4.11), and an
 * indicator is visible when a point of the element is not covered by another
 * element, such as the sticky header (SC 2.4.11).
 */
async function focused(page: Page, sel = CANVAS) {
  return page.evaluate((sel) => {
    const el = document.activeElement as HTMLElement;
    const canvas = document.querySelector(sel)!;
    const { contrastOver } = (window as any).__a11y;
    // Sample the part of the element inside the viewport: a table region can be taller than the screen.
    const r = el.getBoundingClientRect();
    const [left, top, right, bottom] = [Math.max(r.left, 0), Math.max(r.top, 0), Math.min(r.right, innerWidth), Math.min(r.bottom, innerHeight)];
    let hits = 0;
    if (right > left && bottom > top)
      for (const fx of [0.1, 0.5, 0.9])
        for (const fy of [0.1, 0.5, 0.9]) {
          const hit = document.elementFromPoint(left + (right - left) * fx, top + (bottom - top) * fy);
          if (hit && (hit === el || el.contains(hit))) hits++;
        }
    const base = { inCanvas: canvas.contains(el), tag: el.tagName, visiblePoints: hits };
    const field = el.closest(".astryx-text-input");
    for (const node of [el, field]) {
      if (!node) continue;
      const s = getComputedStyle(node);
      if (s.outlineStyle === "none" || parseFloat(s.outlineWidth) <= 0) continue;
      const inset = parseFloat(s.outlineOffset) < 0;
      return { ...base, kind: "outline", style: s.outlineStyle, width: parseFloat(s.outlineWidth), color: s.outlineColor, contrast: contrastOver(s.outlineColor, inset ? node : node.parentElement) ?? 0 };
    }
    if (field) {
      const s = getComputedStyle(field);
      return { ...base, kind: "field-border", style: s.borderTopStyle, width: parseFloat(s.borderTopWidth), color: s.borderTopColor, contrast: Math.min(contrastOver(s.borderTopColor, field) ?? 0, contrastOver(s.borderTopColor, field.parentElement) ?? 0) };
    }
    return { ...base, kind: "none", style: "none", width: 0, color: "", contrast: 0 };
  }, sel);
}

/** The unfocused border color of every Astryx field in a canvas, in order. */
const fieldBorders = (page: Page, sel: string) => page.locator(`${sel} .astryx-text-input`).evaluateAll((els) => els.map((e) => getComputedStyle(e).borderTopColor));

/**
 * Start sequential focus navigation at a canvas, as a click in its padding
 * would, but from script: a header covering the canvas must fail the checks
 * below, not block a click. The canvas takes focus only from script
 * (tabindex -1), so Tab and Shift+Tab never stop on it.
 */
const startAtCanvas = (page: Page, sel: string) =>
  page.evaluate((sel) => {
    const canvas = document.querySelector<HTMLElement>(sel)!;
    canvas.tabIndex = -1;
    canvas.focus({ preventScroll: true });
  }, sel);
const endAtCanvas = (page: Page, sel: string) => page.evaluate((sel) => document.querySelector(sel)!.removeAttribute("tabindex"), sel);
const focusIn = (page: Page, sel: string) => page.evaluate((sel) => document.querySelector(sel)!.contains(document.activeElement), sel);

/**
 * Tab forward through a canvas, then Shift+Tab back: every stop, in order,
 * with an indicator a reader can see, and focus leaves at both ends (no trap).
 * In forced colors the system chooses every color, so an indicator must be an
 * outline there: a field's border color change does not survive.
 */
async function traverse(page: Page, stops: Array<string | RegExp>, { names, at, sel = CANVAS, forced = false }: { names: boolean; at: string; sel?: string; forced?: boolean }) {
  await startAtCanvas(page, sel); // also takes focus off any field, so its border reads unfocused
  expect(await focusIn(page, sel), `${at}: focus starts at the canvas`).toBe(true);
  const unfocused = await fieldBorders(page, sel);
  const failures: string[] = [];
  const check = async (label: string) => {
    const f = await focused(page, sel);
    if (!f.inCanvas) return failures.push(`${label}: focus is outside the canvas`);
    if (f.visiblePoints === 0) failures.push(`${label}: the focused ${f.tag} is entirely hidden (SC 2.4.11)`);
    if (f.kind === "none" || f.style === "auto") failures.push(`${label}: no indicator of its own on ${f.tag} (${f.style})`);
    if (forced) {
      if (f.kind !== "outline") failures.push(`${label}: no outline on ${f.tag} in forced colors`);
      return;
    }
    if (f.contrast < 3) failures.push(`${label}: indicator ${f.color} is ${f.contrast}:1 (SC 1.4.11 needs 3:1)`);
    if (f.kind === "outline" && f.width < 2) failures.push(`${label}: outline is ${f.width}px`);
    // The config's reduced motion makes Astryx's border transition instant, so the color reads settled.
    if (f.kind === "field-border" && unfocused.includes(f.color)) failures.push(`${label}: the field border does not change on focus`);
  };
  for (const [i, stop] of stops.entries()) {
    await page.keyboard.press("Tab");
    if (names) await expect.soft(page.locator(":focus"), `${at}: stop ${i + 1}`).toHaveAccessibleName(stop);
    await check(`Tab ${i + 1}`);
  }
  await page.keyboard.press("Tab");
  expect.soft(await focusIn(page, sel), `${at}: Tab leaves the canvas after its last stop`).toBe(false);
  await page.keyboard.press("Shift+Tab");
  await check(`back to stop ${stops.length}`);
  for (let i = stops.length - 1; i > 0; i--) {
    await page.keyboard.press("Shift+Tab");
    if (names) await expect.soft(page.locator(":focus"), `${at}: back to stop ${i}`).toHaveAccessibleName(stops[i - 1]!);
    await check(`Shift+Tab to stop ${i}`);
  }
  await page.keyboard.press("Shift+Tab");
  expect.soft(await focusIn(page, sel), `${at}: Shift+Tab leaves the canvas before its first stop`).toBe(false);
  expect.soft(failures, `${at}: focus`).toEqual([]);
  await endAtCanvas(page, sel);
}

/**
 * What would make a reader scroll sideways or lose content: the page wider
 * than the viewport; anything in the canvas outside the canvas, except what a
 * table's own scroll region holds; an element that hides its overflow and
 * cuts content off; a box other than a table's region that scrolls its own
 * content; one part of a surface drawn over the next (each Astryx stack's
 * children, through display: contents wrappers); text drawn over or cut off,
 * line by line; and a table column crushed below its floor.
 */
async function reflow(page: Page, sel = CANVAS) {
  return page.evaluate((sel) => {
    const canvas = document.querySelector(sel) as HTMLElement;
    const c = canvas.getBoundingClientRect();
    const regions = Array.from(canvas.querySelectorAll<HTMLElement>(".astryx-table-scroll-wrapper"));
    const inRegion = (el: Element) => regions.some((s) => s !== el && s.contains(el));
    const describe = (el: Element) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} "${(el.textContent ?? "").trim().slice(0, 30)}"`;
    const outside: string[] = [];
    const clipped: string[] = [];
    const scrollers: string[] = [];
    for (const el of Array.from(canvas.querySelectorAll<HTMLElement>("*"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (!inRegion(el) && (r.right > c.right + 1 || r.left < c.left - 1)) outside.push(describe(el));
      const cs = getComputedStyle(el);
      if (regions.includes(el)) continue; // the region scrolls; its content is checked by the rules above and below
      const overX = el.scrollWidth > el.clientWidth + 1;
      const overY = el.scrollHeight > el.clientHeight + 1;
      const hides = (o: string) => o === "hidden" || o === "clip";
      const scrolls = (o: string) => o === "auto" || o === "scroll";
      if ((hides(cs.overflowX) && overX) || (hides(cs.overflowY) && overY)) clipped.push(describe(el));
      if ((scrolls(cs.overflowX) && overX) || (scrolls(cs.overflowY) && overY)) scrollers.push(describe(el));
    }
    const laidOut = (el: Element): Element[] =>
      Array.from(el.children).flatMap((k) => (getComputedStyle(k).display === "contents" ? laidOut(k) : [k]));
    const overlaps: string[] = [];
    for (const stack of Array.from(canvas.querySelectorAll(".astryx-stack"))) {
      const across = stack.classList.contains("horizontal");
      const kids = laidOut(stack).filter((k) => k.getBoundingClientRect().height > 0);
      for (let i = 1; i < kids.length; i++) {
        const [a, b] = [kids[i - 1]!.getBoundingClientRect(), kids[i]!.getBoundingClientRect()];
        const by = across ? a.right - b.left : a.bottom - b.top;
        if (by > 0.5) overlaps.push(`${describe(kids[i - 1]!)} overlaps ${describe(kids[i]!)} by ${Math.round(by)}px`);
      }
    }
    const crushed = Array.from(canvas.querySelectorAll("th"))
      .filter((th) => th.getBoundingClientRect().width < 90)
      .map((th) => `${describe(th)} is ${Math.round(th.getBoundingClientRect().width)}px`);
    return {
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      canvasOverflow: canvas.scrollWidth - canvas.clientWidth,
      outside: outside.slice(0, 8),
      clipped: clipped.slice(0, 8),
      scrollers: scrollers.slice(0, 8),
      overlaps: overlaps.slice(0, 8),
      crushed: crushed.slice(0, 8),
      // Last, since it scrolls each text into view.
      covered: (window as any).__a11y.coveredText(sel) as string[],
    };
  }, sel);
}
const FITS = { pageOverflow: 0, canvasOverflow: 0, outside: [], clipped: [], scrollers: [], overlaps: [], crushed: [], covered: [] };

/** WCAG's text-spacing test values (SC 1.4.12). */
const TEXT_SPACING = "* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }";

/** Reflow with WCAG's text spacing applied: nothing cut off, pushed out, scrolled in a box or drawn over. */
async function spaced(page: Page, sel = CANVAS) {
  const style = await page.addStyleTag({ content: TEXT_SPACING });
  const r = await reflow(page, sel);
  await style.evaluate((e) => (e as Element).remove());
  return { clipped: r.clipped, outside: r.outside, scrollers: r.scrollers, overlaps: r.overlaps, covered: r.covered };
}
const SPACED_FITS = { clipped: [], outside: [], scrollers: [], overlaps: [], covered: [] };

/** axe's violations, and every contrast it left undecided, decided here (see undecidedContrast). */
async function axeAndContrast(page: Page, at: string, include = CANVAS) {
  const scan = await axeOn(page, include);
  expect.soft(scan.violations, `axe ${at}`).toEqual([]);
  for (const node of await undecidedContrast(page, scan.incomplete as never, include)) expect.soft(node.ratio, `contrast axe left undecided ${at}: ${node.sel}`).toBeGreaterThanOrEqual(node.needed);
}

/** Every keyboard stop's target, at least 24 by 24 px; a field's target is the field around its input, and pressing it focuses the input. */
async function targets(page: Page) {
  const small: string[] = [];
  const stops = page.locator(`${CANVAS} button, ${CANVAS} .astryx-table-scroll-wrapper, ${CANVAS} .astryx-text-input`);
  for (const box of await stops.evaluateAll((els) => els.map((e) => ({ tag: e.tagName, name: (e.textContent ?? "").trim().slice(0, 24), ...e.getBoundingClientRect().toJSON() })))) {
    if (box.width < 24 || box.height < 24) small.push(`${box.tag} "${box.name}" is ${Math.round(box.width)}x${Math.round(box.height)}`);
  }
  const fields = page.locator(`${CANVAS} .astryx-text-input`);
  for (let i = 0; i < (await fields.count()); i++) {
    await fields.nth(i).click({ position: { x: 3, y: 3 } });
    if (!(await fields.nth(i).locator("input").evaluate((e) => e === document.activeElement))) small.push(`field ${i + 1}: pressing its edge does not focus the input`);
  }
  return small;
}

/** 200% and 400% zoom of a 1280 x 1024 window, and a tall 320 px screen. */
const NARROW = [
  [640, 512],
  [320, 720],
  [320, 256],
] as const;

async function resize(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([width, height]);
}

// ---- The Astryx blocks -----------------------------------------------------

const VARIANTS: Variant[] = ["example", "min", "max", "long-token"];

for (const blockId of ["records-table", "auth-form", "guide-steps"]) {
  const block = blockOf(ASTRYX, blockId);
  for (const variant of VARIANTS) {
    test(`Astryx ${blockId}, ${variant} call: WCAG 2.2 AA in the rendered surface`, async ({ page }) => {
      test.setTimeout(240_000);
      const call = callFor(block, variant);
      const stops = tabStops(blockId, call);
      await page.setViewportSize({ width: 1280, height: 900 });
      await buildBlock(page, "astryx", block, call);
      const canvas = page.locator(CANVAS);

      // Each check is soft, so one run reports every defect it finds.
      // Semantics: the title is the surface's one heading, and each table's region is named by its columns.
      await expect.soft(canvas.getByRole("heading"), "headings").toHaveCount(1);
      await expect.soft(canvas.getByRole("heading", { level: 2 }), "the title's heading").toHaveAccessibleName(call.title);
      const regions = await canvas.getByRole("group").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
      expect.soft(regions, "table names").toEqual(stops.filter((s): s is string => typeof s === "string" && s.startsWith("Table: ")));

      // axe at 1280 px, every contrast it could not decide, and layout.
      await axeAndContrast(page, "at 1280 px");
      expect.soft(await reflow(page), "layout at 1280 px").toEqual(FITS);

      // Keyboard: every stop in order, a visible indicator with 3:1, no trap; targets of 24 px.
      await traverse(page, stops, { names: true, at: "1280 px" });
      expect.soft(await targets(page), "target size").toEqual([]);

      // Astryx's reset declares light and dark, so the surface follows a reader's dark preference: axe and focus again.
      await page.emulateMedia({ colorScheme: "dark" });
      await axeAndContrast(page, "in dark");
      await traverse(page, stops, { names: false, at: "1280 px, dark" });
      // Forced colors (Windows high contrast): every stop keeps an indicator the system can draw.
      await page.emulateMedia({ colorScheme: "light", forcedColors: "active" });
      await traverse(page, stops, { names: false, at: "1280 px, forced colors", forced: true });
      await page.emulateMedia({ forcedColors: "none" });

      // Text spacing (SC 1.4.12) at 1280 px.
      expect.soft(await spaced(page), "text spacing at 1280 px").toEqual(SPACED_FITS);

      // 200% and 400% zoom, and a tall 320 px screen: no sideways scrolling outside a table's region, nothing
      // cut off or drawn over (with text spacing too), axe still clean, and focus never hidden under the header.
      for (const [width, height] of NARROW) {
        const at = `${width} x ${height}`;
        await resize(page, width, height);
        expect.soft(await reflow(page), `reflow at ${at}`).toEqual(FITS);
        expect.soft(await spaced(page), `text spacing at ${at}`).toEqual(SPACED_FITS);
        await axeAndContrast(page, `at ${at}`);
        await traverse(page, stops, { names: false, at });
      }
    });
  }
}

const PREVIEW = "[data-project-canvas][data-astryx-canvas]";

test("Astryx: an accepted block surface keeps its heading, its names and its focus indicators in Preview", async ({ page }) => {
  test.setTimeout(180_000);
  const block = blockOf(ASTRYX, "auth-form");
  const call = callFor(block, "example");
  await page.setViewportSize({ width: 1280, height: 900 });
  await buildBlock(page, "astryx", block, call);
  await page.getByTestId("build-accept-1").click();
  await expect(page.getByTestId("build-accepted-1")).toContainText(/ex\.chat-\d+/);
  const id = (await page.getByTestId("build-accepted-1").innerText()).match(/ex\.chat-\d+/)![0];
  await page.getByTestId("nav-preview").click();
  await page.getByTestId(`surface-${id}`).click();
  const preview = page.locator(PREVIEW);
  await expect.soft(preview.getByRole("heading", { level: 2 }), "the title's heading").toHaveAccessibleName(call.title);
  expect.soft((await axeOn(page, "[data-project-canvas]")).violations, "axe").toEqual([]);
  const button = preview.getByRole("button", { name: LABELS.submit![call.mode]! });
  await button.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  const ring = await button.evaluate((e) => {
    const s = getComputedStyle(e);
    return { style: s.outlineStyle, width: parseFloat(s.outlineWidth), color: s.outlineColor };
  });
  // Astryx's own accent ring (#0064E0, 5.4:1 against the white canvas), not the studio's green.
  expect.soft(ring, "the submit button's focus ring").toEqual({ style: "solid", width: 2, color: "rgb(0, 100, 224)" });
  const stops = tabStops("auth-form", call);
  for (const [width, height] of NARROW) {
    const at = `Preview at ${width} x ${height}`;
    await resize(page, width, height);
    expect.soft(await reflow(page, PREVIEW), at).toEqual(FITS);
    expect.soft(await spaced(page, PREVIEW), `${at}, text spacing`).toEqual(SPACED_FITS);
    await axeAndContrast(page, at, PREVIEW);
    await traverse(page, stops, { names: false, at, sel: PREVIEW });
  }
});

/** A violation outside the blocks that predates step 6, recorded in docs/blocks/ACCESSIBILITY.md ("Outside the blocks"). */
const KNOWN: Record<string, string[]> = { "ex.plan-comparison": ["aria-required-children"] };

test("Astryx: every reference surface in Preview, at every size: axe, and nothing cut off, scrolled in a box or drawn over", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openProject(page, "astryx", "astryx references");
  await page.getByTestId("nav-preview").click();
  const ids = await page.locator('[data-testid^="surface-"]:not([data-testid^="surface-refused-"])').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!.slice("surface-".length)));
  expect(ids.length).toBeGreaterThan(0);
  for (const id of ids) {
    await resize(page, 1280, 900);
    await page.getByTestId(`surface-${id}`).click();
    await expect(page.locator(PREVIEW)).toBeVisible();
    for (const [width, height] of [[1280, 900], ...NARROW] as const) {
      const at = `${id} at ${width} x ${height}`;
      await resize(page, width, height);
      // A data table may scroll inside its region; nothing else may scroll, be cut off or be drawn over.
      const r = await reflow(page, PREVIEW);
      expect.soft({ pageOverflow: r.pageOverflow, outside: r.outside, clipped: r.clipped, scrollers: r.scrollers, overlaps: r.overlaps, covered: r.covered }, at).toEqual({ pageOverflow: 0, outside: [], clipped: [], scrollers: [], overlaps: [], covered: [] });
      expect.soft(await spaced(page, PREVIEW), `${at}, text spacing`).toEqual(SPACED_FITS);
      const scan = await axeOn(page, PREVIEW);
      expect.soft(scan.violations.filter((v) => !(KNOWN[id] ?? []).includes(v.id)), `${at}: axe`).toEqual([]);
      for (const node of await undecidedContrast(page, scan.incomplete as never, PREVIEW)) expect.soft(node.ratio, `${at}: contrast axe left undecided: ${node.sel}`).toBeGreaterThanOrEqual(node.needed);
    }
  }
});

// ---- Astryx surfaces beyond the blocks ----------------------------------------

/**
 * Model-shaped surfaces the blocks never produce, which Preview renders under
 * the same renderers and canvas rules: inline dialogs taller than a short
 * window, an alert dialog with long labels, a children-mode table, Astryx's
 * `large` type and display text with no words. They come in as an imported
 * project's examples.
 */
const said = (value: string, type = "body") => ({ component: "text", props: { type }, text: value });
const press = (label: string, variant: string) => ({ component: "button", props: { label, variant } });
const paragraphs = (n: number) => Array.from({ length: n }, (_, i) => said(`Paragraph ${i + 1}. ${LOREM.trim()}.`));
const surface = (id: string, intent: string, name: string, children: Json[]) => ({
  id,
  intent,
  name,
  prompt: name,
  description: name,
  surface: { dspackSurface: "0.1", system: "Astryx", intent, root: { component: "card", children } },
});
const BEYOND: Json[] = [
  surface("ex.a11y-dialogs", "destructive-action", "Dialogs", [
    said("Dialogs", "display-3"),
    { component: "dialog", props: { variant: "standard", purpose: "form" }, children: [said("A standard dialog"), ...paragraphs(4), press("The standard dialog's last button", "primary")] },
    { component: "dialog", props: { variant: "fullscreen", purpose: "info" }, children: [said("A fullscreen dialog"), ...paragraphs(4), press("The fullscreen dialog's last button", "secondary")] },
    {
      component: "alert-dialog",
      props: { title: "Permanently delete every archived project in this workspace?", description: "This cannot be undone.", actionLabel: "Delete every archived project permanently", cancelLabel: "Keep my archived projects", actionVariant: "destructive" },
    },
  ]),
  surface("ex.a11y-structure", "record-collection", "Structure", [
    said("Structure", "display-3"),
    said("Large text is body text", "large"),
    said("", "display-3"),
    {
      component: "table",
      props: { columns: ["Ticket", "Subject", "Requester", "Status", "Priority", "Updated"], data: [] },
      children: Array.from({ length: 12 }, (_, i) => said(["#4812", "Cannot export session receipts", "Ada Lovelace", "Waiting on support", "Urgent", "2026-10-16"][i % 6]!)),
    },
  ]),
];

test("Astryx: surfaces beyond the blocks in Preview, at every size: axe, and nothing cut off, scrolled in a box or drawn over", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openProject(page, "astryx", "export source");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("project-export").click()]);
  const exported = JSON.parse(readFileSync((await download.path())!, "utf8")) as Json;
  exported.name = "astryx beyond the blocks";
  exported.contract.examples = [...(exported.contract.examples as Json[]), ...BEYOND];
  await page.getByTestId("nav-projects").click();
  await page.getByTestId("import-project-input").setInputFiles({ name: "beyond.composerproject.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(exported)) });
  await expect(page.getByTestId("build-prompt")).toBeVisible();
  await page.getByTestId("nav-preview").click();
  for (const { id } of BEYOND as Array<{ id: string }>) {
    await resize(page, 1280, 900);
    await page.getByTestId(`surface-${id}`).click();
    await expect(page.locator(PREVIEW)).toBeVisible();
    if (id === "ex.a11y-structure") {
      // Astryx's large type is body text, and display text with no words is no heading.
      await expect.soft(page.locator(PREVIEW).getByRole("heading"), `${id}: headings`).toHaveText(["Structure"]);
    }
    for (const [width, height] of [[1280, 900], ...NARROW] as const) {
      const at = `${id} at ${width} x ${height}`;
      await resize(page, width, height);
      expect.soft(await reflow(page, PREVIEW), at).toEqual(FITS);
      expect.soft(await spaced(page, PREVIEW), `${at}, text spacing`).toEqual(SPACED_FITS);
      await axeAndContrast(page, at, PREVIEW);
    }
  }
});

// ---- shadcn/ui v3: information only ----------------------------------------

test.describe("shadcn/ui v3, information only: never gates the Astryx-only beta", () => {
  for (const blockId of ["records-table", "auth-form", "guide-steps"]) {
    for (const variant of ["example", "max"] as Variant[]) {
      test(`shadcn/ui v3 ${blockId}, ${variant} call: scanned and recorded`, async ({ page }, info) => {
        test.setTimeout(120_000);
        const report: Json = { block: blockId, variant };
        try {
          await page.setViewportSize({ width: 1280, height: 900 });
          await buildBlock(page, "shadcn", blockOf(SHADCN, blockId), callFor(blockOf(SHADCN, blockId), variant));
          const scan = async () => (await new AxeBuilder({ page }).withTags(TAGS).include(CANVAS).analyze()).violations.map((v) => ({ id: v.id, nodes: v.nodes.length }));
          report.axe1280 = await scan();
          report.headings = await page.locator(CANVAS).getByRole("heading").count();
          await page.setViewportSize({ width: 320, height: 720 });
          report.axe320 = await scan();
          report.reflow320 = await page.evaluate((sel) => {
            const canvas = document.querySelector(sel) as HTMLElement;
            return { pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, canvasOverflow: canvas.scrollWidth - canvas.clientWidth };
          }, CANVAS);
        } catch (error) {
          report.error = String(error).slice(0, 300);
        }
        await info.attach(`shadcn-${blockId}-${variant}.json`, { body: JSON.stringify(report, null, 2), contentType: "application/json" });
        info.annotations.push({ type: "information only", description: JSON.stringify(report) });
        console.log(`[shadcn/ui v3 a11y, information only] ${JSON.stringify(report)}`);
      });
    }
  }
});
