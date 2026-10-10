/**
 * Selection (Phase 1A, commit 2): which block, if any, a goal maps to.
 * - The deterministic selector (scripted runs) needs real evidence: a declared
 *   keyword, or at least two distinct matching words. Ties go to null.
 * - withBlockChoice extends the planning request only when there are eligible
 *   blocks, and never mutates the request it was given.
 * - reconcileBlockChoice never lets the model pick a block that is not
 *   eligible for the plan's intent, and tells an omission from a null.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildPlanRequest } from "../plan";
import { parseBlocksSidecar, recheckBlockChoice, reconcileBlockChoice, selectBlockDeterministic, withBlockChoice, type BlockDefinition } from "./index";

type Json = Record<string, any>;
const repo = (rel: string) => fileURLToPath(new URL(`../../../../${rel}`, import.meta.url));
const json = (rel: string) => JSON.parse(readFileSync(repo(rel), "utf8")) as Json;

const contract = json("apps/composer/shadcn-v3-project/shadcn-ui.dspack.json");
const parsed = parseBlocksSidecar(json("apps/composer/experimental/blocks/shadcn-v3.blocks.json"));
if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
const BLOCKS = parsed.sidecar.blocks;
const byId = (id: string) => BLOCKS.find((b) => b.id === id)!;

describe("selectBlockDeterministic", () => {
  it("a declared keyword is enough evidence", () => {
    expect(selectBlockDeterministic("a queue of open support tickets with status and priority", "record-collection", BLOCKS)).toMatchObject({
      id: "records-table",
      reason: expect.stringMatching(/queue|tickets/),
    });
    expect(selectBlockDeterministic("a sign-in form with email and password", "structured-input", BLOCKS).id).toBe("auth-form");
    expect(selectBlockDeterministic("a recipe for tomato pasta for two with ingredients and steps", "record-detail", BLOCKS).id).toBe("guide-steps");
  });

  it("a multi-word keyword matches as a phrase, on word boundaries", () => {
    expect(selectBlockDeterministic("how to set up the printer", "record-detail", BLOCKS).id).toBe("guide-steps");
    expect(selectBlockDeterministic("show how tornadoes form", "record-detail", BLOCKS).id).toBeNull();
  });

  it("without a keyword, two distinct matching words are needed; one is not enough", () => {
    const blocks: BlockDefinition[] = [{ ...byId("records-table"), keywords: [], summary: "Many records of one kind, scanned as a captioned table." }];
    expect(selectBlockDeterministic("a captioned table of members", "record-collection", blocks).id).toBe("records-table");
    expect(selectBlockDeterministic("a captioned dashboard", "record-collection", blocks)).toMatchObject({ id: null, reason: expect.stringMatching(/evidence/) });
  });

  it("only blocks that serve the selected intent are candidates", () => {
    const choice = selectBlockDeterministic("a sign-in form with email and password", "record-collection", BLOCKS);
    expect(choice.id).toBeNull();
    expect(choice.reason).toMatch(/serving record-collection \(records-table\)/);
    expect(choice.reason).not.toContain("auth-form");
  });

  it("a tie between two blocks goes to null, visibly", () => {
    const twin: BlockDefinition = { ...byId("records-table"), id: "records-grid", name: "Records grid" };
    const choice = selectBlockDeterministic("a queue of tickets", "record-collection", [...BLOCKS, twin]);
    expect(choice.id).toBeNull();
    expect(choice.reason).toMatch(/records-table.*records-grid|records-grid.*records-table/);
  });

  it("no eligible blocks means null", () => {
    expect(selectBlockDeterministic("a queue of tickets", "record-collection", [])).toEqual({ id: null, reason: "no block is eligible for this build", source: "deterministic" });
  });
});

describe("withBlockChoice", () => {
  const request = buildPlanRequest("a sign-in form", contract);

  it("with no eligible blocks it returns the very same request", () => {
    expect(withBlockChoice(request, [])).toBe(request);
  });

  it("adds a required block (eligible ids or null) and blockReason, and lists the eligible blocks after the unchanged system text", () => {
    const before = JSON.stringify(request);
    const extended = withBlockChoice(request, [byId("auth-form"), byId("guide-steps")]);
    expect(JSON.stringify(request)).toBe(before); // never mutated
    expect(extended.messages).toEqual(request.messages);
    expect(extended.system.startsWith(request.system)).toBe(true);
    expect(extended.system).toContain("auth-form");
    expect(extended.system).toContain(byId("auth-form").summary);
    expect(extended.system).not.toContain("records-table");
    const schema = extended.jsonSchema as Json;
    expect(schema.required).toEqual([...(request.jsonSchema.required as string[]), "block", "blockReason"]);
    expect(schema.properties.block.enum).toEqual(["auth-form", "guide-steps", null]);
    expect(schema.properties.blockReason.type).toBe("string");
    expect(schema.additionalProperties).toBe(false);
  });
});

describe("reconcileBlockChoice", () => {
  const eligible = BLOCKS;

  it("a model choice that is eligible and serves the plan's intent", () => {
    expect(reconcileBlockChoice({ block: "auth-form", blockReason: "it is a sign-in form" }, { intent: "structured-input", eligible })).toEqual({
      id: "auth-form",
      reason: "it is a sign-in form",
      source: "model",
    });
  });

  it("an explicit null is a choice, and an omission is reported as such", () => {
    expect(reconcileBlockChoice({ block: null, blockReason: "nothing fits" }, { intent: "structured-input", eligible })).toEqual({ id: null, reason: "nothing fits", source: "model" });
    expect(reconcileBlockChoice({}, { intent: "structured-input", eligible })).toEqual({ id: null, reason: "the planner did not answer the block question", source: "omitted" });
  });

  it("a block that is not eligible, or does not serve the intent, is rejected to null with the rejection recorded", () => {
    expect(reconcileBlockChoice({ block: "records-table" }, { intent: "structured-input", eligible })).toEqual({
      id: null,
      reason: "records-table does not serve structured-input",
      source: "model",
      rejected: "records-table",
    });
    expect(reconcileBlockChoice({ block: "carousel" }, { intent: "structured-input", eligible })).toMatchObject({ id: null, source: "model", rejected: "carousel" });
  });
});

describe("recheckBlockChoice (after an intent override or a flow step)", () => {
  it("keeps a choice the new intent still allows", () => {
    const choice = { id: "auth-form", reason: "r", source: "model" as const };
    expect(recheckBlockChoice(choice, "structured-input", BLOCKS)).toBe(choice);
  });

  it("nulls a choice the new intent does not allow, with a note", () => {
    expect(recheckBlockChoice({ id: "auth-form", reason: "r", source: "model" }, "record-collection", BLOCKS)).toEqual({
      id: null,
      reason: "auth-form does not serve record-collection, which the context was changed to",
      source: "model",
      rejected: "auth-form",
    });
  });

  it("nulls a choice that is no longer eligible", () => {
    expect(recheckBlockChoice({ id: "auth-form", reason: "r", source: "deterministic" }, "structured-input", []).id).toBeNull();
  });
});
