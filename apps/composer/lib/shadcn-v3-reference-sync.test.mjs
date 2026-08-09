/**
 * Drift guard for the packaged production shadcn-v3 reference.
 *
 * The hosted composer authors the production shadcn/ui v3 contract + profile in
 * apps/composer/shadcn-v3-project/. packages/contracts carries a BYTE-COPY of
 * both (shadcn-v3.dspack.json / shadcn-v3.profile.json) so the contracts
 * `prepare` build can bake catalog.shadcn-v3.v*.json in-package — the catalog
 * the packaged shadcn renderers are validated against (the composer's own
 * project out/ is gitignored and absent in a fresh CI checkout).
 *
 * Two copies buy CI-reliable in-package validation at the price of possible
 * silent drift; this test makes drift loud (the studio's check-sync idiom).
 * Ownership consolidates when the reference projects are unified — the composer
 * will then consume the packaged reference directly and this copy + guard go
 * away. Until then, editing the composer's contract/profile REQUIRES re-copying
 * into packages/contracts, and this test enforces it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)));

const PAIRS = [
  {
    label: "shadcn-v3 contract",
    authored: "../shadcn-v3-project/shadcn-ui.dspack.json",
    packaged: "../../../packages/contracts/shadcn-v3.dspack.json",
  },
  {
    label: "shadcn-v3 profile",
    authored: "../shadcn-v3-project/shadcn-v3.profile.json",
    packaged: "../../../packages/contracts/shadcn-v3.profile.json",
  },
];

describe("packaged shadcn-v3 reference stays byte-identical to the composer's authored copy", () => {
  for (const { label, authored, packaged } of PAIRS) {
    it(`${label}: packages/contracts copy equals shadcn-v3-project source`, () => {
      expect(read(packaged).equals(read(authored))).toBe(true);
    });
  }
});
