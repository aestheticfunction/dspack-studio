/**
 * Workspace appearance (experimental; T4): the chrome Composer is worked in, compiled by the shared deterministic
 * theme compiler (@aestheticfunction/dspack-gen/theme, installed as dspack-gen-theme). Composer has no theme
 * generator of its own: a stored choice is a closed-enum proposal, compiled at load, never stored token values.
 *
 * Appearances:
 *   - Aesthetic Function, Ember and Slate: the existing governed themes, unchanged (appearance.ts, af-ui.css);
 *   - Neutral dark and Neutral light: fixed proposals, quieter, keeping the brand's olive accent at low chroma;
 *   - Custom: a proposal chosen with the compiler's own enums.
 * Every appearance takes the workspace choices: density, text size, label case, header style, canvas surround.
 *
 * Isolation. Only Composer's chrome variables change, on the root element, as the existing themes already do.
 * No `color-scheme` is set anywhere (Astryx resolves light-dark() from it), no design-system token is touched, and
 * nothing here reads or writes a composition, a check or an approval. A test asserts the canvas's computed styles
 * are identical under every appearance.
 */
import { compileWorkspace, COMPILER_VERSION, DEFAULT_WORKSPACE, DENSITY_SCALE, LABEL_CASE, SURROUND, TEXT_SCALE, WORKSPACE_VERSION, type WorkspaceOptions } from "dspack-gen-theme/theme";
import { applyTheme, getStoredTheme, type ThemeId } from "../../app/appearance";
import { type AppearanceRecord, type CustomDirection } from "./appearance-enums";
import { readRecord } from "./storage";

export { CUSTOM_ENUMS, BASES, WORKSPACE_ENUMS, type AppearanceRecord, type Base, type CustomDirection } from "./appearance-enums";

export const LEGACY: readonly ThemeId[] = ["default", "ember", "slate"];

/** The neutral direction: quiet surfaces, neutral ink, the brand's olive accent held back. */
export const NEUTRAL: Omit<CustomDirection, "scheme"> = { surfaceHue: "neutral", tint: "none", depth: "dim", warmth: "neutral", contrast: "standard", accentHue: "olive", chroma: "soft", presence: "recede", weight: "medium", elevation: "soft" };

export const DEFAULT_CUSTOM: CustomDirection = { scheme: "dark", ...NEUTRAL, surfaceHue: "sky", tint: "whisper", accentHue: "teal", chroma: "clear", presence: "balance" };

/** A neutral appearance starts quiet: the plain header. Every choice can still be changed. */
export const NEUTRAL_WORKSPACE: Required<WorkspaceOptions> = { ...DEFAULT_WORKSPACE, display: "plain" };

export function defaultRecord(legacy: ThemeId = "default"): AppearanceRecord {
  return { base: legacy, custom: DEFAULT_CUSTOM, workspace: { ...DEFAULT_WORKSPACE } };
}

/** The full theme-direction v1 proposal a custom or neutral direction compiles from. */
export function proposalFor(d: Omit<CustomDirection, "scheme">) {
  return {
    directionVersion: "1",
    refusal: false,
    refusalCategory: "none",
    interpretation: "A Composer workspace appearance.",
    surface: { hueFamily: d.surfaceHue, hueNudge: "0", tint: d.tint, depth: d.depth },
    ink: { warmth: d.warmth, contrastCharacter: d.contrast },
    accent: { hueFamily: d.accentHue, hueNudge: "0", chroma: d.chroma, presence: d.presence },
    typography: { headlineWeight: d.weight, headlineTracking: "normal", displayVoice: "brand" },
    elevation: { character: d.elevation },
  };
}

/** Composer's chrome variables, from the compiler's tokens. Only these change; the canvas reads none of them. */
const CHROME: Array<[string, string]> = [
  ["--bg", "surface.bg"],
  ["--bg-1", "surface.bg-1"],
  ["--bg-2", "surface.bg-2"],
  ["--line", "surface.line"],
  ["--line-soft", "surface.line-soft"],
  ["--fg", "ink.fg"],
  ["--fg-body", "ink.fg-body"],
  ["--fg-dim", "ink.fg-dim"],
  ["--fg-faint", "ink.fg-faint"],
  ["--green", "accent.accent-fill"],
  ["--green-bright", "accent.green-bright"],
  ["--green-deep", "accent.green-deep"],
  ["--green-glow", "accent.green-glow"],
  ["--on-accent", "ink.on-accent"],
  ["--shadow-menu", "elevation.shadow-menu"],
  ["--err", "status.error"],
  ["--err-line", "status.error"],
  ["--ok", "status.success"],
  ["--warn", "status.warning"],
  ["--info", "status.info"],
  ["--link", "status.link"],
];

