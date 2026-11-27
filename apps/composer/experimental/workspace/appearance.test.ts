/**
 * Workspace appearance (experimental, T4): neutral and custom appearances compiled by the shared theme compiler,
 * stored as a closed-enum proposal, applied to Composer's chrome only.
 */
import { contrastRatio, DEFAULT_WORKSPACE, WORKSPACE_OPTIONS } from "dspack-gen-theme/theme";
import schema from "dspack-gen-theme/theme/theme-direction.v1.schema.json";
import { describe, expect, it } from "vitest";
import { BASES, CUSTOM_ENUMS, DEFAULT_CUSTOM, defaultRecord, NEUTRAL, proposalFor, resolveAppearance, WORKSPACE_ENUMS, type AppearanceRecord } from "./appearance";
import { readRecord, writeRecord, type KeyValueStore } from "./storage";

const props = (schema as { properties: Record<string, { properties?: Record<string, { enum?: string[] }> }> }).properties;
const memory = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

describe("the stored vocabulary is the shared compiler's", () => {
  it("every custom choice is a member of the theme-direction v1 enums, and the workspace choices are the compiler's", () => {
    const sub = (group: string, field: string) => props[group]!.properties![field]!.enum!;
    const pairs: Array<[readonly string[], string[]]> = [
      [CUSTOM_ENUMS.surfaceHue, sub("surface", "hueFamily")],
      [CUSTOM_ENUMS.tint, sub("surface", "tint")],
      [CUSTOM_ENUMS.depth, sub("surface", "depth")],
      [CUSTOM_ENUMS.warmth, sub("ink", "warmth")],
      [CUSTOM_ENUMS.contrast, sub("ink", "contrastCharacter")],
      [CUSTOM_ENUMS.accentHue, sub("accent", "hueFamily")],
      [CUSTOM_ENUMS.chroma, sub("accent", "chroma")],
      [CUSTOM_ENUMS.presence, sub("accent", "presence")],
      [CUSTOM_ENUMS.weight, sub("typography", "headlineWeight")],
      [CUSTOM_ENUMS.elevation, sub("elevation", "character")],
    ];
    for (const [ours, theirs] of pairs) expect([...ours].sort()).toEqual([...theirs].sort());
    expect(Object.fromEntries(Object.entries(WORKSPACE_ENUMS).map(([k, v]) => [k, [...v]]))).toEqual(WORKSPACE_OPTIONS);
  });
});

describe("appearances", () => {
  it("the governed themes stay as they are: no compilation, only the workspace choices", () => {
    for (const theme of ["default", "ember", "slate"] as const) {
      const r = resolveAppearance(defaultRecord(theme));
      expect(r).toMatchObject({ ok: true, mode: "legacy", theme, header: "brand" });
      if (r.ok) expect(r.vars).toEqual({ "--cl-space": "1", "--cl-type": "1", "--cl-label-transform": "none", "--cl-label-tracking": "0", "--cl-surround": "var(--bg)", "--cl-surround-pad": "0px" });
    }
  });

  it("neutral dark, neutral light and the default custom direction compile, and their text reads at 4.5:1", () => {
    for (const base of ["neutral-dark", "neutral-light", "custom"] as const) {
      const r = resolveAppearance({ ...defaultRecord(), base });
      expect(r.ok, base).toBe(true);
      if (!r.ok || r.mode !== "compiled") continue;
      expect(r.scheme).toBe(base === "neutral-light" ? "light" : "dark");
      for (const fg of ["--fg", "--fg-body", "--fg-dim", "--green-bright", "--err", "--ok", "--warn", "--info", "--link"])
        for (const bg of ["--bg", "--bg-1"]) expect(contrastRatio(r.vars[fg]!, r.vars[bg]!)!, `${base} ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(r.vars["--on-accent"]!, r.vars["--green"]!)!, `${base} label on the accent`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("every surface hue and accent hue compiles in both schemes with the other neutral choices", () => {
    for (const scheme of CUSTOM_ENUMS.scheme)
      for (const surfaceHue of CUSTOM_ENUMS.surfaceHue)
        for (const accentHue of CUSTOM_ENUMS.accentHue) {
          const r = resolveAppearance({ ...defaultRecord(), base: "custom", custom: { ...DEFAULT_CUSTOM, scheme, surfaceHue, accentHue } });
          expect(r.ok, `${scheme} ${surfaceHue} ${accentHue}`).toBe(true);
        }
  });

  it("an appearance sets Composer's chrome variables only: never a colour scheme, never a design-system token", () => {
    for (const base of BASES) {
      const r = resolveAppearance({ ...defaultRecord(), base });
      if (!r.ok) continue;
      for (const name of Object.keys(r.vars)) {
        expect(name, base).toMatch(/^--(bg|bg-1|bg-2|line|line-soft|fg|fg-body|fg-dim|fg-faint|green|green-bright|green-deep|green-glow|on-accent|shadow-menu|err|err-line|err-soft|ok|warn|info|link|cl-[a-z-]+)$/);
        expect(name).not.toMatch(/color-scheme|astryx|shadcn/i);
      }
    }
  });

  it("the neutral direction keeps the brand's olive accent, held back", () => {
    expect(NEUTRAL).toMatchObject({ surfaceHue: "neutral", tint: "none", accentHue: "olive", presence: "recede" });
    expect(proposalFor(NEUTRAL)).toMatchObject({ directionVersion: "1", refusal: false, accent: { hueFamily: "olive" } });
  });

  it("the workspace choices map to the compiler's values", () => {
    const r = resolveAppearance({ ...defaultRecord("ember"), workspace: { density: "compact", textScale: "large", labelCase: "capitals", display: "plain", surround: "light" } });
    expect(r.ok && r.vars).toMatchObject({ "--cl-space": "0.8", "--cl-type": "1.125", "--cl-label-transform": "uppercase", "--cl-label-tracking": "0.06em", "--cl-surround-pad": "16px" });
    expect(r.ok && r.header).toBe("plain");
    expect(DEFAULT_WORKSPACE).toEqual(defaultRecord().workspace);
  });
});

describe("the stored record: a closed-enum proposal, never values", () => {
  it("a valid record is kept; anything else is refused before writing", () => {
    const store = memory();
    const good: AppearanceRecord = { ...defaultRecord(), base: "custom" };
    expect(writeRecord("appearance", good, store)).toEqual({ ok: true });
    expect(readRecord("appearance", store)).toEqual({ status: "ok", value: good });
    const bad = [
      { ...good, base: "midnight" },
      { ...good, custom: { ...good.custom, accentHue: "#ff0000" } },
      { ...good, custom: { ...good.custom, tokens: { "--bg": "#000" } } },
      { ...good, workspace: { ...good.workspace, density: "airy" } },
      { ...good, vars: { "--bg": "#000" } },
      { base: "custom" },
    ];
    for (const b of bad) expect(writeRecord("appearance", b as never, store), JSON.stringify(b).slice(0, 80)).toMatchObject({ ok: false });
    expect(store.data.size).toBe(1);
  });
});
