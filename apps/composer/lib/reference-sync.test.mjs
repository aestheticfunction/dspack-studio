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

// Both directions of the copy relationship live here. The shadcn/ui v3 contract
// is authored in the composer and copied INTO packages/contracts (so the
// contracts prepare-build can bake its catalog in-package). The Astryx contract
// and profile are authored in packages/contracts (contract byte-synced upstream;
// profile serialized from astryx-profile.ts) and copied INTO the composer
// reference project. Either way, the composer file and the packages/contracts
// file must be byte-identical, and this makes any drift loud.
const PAIRS = [
  {
    label: "shadcn-v3 contract",
    composer: "../shadcn-v3-project/shadcn-ui.dspack.json",
    packaged: "../../../packages/contracts/shadcn-v3.dspack.json",
  },
  {
    label: "shadcn-v3 profile",
    composer: "../shadcn-v3-project/shadcn-v3.profile.json",
    packaged: "../../../packages/contracts/shadcn-v3.profile.json",
  },
  {
    label: "astryx contract",
    composer: "../astryx-project/astryx.dspack.json",
    packaged: "../../../packages/contracts/astryx.dspack.json",
  },
  {
    label: "astryx profile",
    composer: "../astryx-project/astryx.profile.json",
    packaged: "../../../packages/contracts/astryx.profile.json",
  },
];

describe("packaged reference contracts/profiles stay byte-identical across the copy boundary", () => {
  for (const { label, composer, packaged } of PAIRS) {
    it(`${label}: composer reference copy equals packages/contracts`, () => {
      expect(read(packaged).equals(read(composer))).toBe(true);
    });
  }
});
