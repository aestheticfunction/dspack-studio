/**
 * The beta's block switch on the Worker (docs/blocks/PHASE-2-RELEASE-PLAN.md,
 * §6, layer 4). The beta Worker reads its BLOCKS_BETA variable and reports the
 * switch in its /api/models reply; the experimental client reads that reply
 * before every build. The variable is strict JSON naming the references and
 * blocks the beta offers. Anything else turns blocks off, with a reason, and
 * the beta offers Astryx only (branch C, docs/blocks/PHASE-2-DECISION-RECORD.md).
 *
 * Production sets no such variable, so its replies must stay byte-identical:
 * the first tests pin today's bytes, and they pass before and after.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import worker from "./index.mjs";
import { BETA_BLOCKS, BETA_REFERENCES, blocksBetaFor } from "./blocks-beta.mjs";

const OWNER = '{"enabled":true,"references":["astryx"],"blocks":["records-table","auth-form","guide-steps"]}';
const AI = { run: async () => ({}) };
const models = (env) => worker.fetch(new Request("https://composer.test/api/models"), env);
const text = async (env) => {
  const res = await models(env);
  return { status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() };
};

describe("/api/models without BLOCKS_BETA: production's reply, byte for byte", () => {
  it("hosted on: today's exact bytes and headers, with no blocks field", async () => {
    const reply = await text({ AI });
    expect(reply.status).toBe(200);
    expect(reply.body).toBe('{"models":["scripted","hosted-ai"]}\n');
    expect(reply.headers).toEqual({
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    });
  });

  it("hosted off, or no AI binding: today's exact bytes", async () => {
    expect((await text({ AI, HOSTED_AI: "off" })).body).toBe('{"models":["scripted"]}\n');
    expect((await text({})).body).toBe('{"models":["scripted"]}\n');
  });
});

describe("/api/models with BLOCKS_BETA: the switch, normalized", () => {
  it("the owner's switch, as the dashboard stores text, is reported exactly", async () => {
    const reply = await text({ AI, BLOCKS_BETA: OWNER });
    expect(reply.status).toBe(200);
    expect(reply.body).toBe(
      '{"models":["scripted","hosted-ai"],"blocks":{"enabled":true,"references":["astryx"],"blocks":["records-table","auth-form","guide-steps"]}}\n',
    );
  });

  it("the same switch stored as a JSON value gives the same bytes", async () => {
    expect((await text({ AI, BLOCKS_BETA: JSON.parse(OWNER) })).body).toBe((await text({ AI, BLOCKS_BETA: OWNER })).body);
  });

  it("the switch does not depend on hosted generation: HOSTED_AI off keeps it, and the models say scripted only", async () => {
    expect((await text({ AI, HOSTED_AI: "off", BLOCKS_BETA: OWNER })).body).toBe(
      '{"models":["scripted"],"blocks":{"enabled":true,"references":["astryx"],"blocks":["records-table","auth-form","guide-steps"]}}\n',
    );
  });

  it("a subset of blocks is reported in the order the variable gives", async () => {
    expect(blocksBetaFor({ BLOCKS_BETA: '{"enabled":true,"references":["astryx"],"blocks":["guide-steps","records-table"]}' })).toEqual({
      enabled: true,
      references: ["astryx"],
      blocks: ["guide-steps", "records-table"],
    });
  });

  it("enabled false is disabled, and says nothing more", async () => {
    const off = '{"enabled":false,"references":["astryx"],"blocks":["records-table","auth-form","guide-steps"]}';
    expect((await text({ AI, BLOCKS_BETA: off })).body).toBe('{"models":["scripted","hosted-ai"],"blocks":{"enabled":false,"reason":"disabled"}}\n');
  });

  it.each([
    ["text that is not JSON", '{"enabled":true,'],
    ["an empty value", ""],
    ["JSON that is not an object", '["astryx"]'],
    ["JSON null", "null"],
    ["a JSON string", JSON.stringify(OWNER)],
    ["a number", 1],
    ["an unknown field", '{"enabled":true,"references":["astryx"],"blocks":["auth-form"],"note":"x"}'],
    ["a missing field", '{"enabled":true,"references":["astryx"]}'],
    ["the off form without its lists", '{"enabled":false}'],
    ["enabled that is not a boolean", '{"enabled":"true","references":["astryx"],"blocks":["auth-form"]}'],
    ["shadcn, which this beta withholds", '{"enabled":true,"references":["shadcn"],"blocks":["auth-form"]}'],
    ["shadcn beside Astryx", '{"enabled":true,"references":["astryx","shadcn"],"blocks":["auth-form"]}'],
    ["the harness's name for shadcn/ui v3", '{"enabled":true,"references":["shadcn-v3"],"blocks":["auth-form"]}'],
    ["an unknown reference", '{"enabled":true,"references":["material"],"blocks":["auth-form"]}'],
    ["a repeated reference", '{"enabled":true,"references":["astryx","astryx"],"blocks":["auth-form"]}'],
    ["references that are not a list", '{"enabled":true,"references":"astryx","blocks":["auth-form"]}'],
    ["an unknown block id", '{"enabled":true,"references":["astryx"],"blocks":["data-grid"]}'],
    ["a block id in another case", '{"enabled":true,"references":["astryx"],"blocks":["Auth-Form"]}'],
    ["a repeated block id", '{"enabled":true,"references":["astryx"],"blocks":["auth-form","auth-form"]}'],
    ["a block id that is not a string", '{"enabled":true,"references":["astryx"],"blocks":[7]}'],
    ["blocks that are not a list", '{"enabled":true,"references":["astryx"],"blocks":{"auth-form":true}}'],
    ["an own __proto__ key", '{"enabled":true,"references":["astryx"],"blocks":["auth-form"],"__proto__":{}}'],
    ["a disabled switch that names an unknown block", '{"enabled":false,"references":["astryx"],"blocks":["data-grid"]}'],
  ])("%s is malformed: blocks are off", async (_name, value) => {
    expect((await text({ AI, BLOCKS_BETA: value })).body).toBe('{"models":["scripted","hosted-ai"],"blocks":{"enabled":false,"reason":"malformed"}}\n');
  });

  it("a malformed switch never echoes what the variable held", async () => {
    const reply = await text({ AI, BLOCKS_BETA: '{"enabled":true,"references":["astryx"],"blocks":["<img onerror>"]}' });
    expect(reply.body).not.toContain("onerror");
  });
});

describe("the beta's allowlists", () => {
  it("the beta offers Astryx only", () => {
    expect(BETA_REFERENCES).toEqual(["astryx"]);
    expect(Object.isFrozen(BETA_REFERENCES)).toBe(true);
  });

  it("the beta's block ids are exactly the Astryx sidecar's approved blocks", () => {
    const sidecar = JSON.parse(readFileSync(fileURLToPath(new URL("../experimental/blocks/astryx.blocks.json", import.meta.url)), "utf8"));
    expect(sidecar.status).toBe("approved");
    expect([...BETA_BLOCKS]).toEqual(sidecar.blocks.filter((b) => b.status === "approved").map((b) => b.id));
    expect(Object.isFrozen(BETA_BLOCKS)).toBe(true);
  });

  it("without the variable there is no switch to report", () => {
    expect(blocksBetaFor({})).toBeUndefined();
    expect(blocksBetaFor(undefined)).toBeUndefined();
  });
});

describe("/api/propose does not read the switch", () => {
  it("the same refusal, byte for byte, with and without BLOCKS_BETA", async () => {
    const post = () => new Request("https://composer.test/api/propose", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const without = await worker.fetch(post(), { AI });
    const withSwitch = await worker.fetch(post(), { AI, BLOCKS_BETA: OWNER });
    expect(without.status).toBe(400);
    expect(await withSwitch.text()).toBe(await without.text());
    expect(withSwitch.status).toBe(400);
  });
});