export type Resolved =
  | { ok: true; mode: "legacy"; theme: ThemeId; vars: Record<string, string>; header: "brand" | "plain" }
  | { ok: true; mode: "compiled"; scheme: "dark" | "light"; vars: Record<string, string>; header: "brand" | "plain"; constraints: number; repairs: number; compilerVersion: string; workspaceVersion: string }
  | { ok: false; reasons: string[] };

/** The workspace-layer variables every appearance carries: density, text size, labels, canvas surround. */
function workspaceVars(w: Required<WorkspaceOptions>, workspaceBg: string): Record<string, string> {
  return {
    "--cl-space": DENSITY_SCALE[w.density],
    "--cl-type": TEXT_SCALE[w.textScale],
    "--cl-label-transform": LABEL_CASE[w.labelCase].transform,
    "--cl-label-tracking": LABEL_CASE[w.labelCase].tracking,
    "--cl-surround": w.surround === "workspace" ? workspaceBg : SURROUND[w.surround],
    "--cl-surround-pad": w.surround === "workspace" ? "0px" : "16px",
  };
}

/** What an appearance record becomes, or why it cannot apply. Pure: nothing is changed. */
export function resolveAppearance(record: AppearanceRecord): Resolved {
  if ((LEGACY as readonly string[]).includes(record.base)) {
    return { ok: true, mode: "legacy", theme: record.base as ThemeId, vars: workspaceVars(record.workspace, "var(--bg)"), header: record.workspace.display === "plain" ? "plain" : "brand" };
  }
  const direction: CustomDirection = record.base === "custom" ? record.custom : { ...NEUTRAL, scheme: record.base === "neutral-light" ? "light" : "dark" };
  const out = compileWorkspace({ proposal: proposalFor(direction), scheme: direction.scheme, options: record.workspace });
  if (!out.ok) return { ok: false, reasons: out.reasons };
  const vars: Record<string, string> = {};
  for (const [name, token] of CHROME) vars[name] = out.tokens[token]!;
  vars["--err-soft"] = translucent(out.tokens["status.error"]!, 0.09);
  Object.assign(vars, workspaceVars(record.workspace, out.tokens["surround.bg"]!));
  return {
    ok: true,
    mode: "compiled",
    scheme: direction.scheme,
    vars,
    header: record.workspace.display === "plain" ? "plain" : "brand",
    constraints: out.constraints.length,
    repairs: out.repairs.length,
    compilerVersion: COMPILER_VERSION,
    workspaceVersion: WORKSPACE_VERSION,
  };
}

const STYLE_ID = "composer-workspace-appearance";
const RULES_ID = "composer-workspace-rules";

/** The rules every workspace choice needs once: the plain header. Chrome only; the canvas has no such classes. */
const RULES = `
:root[data-ws-header="plain"] .af-nav__link { font-family: var(--sans); text-transform: none; letter-spacing: 0; font-size: 14px; }
:root[data-ws-header="plain"] .af-brand__name { font-family: var(--sans); text-transform: none; letter-spacing: 0; }
`;

/**
 * Apply a record to the document. A legacy theme goes through the existing appearance (which also keeps the
 * default build's preference in step); a compiled one sets Composer's chrome variables on the root element. A
 * record that does not compile changes nothing and returns its reasons.
 */
export function applyAppearance(record: AppearanceRecord, doc: Document = document): Resolved {
  const resolved = resolveAppearance(record);
  if (!resolved.ok) return resolved;
  const root = doc.documentElement;
  if (!doc.getElementById(RULES_ID)) {
    const rules = doc.createElement("style");
    rules.id = RULES_ID;
    rules.textContent = RULES;
    doc.head.appendChild(rules);
  }
  let style = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement("style");
    style.id = STYLE_ID;
    doc.head.appendChild(style);
  }
  if (resolved.mode === "legacy") {
    applyTheme(resolved.theme);
    style.textContent = `:root { ${declarations(resolved.vars)} }`;
  } else {
    root.setAttribute("data-theme", "workspace");
    style.textContent = `:root[data-theme="workspace"] { ${declarations(resolved.vars)} }`;
  }
  root.setAttribute("data-ws-header", resolved.header);
  return resolved;
}

/**
 * At start-up: apply the stored record, if there is a valid one. A missing, malformed or newer record leaves the
 * default build's appearance as it is (compatibility: the three governed themes keep working untouched).
 */
export function applyStoredAppearance(): Resolved | null {
  const stored = readRecord("appearance");
  return stored.status === "ok" ? applyAppearance(stored.value) : null;
}

/** The record a first visit starts from: today's appearance, with default workspace choices. */
export function initialRecord(): AppearanceRecord {
  return defaultRecord(getStoredTheme());
}

function declarations(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([k, v]) => `${k}: ${v};`)
    .join(" ");
}

function translucent(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
