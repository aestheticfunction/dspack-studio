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
    // JSON.parse keeps the last of two equal keys, so a switch turned off by
    // adding "enabled":false in front of the old field would stay on.
    ["a repeated field, the last one turning blocks on", '{"enabled":false,"references":["astryx"],"blocks":["auth-form"],"enabled":true}'],
    ["a repeated field with the same value", '{"enabled":true,"enabled":true,"references":["astryx"],"blocks":["auth-form"]}'],
    ["a reference written with an escape", '{"enabled":true,"references":["\\u0061stryx"],"blocks":["auth-form"]}'],
    ["an on switch with no references", '{"enabled":true,"references":[],"blocks":["auth-form"]}'],
    ["an on switch with no blocks", '{"enabled":true,"references":["astryx"],"blocks":[]}'],
  ])("%s is malformed: blocks are off", async (_name, value) => {
    expect((await text({ AI, BLOCKS_BETA: value })).body).toBe('{"models":["scripted","hosted-ai"],"blocks":{"enabled":false,"reason":"malformed"}}\n');
  });

  it("whitespace is not a difference: the owner's switch, laid out over lines, reads the same", async () => {
    const laidOut = '{\n  "enabled": true,\n  "references": ["astryx"],\n  "blocks": ["records-table", "auth-form", "guide-steps"]\n}\n';
    expect((await text({ AI, BLOCKS_BETA: laidOut })).body).toBe((await text({ AI, BLOCKS_BETA: OWNER })).body);
  });

  it("a disabled switch may list nothing", async () => {
    expect(blocksBetaFor({ BLOCKS_BETA: '{"enabled":false,"references":[],"blocks":[]}' })).toEqual({ enabled: false, reason: "disabled" });
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
  const post = () => new Request("https://composer.test/api/propose", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const states = [
    ["on", OWNER],
    ["disabled", '{"enabled":false,"references":["astryx"],"blocks":["auth-form"]}'],
    ["malformed", "{"],
    ["a JSON value", JSON.parse(OWNER)],
  ];

  it.each(states)("the same refusal, byte for byte, with the switch %s as without it", async (_name, value) => {
    const without = await worker.fetch(post(), { AI });
    const withSwitch = await worker.fetch(post(), { AI, BLOCKS_BETA: value });
    expect(without.status).toBe(400);
    expect(withSwitch.status).toBe(400);
    expect(Object.fromEntries(withSwitch.headers)).toEqual(Object.fromEntries(without.headers));
    expect(await withSwitch.text()).toBe(await without.text());
  });

  it("a proposal makes the same provider call and gets the same reply, with the switch on as without it", async () => {
    const SURFACE = '{"root":{"component":"Text","id":"t1"}}';
    const body = JSON.stringify({ system: "sys", messages: [{ role: "user", content: "a login form" }], jsonSchema: { type: "object" } });
    const request = () => new Request("https://composer.test/api/propose", { method: "POST", headers: { "content-type": "application/json" }, body });
    const replies = [];
    for (const extra of [{}, { BLOCKS_BETA: OWNER }]) {
      const seen = [];
      const run = async (...args) => {
        seen.push(JSON.stringify(args));
        return { content: [{ type: "text", text: SURFACE }], usage: { input_tokens: 10, output_tokens: 2 }, model: "claude-haiku-4-5-20251001" };
      };
      const res = await worker.fetch(request(), { AI: { run }, ...extra });
      const json = await res.json();
      replies.push({ status: res.status, seen, json: { ...json, calls: json.calls.map(({ durationMs: _d, ...call }) => call) } });
    }
    expect(replies[0].status).toBe(200);
    expect(replies[1]).toEqual(replies[0]);
  });
});
