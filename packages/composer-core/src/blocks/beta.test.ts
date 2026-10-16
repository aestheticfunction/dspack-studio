/**
 * The beta's block switch (Phase 2 plan, §6, layer 4). The beta Worker reports
 * it in its /api/models reply, from its BLOCKS_BETA variable; the experimental
 * client reads it before every build. Anything but a well-formed switch that
 * names known references and blocks fails closed: no blocks, with a reason.
 */
import { describe, expect, it } from "vitest";
import { gateBlocksBeta, parseBlocksBeta, type BlockDefinition, type BlocksBetaSwitch } from "./index";

const KNOWN = { references: ["shadcn", "astryx"], blocks: ["records-table", "auth-form", "guide-steps"] };
const OWNER = { enabled: true, references: ["astryx"], blocks: ["records-table", "auth-form", "guide-steps"] };
const MODELS = ["scripted", "hosted-ai"];
const reply = (blocks?: unknown) => (blocks === undefined ? { models: MODELS } : { models: MODELS, blocks });

describe("parseBlocksBeta: the switch as the beta Worker reports it", () => {
  it("the owner's switch turns blocks on for exactly the references and blocks it lists", () => {
    expect(parseBlocksBeta(reply(OWNER), KNOWN)).toEqual({ state: "on", references: ["astryx"], blocks: ["records-table", "auth-form", "guide-steps"] });
  });

  it("a reply without the field is missing: production's reply offers no blocks", () => {
    expect(parseBlocksBeta(reply(), KNOWN)).toEqual({ state: "off", reason: "missing" });
  });

  it("a reply that is not an object cannot be read", () => {
    for (const body of [null, undefined, [], [reply(OWNER)], "{}", 1, true]) {
      expect(parseBlocksBeta(body, KNOWN)).toEqual({ state: "off", reason: "unreadable" });
    }
  });

  it("the Worker's own off forms keep their reason", () => {
    expect(parseBlocksBeta(reply({ enabled: false, reason: "disabled" }), KNOWN)).toEqual({ state: "off", reason: "disabled" });
    expect(parseBlocksBeta(reply({ enabled: false, reason: "malformed" }), KNOWN)).toEqual({ state: "off", reason: "malformed" });
  });

  it.each<[string, unknown]>([
    ["an unknown field", { ...OWNER, note: "x" }],
    ["a missing field", { enabled: true, references: ["astryx"] }],
    ["enabled that is not a boolean", { ...OWNER, enabled: "true" }],
    ["enabled false in the on shape", { ...OWNER, enabled: false }],
    ["references that are not a list", { ...OWNER, references: "astryx" }],
    ["an unknown reference", { ...OWNER, references: ["astryx", "material"] }],
    ["the harness's name for shadcn/ui v3", { ...OWNER, references: ["shadcn-v3"] }],
    ["a repeated reference", { ...OWNER, references: ["astryx", "astryx"] }],
    ["blocks that are not a list", { ...OWNER, blocks: { "records-table": true } }],
    ["an unknown block id", { ...OWNER, blocks: ["records-table", "data-grid"] }],
    ["a repeated block id", { ...OWNER, blocks: ["auth-form", "auth-form"] }],
    ["a block id that is not a string", { ...OWNER, blocks: ["auth-form", 7] }],
    ["an on switch with no references", { ...OWNER, references: [] }],
    ["an on switch with no blocks", { ...OWNER, blocks: [] }],
    ["an off form with an unknown reason", { enabled: false, reason: "paused" }],
    ["an off form with another field", { enabled: false, reason: "disabled", references: [] }],
    ["an own __proto__ key", JSON.parse('{"enabled":true,"references":["astryx"],"blocks":["auth-form"],"__proto__":{}}')],
    ["a list", [OWNER]],
    ["null", null],
    ["the switch as unparsed text", JSON.stringify(OWNER)],
  ])("%s is malformed, so it offers no blocks", (_name, value) => {
    expect(parseBlocksBeta(reply(value), KNOWN)).toEqual({ state: "off", reason: "malformed" });
  });
});

describe("gateBlocksBeta: what a reference is offered under the switch", () => {
  const blocks = ["records-table", "auth-form", "guide-steps"].map((id) => ({ id }) as BlockDefinition);
  const on = (references: string[], ids: string[]): BlocksBetaSwitch => ({ state: "on", references, blocks: ids });

  it("an off switch offers nothing, and says which off it is", () => {
    for (const reason of ["missing", "unreadable", "malformed", "disabled"] as const) {
      expect(gateBlocksBeta(blocks, "astryx", { state: "off", reason })).toEqual({ blocks: [], reason: `beta-switch-${reason}` });
    }
  });

  it("the owner's switch offers Astryx every listed block", () => {
    const result = gateBlocksBeta(blocks, "astryx", on(["astryx"], OWNER.blocks));
    expect(result.reason).toBeNull();
    expect(result.blocks.map((b) => b.id)).toEqual(["records-table", "auth-form", "guide-steps"]);
  });

  it("a reference the switch does not list is offered nothing: shadcn/ui v3 under the owner's switch", () => {
    expect(gateBlocksBeta(blocks, "shadcn", on(["astryx"], OWNER.blocks))).toEqual({ blocks: [], reason: "reference-not-in-beta" });
  });

  it("only the listed blocks are offered, in the sidecar's order, not the switch's", () => {
    expect(gateBlocksBeta(blocks, "astryx", on(["astryx"], ["guide-steps", "records-table"])).blocks.map((b) => b.id)).toEqual(["records-table", "guide-steps"]);
  });

  it("a switch that lists none of the reference's blocks offers nothing", () => {
    expect(gateBlocksBeta(blocks, "astryx", on(["astryx"], []))).toEqual({ blocks: [], reason: "no-blocks-in-beta" });
  });
});
