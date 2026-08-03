/**
 * composer-core: manifest parsing, ledger reading (pinned against REAL
 * dspack-export output), findings, adapter manifests.
 *
 * The ledger fixtures are actual dspack-export 0.3.0 artifacts from the
 * composer spike: `acme-ui.dspack.json` is the pristine discovery output
 * (every generated hash matches); `acme-ui.enriched.dspack.json` is the same
 * document after human enrichment (components edited -> human-owned;
 * governance authored -> human-authored). This pins our WebCrypto
 * sectionHash to dspack-export's node:crypto sectionHash byte for byte.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseProjectManifest } from "./project";
import { ledgerStatus, preservesLedger, sectionHash } from "./ledger";
import { countBySeverity, finding } from "./findings";
import { COMPOSER_ADAPTERS, composerAdapter } from "./adapters";

const fixture = (name: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8"));

const pristine = fixture("acme-ui.dspack.json");
const enriched = fixture("acme-ui.enriched.dspack.json");

describe("project manifest", () => {
  const valid = {
    composerProject: "0.1",
    name: "Acme UI",
    adapter: "react-generic",
    catalogIdBase: "https://acme.example/catalogs/acme-ui",
    contractPath: "acme-ui.dspack.json",
    profilePath: "acme.profile.json",
  };

  it("parses a valid manifest and applies defaults", () => {
    const result = parseProjectManifest(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.outDir).toBe("out");
      expect(result.manifest.previewRegistry).toBe("wireframe");
    }
  });

  it("rejects a non-https catalogIdBase with a pathed issue", () => {
    const result = parseProjectManifest({ ...valid, catalogIdBase: "http://acme.example/c" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.path === "catalogIdBase")).toBe(true);
  });

  it("rejects unknown keys (strict manifest)", () => {
    const result = parseProjectManifest({ ...valid, vibes: true });
    expect(result.ok).toBe(false);
  });
});

describe("ledger reading (pinned to real dspack-export output)", () => {
  it("matches dspack-export's sectionHash on the pristine document", async () => {
    // Every recorded hash must verify against the section content it hashes.
    const recorded = pristine.metadata["x-bootstrap"].generated as Record<string, string>;
    for (const [section, hash] of Object.entries(recorded)) {
      expect(await sectionHash(pristine[section]), section).toBe(hash);
    }
  });

  it("reports pristine sections tool-owned and unbootstrapped governance absent", async () => {
    const status = await ledgerStatus(pristine);
    expect(status.hasLedger).toBe(true);
    const byName = Object.fromEntries(status.sections.map((s) => [s.section, s.state]));
    expect(byName.components).toBe("tool-owned");
    expect(byName.tokens).toBe("tool-owned");
    expect(byName.intents).toBe("absent");
    expect(status.awaitingAuthorship).toContain("intents");
  });

  it("reports enrichment: edited components human-owned, authored governance human-authored", async () => {
    const status = await ledgerStatus(enriched);
    const byName = Object.fromEntries(status.sections.map((s) => [s.section, s.state]));
    expect(byName.components).toBe("human-owned"); // props + composition edited after bootstrap
    expect(byName.tokens).toBe("tool-owned"); // untouched
    expect(byName.intents).toBe("human-authored"); // authored, never generated
    expect(byName.rules).toBe("human-authored");
  });

  it("preservesLedger guards ledger deletion, not content edits", () => {
    expect(preservesLedger(pristine, enriched)).toBe(true);
    const stripped = structuredClone(enriched);
    delete stripped.metadata["x-bootstrap"];
    expect(preservesLedger(pristine, stripped)).toBe(false);
    // A document that never had a ledger is unconstrained.
    expect(preservesLedger({ metadata: {} }, { metadata: {} })).toBe(true);
  });
});

describe("findings", () => {
  it("counts by severity", () => {
    const counts = countBySeverity([
      finding("S2", "unknown-prop", "error", "$.root.props.x", "unknown prop"),
      finding("fidelity", "lossy", "warn", "button.variant", "5 -> 4 projection"),
    ]);
    expect(counts).toEqual({ error: 1, warn: 1, info: 0 });
  });
});

describe("adapter manifests", () => {
  it("ships the initial trio with the documented seam bindings", () => {
    expect(Object.keys(COMPOSER_ADAPTERS).sort()).toEqual(["astryx", "react-generic", "shadcn"]);
    expect(composerAdapter("react-generic")?.rendering).toBeUndefined(); // wireframe fallback
    expect(composerAdapter("shadcn")?.rendering?.registryId).toBe("shadcn");
    expect(composerAdapter("astryx")?.drift?.runtime).toBe("agent");
  });
});
